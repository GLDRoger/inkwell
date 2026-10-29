import { Fragment, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Footprints, Map as MapIcon, Square } from "lucide-react";
import type { Agent, DiaryEntry, Run } from "@shared/types";
import { pageTitle, usePages, useRun } from "../lib/queries";
import { InkWriter } from "./InkWriter";
import { splitFailure } from "./reply";

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
export function Steps({ run, agent, note, onCancel }: { run: Run; agent?: Agent; note?: string | null; onCancel?(): void }) {
  const active = isActiveRun(run);
  const n = run.steps.length;
  const [open, setOpen] = useState<boolean | null>(null);
  const shown = open ?? (active || n <= 3);
  if (!n && !active && !note) return null;
  const listId = `steps-${run.id}`;
  return (
    <div className="steps" style={{ ["--agent" as string]: agent?.color ?? "var(--wax)" }}>
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
      {active && (
        <p className="step-status">
          <span className="walking" aria-hidden />
          {run.status === "queued" ? "Getting ready…" : n ? "Still walking…" : "Setting off…"}
          {onCancel && (
            <button type="button" className="link-button" onClick={onCancel}>
              <Square size={11} aria-hidden /> Stop
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

function AgentEntry({
  entry,
  agent,
  live,
  onCancel,
}: {
  entry: DiaryEntry;
  agent?: Agent;
  live: boolean;
  onCancel(runId: string): void;
}) {
  const navigate = useNavigate();
  const { data: run } = useRun(entry.runId);
  const color = agent?.color ?? "var(--wax)";
  const streaming = isActiveRun(run);
  const { text, note } = splitFailure(entry.text, run);
  return (
    <div className="entry entry-agent" style={{ ["--agent" as string]: color }}>
      {text ? (
        <InkWriter
          text={text}
          color={color}
          live={live}
          streaming={streaming && live}
          onClick={(e) => {
            // Page links in replies open in-app.
            const a = (e.target as HTMLElement).closest("a");
            const href = a?.getAttribute("href");
            if (href?.startsWith("/")) {
              e.preventDefault();
              navigate(href);
            }
          }}
        />
      ) : (
        streaming && (
          <p className="gathering" role="status">
            <InkDrops color={color} />
            <span className="sr-only">{agent?.name ?? "The agent"} is answering</span>
          </p>
        )
      )}
      {agent && text && <p className="signature">{agent.name}</p>}
      {run && <Steps run={run} agent={agent} note={note} onCancel={() => onCancel(run.id)} />}
      {!run && entry.pageIds.length > 0 && <Touched ids={entry.pageIds} />}
    </div>
  );
}

function PersonEntry({ entry }: { entry: DiaryEntry }) {
  return (
    <div className="entry entry-person">
      {entry.attachments.length > 0 && (
        <ul className="entry-attachments">
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
      <p className="person-ink">{entry.text}</p>
    </div>
  );
}

export function Entries({
  entries,
  agents,
  liveIds,
  hiddenId,
  onCancel,
}: {
  entries: DiaryEntry[];
  agents: Agent[];
  liveIds: string[];
  hiddenId: string | null;
  onCancel(runId: string): void;
}) {
  let lastDay = "";
  return (
    <ol className="entries" aria-label="Diary entries">
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
                <AgentEntry entry={e} agent={agents.find((a) => a.id === e.agentId)} live={liveIds.includes(e.id)} onCancel={onCancel} />
              ) : (
                <PersonEntry entry={e} />
              )}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
