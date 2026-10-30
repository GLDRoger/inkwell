import { Fragment, useCallback, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Footprints, Map as MapIcon, RotateCcw, Square } from "lucide-react";
import type { Agent, DiaryEntry, Run } from "@shared/types";
import { pageTitle, useMap, usePages, useRun } from "../lib/queries";
import { InkWriter } from "./InkWriter";
import { splitFailure } from "./reply";
import { COPY, provenance } from "./copy";
import { runRecovery } from "./errors";
import type { QuoteAuthor } from "./ink";
import { failNote, stopNote, tidyReply, workDone, type NotePart } from "./tidy";
import { askedFor, childRuns, helperState, waitingFor } from "./handoff";

/** What a failed reply's button does: send the same request again, or ask the agent to carry on. */
export type Recovery = "retry" | "continue";

const ACTIVE: Run["status"][] = ["queued", "running"];
export const isActiveRun = (r: Run | null | undefined) => !!r && ACTIVE.includes(r.status);

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
};

/** Ink gathering on the paper while the agent thinks. */
export function InkDrops({ color }: { color: string }) {
  return (
    <span className="ink-drops" aria-hidden style={{ ["--agent" as string]: color }}>
      <span />
      <span />
      <span />
    </span>
  );
}

/**
 * The agent's footsteps through your pages, under its reply: a quiet trail of
 * what it did, each step linking to the page and to its spot on the map.
 * Open while the agent walks; long finished trails fold away.
 */
