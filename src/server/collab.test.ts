// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import * as Y from "yjs";
import type { Page } from "../shared/types.ts";
import { yDocToMarkdown } from "./editor-schema.ts";
import { createApp, startServer } from "./main.ts";
import { createServices, type Services } from "./services.ts";

let services: Services;
let dataDir: string;
let baseUrl: string;
let closeServer: () => Promise<void>;

async function newHttpClient() {
  const res = await fetch(`${baseUrl}/api/me`);
  expect(res.status).toBe(200);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  const me = (await res.json()) as { workspaceId: string };
  return {
    cookie,
    workspaceId: me.workspaceId,
    fetch: (pathname: string, init: RequestInit = {}) =>
      fetch(`${baseUrl}${pathname}`, {
        ...init,
        headers: { Cookie: cookie, ...(init.headers ?? {}) },
      }),
  };
}

function cookieWebSocket(cookie: string) {
  return class extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(address, protocols, { headers: { Cookie: cookie } });
    }
  };
}

function waitFor<T>(
  register: (resolve: (v: T) => void) => void,
  timeoutMs = 8000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting")), timeoutMs);
    register((v) => {
      clearTimeout(timer);
      resolve(v);
    });
  });
}

async function pollUntil(check: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("pollUntil timed out");
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkwell-collab-test-"));
  services = createServices(dataDir);
  const app = createApp(services, { heartbeatMs: 100 });
  const started = await startServer(services, app, 0);
  baseUrl = `http://127.0.0.1:${started.port}`;
  closeServer = started.close;
});

afterAll(async () => {
  await closeServer();
  await services.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("collab auth + live edits", () => {
  it("rejects a document outside the session's workspace", async () => {
    const owner = await newHttpClient();
    const attacker = await newHttpClient();
    const created = await owner.fetch("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Owner page", markdown: "owner only" }),
    });
    const page = (await created.json()) as Page;

    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `${baseUrl.replace("http", "ws")}/collab`,
      name: page.id,
      document: doc,
      // @ts-expect-error ws polyfill typing differs from lib.dom WebSocket
      WebSocketPolyfill: cookieWebSocket(attacker.cookie),
    });
    try {
      const failed = await waitFor<{ reason: string }>((resolve) => {
        provider.on("authenticationFailed", (data: { reason: string }) => resolve(data));
      });
      expect(failed.reason).toBeTruthy();
      expect(yDocToMarkdown(doc)).not.toContain("owner only");
    } finally {
      provider.destroy();
      doc.destroy();
    }
  });

  it("syncs the owner's document and receives server-side transact edits live", async () => {
    const owner = await newHttpClient();
    const created = await owner.fetch("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Live page", markdown: "# Live\n\nOriginal body." }),
    });
    const page = (await created.json()) as Page;

    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `${baseUrl.replace("http", "ws")}/collab`,
      name: page.id,
      document: doc,
      // @ts-expect-error ws polyfill typing differs from lib.dom WebSocket
      WebSocketPolyfill: cookieWebSocket(owner.cookie),
    });
    try {
      await waitFor<void>((resolve) => provider.on("synced", () => resolve()));
      await pollUntil(() => yDocToMarkdown(doc).includes("Original body."));

      await services.collab.appendMarkdown(
        page.id,
        owner.workspaceId,
        "Appended by the server with a marmalade marker.",
        { kind: "agent", id: "test-agent", name: "Tester" },
      );
      await pollUntil(() => yDocToMarkdown(doc).includes("marmalade marker"));

      // The stored markdown follows once Hocuspocus stores the document.
      await pollUntil(() => {
        const row = services.pages.getPageRow(owner.workspaceId, page.id);
        return row?.markdown.includes("marmalade marker") ?? false;
      });
      const readBack = await services.collab.readPageMarkdown(page.id, owner.workspaceId);
      expect(readBack).toContain("marmalade marker");
    } finally {
      provider.destroy();
      doc.destroy();
    }
  });
});

describe("agent awareness", () => {
  it("shows an agent caret to open editors, follows its writing, and clears it", async () => {
    const owner = await newHttpClient();
    const created = await owner.fetch("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Caret page", markdown: "Start." }),
    });
    const page = (await created.json()) as Page;

    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `${baseUrl.replace("http", "ws")}/collab`,
      name: page.id,
      document: doc,
      // @ts-expect-error ws polyfill typing differs from lib.dom WebSocket
      WebSocketPolyfill: cookieWebSocket(owner.cookie),
    });
    const agentState = () =>
      [...provider.awareness!.getStates().values()].find(
        (s) => (s as { user?: { kind?: string } }).user?.kind === "agent",
      ) as
        | { user: { name: string; color: string }; cursor: { anchor: unknown } | null }
        | undefined;
    const agent = { id: "agent-wren", name: "Wren", color: "#2e5e4e" };
    try {
      await waitFor<void>((resolve) => provider.on("synced", () => resolve()));
      await services.collab.showAgent(page.id, owner.workspaceId, agent);
      await pollUntil(() => agentState() !== undefined);
      expect(agentState()!.user).toMatchObject({ name: "Wren", color: "#2e5e4e" });
      const before = JSON.stringify(agentState()!.cursor);
      expect(agentState()!.cursor).not.toBeNull();

      await services.collab.appendMarkdown(page.id, owner.workspaceId, "More ink.", {
        kind: "agent",
        id: agent.id,
        name: agent.name,
      });
      await pollUntil(() => JSON.stringify(agentState()?.cursor) !== before);

      await services.collab.hideAgent(page.id, agent.id);
      await pollUntil(() => agentState() === undefined);
    } finally {
      provider.destroy();
      doc.destroy();
    }
  });
});

describe("SSE over HTTP", () => {
  it("streams presence, page events and heartbeats to the right workspace only", async () => {
    const client = await newHttpClient();
    const other = await newHttpClient();

    const controller = new AbortController();
    const res = await client.fetch("/api/events", { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const readSome = async () => {
      const { value, done } = await reader.read();
      if (!done && value) buffer += decoder.decode(value, { stream: true });
    };

    try {
      await readSome();
      expect(buffer).toContain("presence");

      const created = await client.fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Streamed page" }),
      });
      const streamedPageId = ((await created.json()) as { id: string }).id;
      // Activity in another workspace must not leak into this stream.
      await other.fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Other workspace secret" }),
      });

      const deadline = Date.now() + 5000;
      while (!buffer.includes("page.created") && Date.now() < deadline) {
        await readSome();
      }
      expect(buffer).toContain("page.created");
      expect(buffer).toContain("Streamed page");
      expect(buffer).not.toContain("Other workspace secret");

      // Presence reporting round-trips into a presence event.
      // The stream above is live, so presence for a page in this workspace is accepted.
      const presence = await client.fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: streamedPageId }),
      });
      expect(presence.status).toBe(204);
      const presenceEvent = `"pageId":"${streamedPageId}"`;
      while (!buffer.includes(presenceEvent) && Date.now() < deadline + 4000) {
        await readSome();
      }
      expect(buffer).toContain(presenceEvent);
      // Heartbeat comments keep the stream alive (100ms in tests); wait for one.
      while (!buffer.includes(": heartbeat") && Date.now() < deadline + 8000) {
        await readSome();
      }
      expect(buffer).toContain(": heartbeat");
    } finally {
      controller.abort();
      await reader.cancel().catch(() => {});
    }
  });
});
