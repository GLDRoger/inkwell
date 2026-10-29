import { Fragment } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Footprints, Map as MapIcon, Square, TriangleAlert } from "lucide-react";
import type { Agent, DiaryEntry, Run } from "@shared/types";
import { useRun } from "../lib/queries";
import { InkWriter } from "./InkWriter";

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

/** The agent's footsteps through your pages, under its reply. */
export function Steps({ run, agent, onCancel }: { run: Run; agent?: Agent; onCancel?(): void }) {
  const active = isActiveRun(run);
  if (!run.steps.length && !active && run.status !== "failed" && run.status !== "cancelled") return null;
  return (
    <div className="steps" style={{ ["--agent" as string]: agent?.color ?? "var(--wax)" }}>
      {run.steps.length > 0 && (
        <ol aria-label={`${agent?.name ?? "The agent"}'s steps`}>
          {run.steps.map((s, i) => (
            <li key={`${s.at}-${i}`} className="step" data-ok={s.ok}>
              <Footprints size={13} aria-hidden className="step-feet" />
              <span className="step-summary">
                {s.pageId ? <Link to={`/p/${s.pageId}`}>{s.summary}</Link> : s.summary}
                {!s.ok && <span className="sr-only"> (failed)</span>}
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
          {run.status === "queued" ? "Getting ready…" : run.steps.length ? "Still walking…" : "Setting off…"}
          {onCancel && (
            <button type="button" className="link-button" onClick={onCancel}>
              <Square size={11} aria-hidden /> Stop
            </button>
          )}
        </p>
      )}
      {run.status === "failed" && (
        <p className="step-status step-failed" role="status">
          <TriangleAlert size={13} aria-hidden /> {run.error ?? "Stopped with an error."}
        </p>
      )}
      {run.status === "cancelled" && <p className="step-status">Stopped.</p>}
    </div>
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
  const client = useQueryClient();
  const navigate = useNavigate();
  const { data: run } = useRun(entry.runId, client);
  const color = agent?.color ?? "var(--wax)";
  const streaming = isActiveRun(run);
  return (
    <div className="entry entry-agent">
      <InkWriter
        text={entry.text}
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
      {agent && entry.text && <p className="signature" style={{ color }}>{agent.name}</p>}
      {run && <Steps run={run} agent={agent} onCancel={() => onCancel(run.id)} />}
      {!run && entry.pageIds.length > 0 && (
        <p className="touched">
          {entry.pageIds.map((id) => (
            <Link key={id} to={`/?focus=${id}`} className="step-map">
              <MapIcon size={13} aria-hidden /> See it on the map
            </Link>
          ))}
        </p>
      )}
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