export function Steps({
  run,
  agent,
  note,
  status,
  onCancel,
  handoffs,
}: {
  run: Run;
  agent?: Agent;
  note?: ReactNode;
  /** The agents this run asked for help, working inline under its steps. */
  handoffs?: ReactNode;
  /** What the agent said it's doing (its opening line), shown in place of "Working…". */
  status?: string | null;
  onCancel?(): void;
}) {
  const active = isActiveRun(run);
  const n = run.steps.length;
  const [open, setOpen] = useState<boolean | null>(null);
  const shown = open ?? (active || n <= 3);
  if (!n && !active && !note && !handoffs) return null;
  const listId = `steps-${run.id}`;
  return (
    <div className="steps" style={{ ["--agent" as string]: agent?.color ?? "var(--ink-soft)" }}>
      {n > 0 && (
        <button type="button" className="trail-toggle" aria-expanded={shown} aria-controls={listId} onClick={() => setOpen(!shown)}>
          <ChevronRight size={13} aria-hidden className="trail-chev" />
          What {agent?.name ?? "the agent"} did
          <span className="trail-count">
            {n} {n === 1 ? "step" : "steps"}
          </span>
        </button>
      )}
      {n > 0 && shown && (
        <ol id={listId} aria-label={`${agent?.name ?? "The agent"}'s steps`}>
          {run.steps.map((s, i) => (
            <li key={`${s.at}-${i}`} className="step" data-ok={s.ok}>
              <Footprints size={13} aria-hidden className="step-feet" />
              <span className="step-summary">
                {s.pageId ? <Link to={`/p/${s.pageId}`}>{s.summary}</Link> : s.summary}
                {!s.ok && <span className="sr-only"> (didn't work)</span>}
              </span>
              {s.pageId && (
                <Link to={`/?focus=${s.pageId}`} className="step-map" aria-label={`See “${s.summary}” on the map`} title="See it on the map">
                  <MapIcon size={13} aria-hidden />
                </Link>
              )}
            </li>
          ))}
        </ol>
      )}
      {handoffs}
      {active && (
        <p className="step-status">
          <span className="walking" aria-hidden />
          <span className="step-status-text">{run.status === "queued" ? "Getting ready…" : status || (n ? "Working…" : "Starting…")}</span>
          {onCancel && (
            <button type="button" className="link-button" onClick={onCancel}>
              <Square size={10} aria-hidden fill="currentColor" /> Stop
            </button>
          )}
        </p>
      )}
      {!active && note && (
        <p className="step-status step-note" data-status={run.status} role="status">
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * The agents a run asked for help, each with its own live trail: "Scout asked
 * Wren", what Scout asked for, then Wren's steps as she walks. Nested handoffs
 * (Wren asking Atlas) show inside, up to the server's depth limit.
 */
export function Handoffs({ run, agents, depth = 0 }: { run: Run; agents: Agent[]; depth?: number }) {
  const { data: graph } = useMap();
  const kids = childRuns(graph?.runs, run.id);
  if (!kids.length || depth > 3) return null;
  const asker = agents.find((a) => a.id === run.agentId);
  return (
    <ul className="handoffs" aria-label={`Who ${asker?.name ?? "the agent"} asked for help`}>
      {kids.map((kid) => (
        <Handoff key={kid.id} run={kid} asker={asker} agents={agents} depth={depth} />
      ))}
    </ul>
  );
}

function Handoff({ run: snapshot, asker, agents, depth }: { run: Run; asker?: Agent; agents: Agent[]; depth: number }) {
  const { data: graph } = useMap();
  // The run's own cache entry is patched by the same events; prefer it when it's further along.
  const { data: fresh } = useRun(snapshot.id);
  const run = fresh && fresh.steps.length >= snapshot.steps.length ? fresh : snapshot;
  const agent = agents.find((a) => a.id === run.agentId);
  const ask = askedFor(run.prompt);
  const active = isActiveRun(run);
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name;
  const grandkids = childRuns(graph?.runs, run.id);
  const failed = run.status === "failed" && run.error ? askedFor(run.error, 120) : null;
  return (
    <li className="handoff" data-status={run.status} style={{ ["--agent" as string]: agent?.color ?? "var(--ink-soft)" }}>
      <p className="handoff-head" role={active ? "status" : undefined}>
        {active ? <InkDrops color={agent?.color ?? "var(--ink-faint)"} /> : <span className="handoff-dot" aria-hidden />}
        <span>
          <span className="agent-name">{agent?.name ?? "Another agent"}</span> {helperState(run)}
        </span>
      </p>
      {ask && (
        <p className="handoff-ask">
          {asker ? `${asker.name} asked: ` : "Asked: "}“{ask}”
        </p>
      )}
      <Steps
        run={run}
        agent={agent}
        status={waitingFor(grandkids, nameOf)}
        note={failed ? <span className="step-note-text">{failed}</span> : undefined}
        handoffs={grandkids.length ? <Handoffs run={run} agents={agents} depth={depth + 1} /> : undefined}
      />
    </li>
  );
}

/** Pages a reply touched, when there are no run steps to show: each opens the page or its spot on the map. */
function Touched({ ids }: { ids: string[] }) {
  const { data: pages } = usePages();
  const unique = [...new Set(ids)];
  return (
    <ul className="touched" aria-label="Pages this touched">
      {unique.map((id) => {
        const p = pages?.find((x) => x.id === id);
        return (
          <li key={id}>
            <Link to={`/p/${id}`} className="touched-page">{p ? pageTitle(p) : "A page"}</Link>
            <Link to={`/?focus=${id}`} className="step-map" aria-label={`See ${p ? pageTitle(p) : "it"} on the map`} title="See it on the map">
              <MapIcon size={13} aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * "Stopped. Wren had already made Packing list.", or for a failed run
 * "Muse Spark stopped partway. Scout had already made Summary.", with each page a link.
 */
function WorkNote({ run, agents, reason }: { run: Run; agents: Agent[]; reason?: string }) {
  const { data: graph } = useMap();
  const { data: pages } = usePages();
  const work = workDone(run, graph?.runs ?? []);
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? "The agent";
  const parts = reason === undefined ? stopNote(work, nameOf) : failNote(reason, work, nameOf);
  return (
    <>
      {parts.map((p: NotePart, i) => {
        if (typeof p === "string") return <Fragment key={i}>{p}</Fragment>;
        const page = p.pageId ? pages?.find((x) => x.id === p.pageId) : undefined;
        return p.pageId && page ? (
          <Link key={i} to={`/p/${p.pageId}`}>
            {pageTitle(page)}
          </Link>
        ) : (
          <Fragment key={i}>{p.title}</Fragment>
        );
      })}
    </>
  );
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A quote in this reply was written by the agent named in the line before it, or by the one agent it asked. */
function useQuoteAuthor(run: Run | null | undefined, self: Agent | undefined, agents: Agent[]): QuoteAuthor | undefined {
  const others = agents.filter((a) => a.id !== self?.id);
  const asked = [...new Set((run?.steps ?? []).map((s) => /^Asked (.+) for help$/.exec(s.summary)?.[1]).filter(Boolean))];
  const key = agents.map((a) => `${a.id}:${a.name}:${a.color}`).join("|") + "#" + (self?.id ?? "") + "#" + asked.join("|");
  return useCallback<QuoteAuthor>(
    (intro, depth) => {
      let best: { agent: Agent; at: number } | null = null;
      // A quote inside a quote can be this agent's own report, passed back through another agent.
      for (const a of depth ? agents : others) {
        const re = new RegExp(`\\b${escapeRe(a.name)}\\b`, "g");
        for (const m of intro.matchAll(re)) if (!best || m.index! > best.at) best = { agent: a, at: m.index! };
      }
      const agent = best?.agent ?? (!depth && asked.length === 1 ? others.find((a) => a.name === asked[0]) : undefined);
      return agent ? { name: agent.name, color: agent.color } : null;
    },
    // `key` stands for the agents and steps read above, so settled replies don't re-render their markdown on every event.
    [key],
  );
}

function AgentEntry({
  entry,
  agent,
  agents,
  live,
  recoverable,
  onCancel,
  onRecover,
  onSettled,
  readOnly,
}: {
  entry: DiaryEntry;
  agent?: Agent;
  /** The demo: nothing to stop or retry. */
  readOnly?: boolean;
  agents: Agent[];
  live: boolean;
  /** This is the latest reply and nothing is running, so a failed one can be tried again. */
  recoverable: boolean;
  onCancel(runId: string): void;
  onRecover?(entry: DiaryEntry, run: Run, how: Recovery): void;
  onSettled?(id: string): void;
}) {
  const navigate = useNavigate();
  const { data: run } = useRun(entry.runId);
  const color = agent?.color ?? "var(--ink-soft)";
  const streaming = isActiveRun(run);
  const split = splitFailure(entry.text, run);
  const { text, status } = tidyReply(split.text, run);
  const quoteBy = useQuoteAuthor(run, agent, agents);
  const { data: graph } = useMap();
  const kids = run ? childRuns(graph?.runs, run.id) : [];
  const [settled, setSettled] = useState(!live);
  // Only a finished reply is signed: a failed or stopped one isn't the agent's answer.
  const signed = run ? run.status === "succeeded" || streaming : !entry.runId;
  const how = run?.status === "failed" ? runRecovery(run.error) : null;
  let note: ReactNode = null;
  if (run?.status === "cancelled")
    note = (
      <span className="step-note-text">
        <WorkNote run={run} agents={agents} />
      </span>
    );
  else if (split.note)
    note = (
      <>
        <span className="step-note-text">{run ? <WorkNote run={run} agents={agents} reason={split.note} /> : split.note}</span>
        {how && recoverable && onRecover && (
          <button type="button" className="link-button recover" onClick={() => onRecover(entry, run!, how)}>
            <RotateCcw size={12} aria-hidden /> {how === "retry" ? COPY.tryAgain : COPY.carryOn}
          </button>
        )}
      </>
    );
  return (
    <div className="entry entry-agent" style={{ ["--agent" as string]: color }} data-outcome={run?.status}>
      {text ? (
        <InkWriter
          key={live ? "live" : "still"}
          id={entry.id}
          text={text}
          color={color}
          live={live}
          streaming={streaming && live}
          quoteBy={quoteBy}
          onSettled={() => {
            setSettled(true);
            onSettled?.(entry.id);
          }}
          onClick={(e) => {
            // Page links in replies open in-app.
            const a = (e.target as HTMLElement).closest("a");
            const href = a?.getAttribute("href");
            if (href?.startsWith("/") && !href.startsWith("//") && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              navigate(href);
            }
          }}
        />
      ) : (
        streaming && (
          <p className="gathering" role="status">
            <InkDrops color={color} />
            <span className="gathering-label">
              <span className="agent-name">{agent?.name ?? "The agent"}</span> is on it…
            </span>
          </p>
        )
      )}
      {text && signed && (
        <div className="reply-meta">
          {/* Which Meta model wrote this: quiet provenance, shown once the reply is done. */}
          {entry.runId && (
            <span className="provenance" data-show={settled && !streaming}>
              {provenance(run, agent?.model)}
            </span>
          )}
          {agent && (
            <span className="signature" data-show={settled}>
              {agent.name}
            </span>
          )}
        </div>
      )}
      {run && (
        <Steps
          run={run}
          agent={agent}
          note={note}
          status={(streaming && waitingFor(kids, (id) => agents.find((a) => a.id === id)?.name)) || status}
          onCancel={readOnly ? undefined : () => onCancel(run.id)}
          handoffs={kids.length ? <Handoffs run={run} agents={agents} /> : undefined}
        />
      )}
      {!run && entry.pageIds.length > 0 && <Touched ids={entry.pageIds} />}
    </div>
  );
}

/** The person's words appearing as if written just now (the demo plays requests this way). */
function WrittenIn({ text }: { text: string }) {
  let w = 0;
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="written-in">
        {text.split(/(\s+)/).map((part, i) =>
          /^\s+$/.test(part) || !part ? (
            part
          ) : (
            <span key={i} className="written-word" style={{ ["--i" as string]: Math.min(w++, 60) }}>
              {part}
            </span>
          ),
        )}
      </span>
    </>
  );
}

function PersonEntry({ entry, fresh }: { entry: DiaryEntry; fresh?: boolean }) {
  return (
    <div className="entry entry-person" data-fresh={fresh || undefined}>
      {entry.attachments.length > 0 && (
        <ul className="entry-attachments" aria-label="Attached">
          {entry.attachments.map((a) =>
            a.kind === "image" ? (
              <li key={a.id}>
                <img src={a.url} alt={a.name} />
              </li>
            ) : (
              <li key={a.id}>
                <audio controls src={a.url} aria-label={a.name} />
              </li>
            ),
          )}
        </ul>
      )}
      <p className="person-text">{fresh ? <WrittenIn text={entry.text} /> : entry.text}</p>
    </div>
  );
}

export function Entries({
  entries,
  agents,
  liveIds,
  hiddenId,
  recoverableId,
  freshIds,
  readOnly,
  onCancel,
  onRecover,
  onSettled,
}: {
  entries: DiaryEntry[];
  /** The person's entries that should appear as if written now (the demo). */
  freshIds?: string[];
  /** The demo notebook: replies can't be stopped or retried. */
  readOnly?: boolean;
  agents: Agent[];
  liveIds: string[];
  hiddenId: string | null;
  /** The reply that can offer "Try again" (the latest, while nothing runs). */
  recoverableId?: string | null;
  onCancel(runId: string): void;
  onRecover?(entry: DiaryEntry, run: Run, how: Recovery): void;
  onSettled?(id: string): void;
}) {
  let lastDay = "";
  return (
    <ol className="entries" aria-label="Conversation">
      {entries.map((e) => {
        if (e.id === hiddenId) return null;
        const day = dayLabel(e.createdAt);
        const showDay = day !== lastDay;
        lastDay = day;
        return (
          <Fragment key={e.id}>
            {showDay && (
              <li className="day" aria-hidden>
                {day}
              </li>
            )}
            <li>
              {e.role === "agent" ? (
                <AgentEntry
                  key={liveIds.includes(e.id) ? "live" : "still"}
                  entry={e}
                  agent={agents.find((a) => a.id === e.agentId)}
                  agents={agents}
                  live={liveIds.includes(e.id)}
                  recoverable={e.id === recoverableId}
                  onCancel={onCancel}
                  onRecover={onRecover}
                  onSettled={onSettled}
                  readOnly={readOnly}
                />
              ) : (
                <PersonEntry entry={e} fresh={freshIds?.includes(e.id)} />
              )}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
