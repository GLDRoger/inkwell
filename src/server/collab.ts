/**
 * Live Yjs documents for pages (Hocuspocus at /collab, document name = page id,
 * authenticated by the inkwell_sid cookie on the upgrade request).
 *
 * For the agent runtime (use the shared `services.collab`):
 *   - read:    readPageMarkdown(pageId, ws) / getPageJSON(pageId, ws) — live doc if open.
 *   - write:   appendMarkdown / replaceMarkdown (minimal diff, carets survive), or
 *              transact(pageId, ws, doc => ..., actor) for fine-grained Yjs edits on
 *              doc.getXmlFragment("default"). Pass the agent as `actor` so the stored
 *              page gets updatedBy = agent and `page.updated` fires (debounced 1–5s,
 *              immediately when the direct connection closes).
 *   - caret:   showAgent(pageId, ws, { id, name, color }) when the agent arrives on a
 *              page; writes by that agent move its caret to the end; hideAgent /
 *              hideAgentEverywhere when it leaves or the run ends. Awareness state is
 *              { user: { kind: "agent", id, name, color }, cursor }, which the client's
 *              CollaborationCaret renders as a named caret in the agent's ink.
 *   - streaming: openDirect(pageId, ws, actor) and call conn.transact repeatedly,
 *              then conn.disconnect().
 * Every entry point checks the page belongs to the workspace first.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Hocuspocus, type Document as HocusDocument } from "@hocuspocus/server";
import type { JSONContent } from "@tiptap/core";
import { WebSocketServer } from "ws";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import * as Y from "yjs";
import type { Actor } from "../shared/types.ts";
import type { Db } from "./db.ts";
import {
  appendJSONToYDoc,
  applyJSONToYDoc,
  endOfDocRelativePosition,
  markdownToTiptapJSON,
  tiptapJSONToMarkdown,
  yDocToMarkdown,
  yDocToTiptapJSON,
} from "./editor-schema.ts";
import type { PageStore } from "./pages.ts";
import { getSessionFromCookieHeader } from "./session.ts";

export { markdownToTiptapJSON, tiptapJSONToMarkdown } from "./editor-schema.ts";

export interface CollabContext {
  workspaceId: string;
  actor: Actor;
}

export type DirectConn = Awaited<
  ReturnType<Hocuspocus<CollabContext>["openDirectConnection"]>
>;

/** Who an agent is, for its caret in open editors. */
export interface AgentIdentity {
  id: string;
  name: string;
  /** Ink colour, e.g. "#7a2e1d". */
  color: string;
}

/**
 * The awareness state an agent publishes, in the shape Tiptap's
 * CollaborationCaret (y-prosemirror cursor plugin) reads: `user` is passed to
 * the client's caret renderer, `cursor` holds Yjs relative positions (JSON).
 */
export interface AgentAwarenessState {
  user: { kind: "agent"; id: string; name: string; color: string };
  cursor: { anchor: unknown; head: unknown } | null;
}

export interface CollabService {
  hocuspocus: Hocuspocus<CollabContext>;
  /** Handle an HTTP upgrade for /collab. Returns false if the path isn't ours. */
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean;
  /** Direct (server-side) connection; edits stream live to open editors. */
  openDirect: (
    pageId: string,
    workspaceId: string,
    actor?: Actor,
  ) => Promise<DirectConn>;
  readPageMarkdown: (pageId: string, workspaceId: string) => Promise<string | null>;
  getPageJSON: (pageId: string, workspaceId: string) => Promise<JSONContent | null>;
  transact: (
    pageId: string,
    workspaceId: string,
    fn: (doc: Y.Doc) => void,
    actor?: Actor,
  ) => Promise<void>;
  appendMarkdown: (
    pageId: string,
    workspaceId: string,
    markdown: string,
    actor?: Actor,
  ) => Promise<boolean>;
  replaceMarkdown: (
    pageId: string,
    workspaceId: string,
    markdown: string,
    actor?: Actor,
  ) => Promise<boolean>;
  /**
   * Show an agent in a page's live awareness (a named caret in its ink
   * colour). Idempotent: calling again moves the caret. `caret: "end"` puts it
   * at the end of the last block; "none" shows the agent without a caret.
   * appendMarkdown/replaceMarkdown by the same agent move the caret to the
   * end automatically while the agent is present. Keeps the document loaded
   * until hideAgent.
   */
  showAgent: (
    pageId: string,
    workspaceId: string,
    agent: AgentIdentity,
    options?: { caret?: "end" | "none" },
  ) => Promise<void>;
  /** Remove the agent's caret from the page (no-op if not shown). */
  hideAgent: (pageId: string, agentId: string) => Promise<void>;
  /** Remove the agent's caret from every page (call when a run ends). */
  hideAgentEverywhere: (agentId: string) => Promise<void>;
  isLoaded: (pageId: string) => boolean;
  close: () => Promise<void>;
}

