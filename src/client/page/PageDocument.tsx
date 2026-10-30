import { useEffect, useMemo, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { AlertCircle, CloudOff, Loader2 } from "lucide-react";
import type { Agent, Page, Run } from "@shared/types";
import { useAgents, useMap, useMe } from "../lib/queries";
import { personColor, useBrowserOnline } from "../lib/ui";
import { useServerEvent } from "../lib/events";
import { timeAgo, useNow } from "../lib/time";
import { useCollab } from "./collab";
import { PageEditor } from "./Editor";
import { syncView } from "./syncState";
import { isUntouchedSeed } from "./title";

/**
 * The parts of a page that both the full page (`/p/:id`) and the map's peek
 * panel show: the live body, who's writing in it, who edited it last, and
 * whether it's saved. The full page adds its title, toolbar and children
 * around them; the peek panel adds its own header.
 */

export type PageSync = Omit<ReturnType<typeof useCollab>, "collab">;

export function SyncPill(props: PageSync & { readOnly?: boolean }) {
  const browserOnline = useBrowserOnline();
  const busy = props.unsynced > 0 || !props.everSynced || props.status !== "connected";
  // Tick while something is pending, so "Saving…" can turn into "Not saving" and "Reconnecting…" into "Offline".
  const now = useNow(busy ? 1_000 : 60_000);
  const view = syncView({ ...props, now, browserOnline });
  // Edits the server hasn't got yet live only in this tab: ask before a reload or close throws them away.
  const unsaved = props.unsynced > 0;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
  // Watching the recorded demo: there's nothing of yours to save, only whether it's live.
  if (props.readOnly && view.tone !== "bad")
    return (
      <span className="sync-pill" data-tone="quiet" role="status">
        <span>{props.everSynced ? "Read only" : "Opening…"}</span>
      </span>
    );
  return (
    <span className="sync-pill" data-tone={view.tone} role="status" aria-live="polite" title={view.detail}>
      {view.tone === "bad" ? (
        (props.status === "connected" && browserOnline) || props.status === "denied" ? <AlertCircle size={13} aria-hidden /> : <CloudOff size={13} aria-hidden />
      ) : view.tone === "busy" && !props.everSynced ? (
        <Loader2 size={13} className="spin" aria-hidden />
      ) : null}
      <span>{view.label}</span>
      {view.detail && <span className="sr-only">. {view.detail}</span>}
    </span>
  );
}

type Doing = "reading" | "writing" | "thinking";
const DOING: Record<Doing, string> = { reading: "is reading here", writing: "is writing here", thinking: "is thinking here" };
export type Writer = { agent: Agent; run: Run; doing: Doing };

/** Agents working on this page now, from the live runs, with what each is doing (from its footsteps). */
export function useWritersHere(pageId: string): Writer[] {
  const { data: graph } = useMap();
  const { data: agents } = useAgents();
  const [doing, setDoing] = useState<Record<string, Doing>>({});
  useServerEvent("agent.moved", (e) => {
    if (e.action !== "leaving") setDoing((d) => (d[e.runId] === e.action ? d : { ...d, [e.runId]: e.action as Doing }));
  });
  return useMemo(() => {
    const all = graph?.agents ?? agents ?? [];
    return (graph?.runs ?? [])
      .filter((r) => r.pageId === pageId && (r.status === "running" || r.status === "queued"))
      .flatMap((run) => {
        const agent = all.find((a) => a.id === run.agentId);
        if (!agent) return [];
        const last = run.steps.at(-1);
        const guess: Doing = !last ? "thinking" : /write|edit|create|append|replace|rename|move/i.test(last.tool) ? "writing" : "reading";
        return [{ agent, run, doing: doing[run.id] ?? guess }];
      });
  }, [graph, agents, pageId, doing]);
}

export function Writers({ writers }: { writers: Writer[] }) {
  if (!writers.length) return null;
  return (
    <ul className="writers" aria-label="Agents on this page">
      {writers.map(({ agent, doing }) => (
        <li key={agent.id} className="writer" data-doing={doing} style={{ ["--agent" as string]: agent.color }}>
          <span className="writer-nib" aria-hidden />
          <span className="agent-name">{agent.name}</span> {DOING[doing]}
        </li>
      ))}
    </ul>
  );
}

/** "Last edited by You · 5 minutes ago", with an agent's name in its colour. */
export function Authorship({ page, pages }: { page: Page; pages: Page[] }) {
  const { data: me } = useMe();
  const { data: agents } = useAgents();
  const now = useNow();
  const by = page.updatedBy;
  const color = by.kind === "agent" ? agents?.find((a) => a.id === by.id)?.color : undefined;
  return (
    <p className="page-meta">
      Last edited by{" "}
      {by.kind === "agent" ? (
        <span className="agent-name" style={{ ["--agent" as string]: color ?? "var(--ink-soft)" }}>{by.name}</span>
      ) : by.id === me?.person.id ? (
        "You"
      ) : (
        by.name
      )}
      {" · "}
      <time dateTime={page.updatedAt} title={new Date(page.updatedAt).toLocaleString()}>
        {isUntouchedSeed(page, pages) ? "when your notebook was made" : timeAgo(page.updatedAt, now)}
      </time>
    </p>
  );
}

/** The live body of a page: the editor over Yjs, or why it can't be shown. */
export function PageDocument({
  page,
  collab,
  sync,
  writers,
  readOnly = false,
  onReady,
  onPageLink,
}: {
  page: Page;
  collab: ReturnType<typeof useCollab>["collab"];
  sync: PageSync;
  writers: Writer[];
  readOnly?: boolean;
  onReady?(editor: TiptapEditor): void;
  /** A link to another page was followed (the peek panel swaps to it instead of navigating). */
  onPageLink?(id: string): void;
}) {
  const { data: me } = useMe();
  const user = useMemo(
    () => ({ name: me?.person.name ?? "You", color: personColor(me?.person.id ?? "me") }),
    [me?.person.name, me?.person.id],
  );
  if (sync.status === "denied") return <p className="inline-error" role="alert">This page isn't in your notebook, so it can't be edited here.</p>;
  if (!collab) return null;
  return (
    <PageEditor
      pageId={page.id}
      collab={collab}
      synced={sync.synced}
      user={user}
      editable={!readOnly}
      writerColor={writers.find((w) => w.doing === "writing")?.agent.color ?? writers[0]?.agent.color ?? null}
      onReady={onReady}
      onPageLink={onPageLink}
    />
  );
}