const SYSTEM_ACTOR: Actor = { kind: "agent", id: "system", name: "Inkwell" };

export function createCollab(deps: {
  db: Db;
  pages: PageStore;
}): CollabService {
  const { db, pages } = deps;

  const hocuspocus = new Hocuspocus<CollabContext>({
    quiet: true,
    debounce: 1000,
    maxDebounce: 5000,
    unloadImmediately: false,

    // The session cookie rides along on the WebSocket upgrade; the provider
    // always sends an (empty) Auth message, which triggers this hook.
    async onAuthenticate({ documentName, requestHeaders }) {
      const session = getSessionFromCookieHeader(db, requestHeaders.get("cookie"));
      if (!session) throw new Error("unauthorized");
      const row = pages.getPageRow(session.workspaceId, documentName);
      if (!row) throw new Error("unauthorized");
      return { workspaceId: session.workspaceId, actor: session.person };
    },

    async onLoadDocument({ document, documentName, context }) {
      const row = context?.workspaceId
        ? pages.getPageRow(context.workspaceId, documentName)
        : null;
      if (!row) throw new Error("document not found in workspace");
      if (row.ydoc && row.ydoc.length > 0) {
        try {
          Y.applyUpdate(document, new Uint8Array(row.ydoc));
        } catch (err) {
          console.error(`[inkwell] corrupt ydoc for page ${documentName}`, err);
        }
      }
    },

    async onStoreDocument({ document, documentName, lastContext }) {
      const workspaceId = lastContext?.workspaceId;
      if (!workspaceId) return;
      const ydoc = Buffer.from(Y.encodeStateAsUpdate(document));
      const markdown = yDocToMarkdown(document);
      pages.syncPageBody(workspaceId, documentName, {
        ydoc,
        markdown,
        actor: lastContext?.actor ?? null,
      });
    },
  });

  const wss = new WebSocketServer({ noServer: true });

  const handleUpgrade: CollabService["handleUpgrade"] = (req, socket, head) => {
    const pathname = (() => {
      try {
        return new URL(req.url ?? "/", "http://internal").pathname;
      } catch {
        return "";
      }
    })();
    if (pathname !== "/collab") return false;

    wss.handleUpgrade(req, socket, head, (ws) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(", "));
      }
      const request = new Request(`http://internal${req.url ?? "/collab"}`, { headers });
      // ws satisfies Hocuspocus' WebSocketLike (send/close/readyState).
      const connection = hocuspocus.handleConnection(
        ws as unknown as Parameters<typeof hocuspocus.handleConnection>[0],
        request,
      );
      ws.on("message", (data: unknown) => {
        const bytes =
          data instanceof Uint8Array
            ? data
            : Array.isArray(data)
              ? new Uint8Array(Buffer.concat(data as Buffer[]))
              : new Uint8Array(data as ArrayBuffer);
        connection.handleMessage(bytes);
      });
      ws.on("close", (code: number, reason: Buffer) => {
        connection.handleClose({ code, reason: reason.toString() });
      });
      ws.on("pong", () => connection.touch());
      ws.on("error", (err) => console.error("[inkwell] collab socket error", err));
    });
    return true;
  };

  const requirePage = (pageId: string, workspaceId: string) => {
    const row = pages.getPageRow(workspaceId, pageId);
    if (!row) throw new Error(`page ${pageId} not found in workspace`);
    return row;
  };

  const openDirect: CollabService["openDirect"] = async (pageId, workspaceId, actor) => {
    requirePage(pageId, workspaceId);
    return hocuspocus.openDirectConnection(pageId, {
      workspaceId,
      actor: actor ?? SYSTEM_ACTOR,
    });
  };

  const transact: CollabService["transact"] = async (pageId, workspaceId, fn, actor) => {
    const connection = await openDirect(pageId, workspaceId, actor);
    try {
      await connection.transact((document: HocusDocument) => {
        fn(document as unknown as Y.Doc);
      });
    } finally {
      await connection.disconnect();
    }
  };

  // One awareness client per (page, agent): a scratch Awareness with its own
  // clientID whose updates are applied to the live document's awareness, so
  // Hocuspocus broadcasts them like any other peer's.
  interface Presence {
    awareness: Awareness;
    connection: DirectConn;
    agent: AgentIdentity;
  }
  const presences = new Map<string, Presence>();
  const presenceKey = (pageId: string, agentId: string) => `${pageId}\u0000${agentId}`;

  const publishPresence = (presence: Presence) => {
    const document = presence.connection.document;
    if (!document) return;
    const clientId = presence.awareness.clientID;
    applyAwarenessUpdate(
      document.awareness,
      encodeAwarenessUpdate(presence.awareness, [clientId]),
      "inkwell-agent",
    );
  };

  const showAgent: CollabService["showAgent"] = async (pageId, workspaceId, agent, options) => {
    const key = presenceKey(pageId, agent.id);
    let presence = presences.get(key);
    if (!presence) {
      const connection = await openDirect(pageId, workspaceId, {
        kind: "agent",
        id: agent.id,
        name: agent.name,
      });
      const created: Presence = { awareness: new Awareness(new Y.Doc()), connection, agent };
      // Forward every local change, including y-protocols' 15s renewals that
      // stop peers from timing the agent out after 30s.
      created.awareness.on("update", () => publishPresence(created));
      presences.set(key, created);
      presence = created;
    }
    presence.agent = agent;
    const document = presence.connection.document;
    const caret = options?.caret ?? "end";
    let cursor: AgentAwarenessState["cursor"] = null;
    if (caret === "end" && document) {
      const pos = Y.relativePositionToJSON(endOfDocRelativePosition(document));
      cursor = { anchor: pos, head: pos };
    }
    const state: AgentAwarenessState = {
      user: { kind: "agent", id: agent.id, name: agent.name, color: agent.color },
      cursor,
    };
    presence.awareness.setLocalState(state);
  };

  const hidePresence = async (key: string) => {
    const presence = presences.get(key);
    if (!presence) return;
    presences.delete(key);
    presence.awareness.setLocalState(null);
    presence.awareness.destroy();
    await presence.connection.disconnect({ unloadImmediately: false });
  };

  const refreshCaret = async (pageId: string, actor?: Actor) => {
    if (!actor || actor.kind !== "agent") return;
    const presence = presences.get(presenceKey(pageId, actor.id));
    if (!presence) return;
    const workspaceId = presence.connection.context?.workspaceId;
    if (workspaceId) await showAgent(pageId, workspaceId, presence.agent, { caret: "end" });
  };

  const liveJSON = (pageId: string): JSONContent | null => {
    const document = hocuspocus.documents.get(pageId);
    if (!document || document.isDestroyed) return null;
    return yDocToTiptapJSON(document);
  };

  return {
    hocuspocus,
    handleUpgrade,
    openDirect,
    transact,

    async readPageMarkdown(pageId, workspaceId) {
      const row = pages.getPageRow(workspaceId, pageId);
      if (!row) return null;
      const live = liveJSON(pageId);
      return live ? tiptapJSONToMarkdown(live) : row.markdown;
    },

    async getPageJSON(pageId, workspaceId) {
      const row = pages.getPageRow(workspaceId, pageId);
      if (!row) return null;
      return liveJSON(pageId) ?? markdownToTiptapJSON(row.markdown);
    },

    async appendMarkdown(pageId, workspaceId, markdown, actor) {
      if (!pages.getPageRow(workspaceId, pageId)) return false;
      const json = markdownToTiptapJSON(markdown);
      await transact(pageId, workspaceId, (doc) => appendJSONToYDoc(doc, json), actor);
      await refreshCaret(pageId, actor);
      return true;
    },

    async replaceMarkdown(pageId, workspaceId, markdown, actor) {
      if (!pages.getPageRow(workspaceId, pageId)) return false;
      const json = markdownToTiptapJSON(markdown);
      await transact(pageId, workspaceId, (doc) => applyJSONToYDoc(doc, json), actor);
      await refreshCaret(pageId, actor);
      return true;
    },

    showAgent,

    async hideAgent(pageId, agentId) {
      await hidePresence(presenceKey(pageId, agentId));
    },

    async hideAgentEverywhere(agentId) {
      const keys = [...presences.entries()]
        .filter(([, p]) => p.agent.id === agentId)
        .map(([key]) => key);
      for (const key of keys) await hidePresence(key);
    },

    isLoaded(pageId) {
      return hocuspocus.documents.has(pageId);
    },

    async close() {
      for (const key of [...presences.keys()]) await hidePresence(key);
      hocuspocus.flushPendingStores();
      hocuspocus.closeConnections();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
