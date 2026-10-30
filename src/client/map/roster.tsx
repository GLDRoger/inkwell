import type { CSSProperties } from "react";
import type { Id, Page } from "@shared/types";
import { agentStatuses, type MapState, type Walker } from "./model";
import { inkOf } from "./walkers";
import { titleOf } from "./util";
import css from "./map.module.css";

/** What a working agent is doing, in a few words. */
export function workingLine(action: Walker["action"], where: Page | undefined): string {
  const t = where ? titleOf(where) : "";
  if (action === "reading") return t ? `reading ${t}` : "reading";
  if (action === "writing") return t ? `writing in ${t}` : "writing";
  return t ? `working in ${t}` : "working";
}

/**
 * Who's out: every agent and person on the map, what they're doing and
 * where. Click one to fly to them.
 */
export function Roster({
  state,
  narrow,
  room,
  onFollow,
}: {
  state: MapState;
  narrow: boolean;
  /** Width the row has, px: when every chip's line won't fit, they show names only. */
  room: number;
  onFollow(pageId: Id): void;
}) {
  const page = (id: Id | null | undefined): Page | undefined => (id ? state.pages.get(id) : undefined);
  const agents = agentStatuses(state);
  const people = [...state.walkers.values()].filter((w) => w.kind === "person");
  if (!agents.length && !people.length) return null;
  const rows = [
    ...agents.map(({ agent, walker, working: running }) => {
      // A walker seen reading or writing is at work, even before its run's update arrives.
      const working = running || (!!walker && walker.action !== "idle");
      const where = page(walker?.pageId);
      const line = working ? workingLine(walker?.action ?? "thinking", where) : where ? `resting at ${titleOf(where)}` : "hasn't set out yet";
      return { key: agent.id, w: { kind: "agent" as const, id: agent.id, color: agent.color }, name: agent.name, line, pageId: walker?.pageId ?? null, working };
    }),
    ...people.map((w) => {
      const where = page(w.pageId);
      return { key: w.key, w, name: w.name, line: where ? `in ${titleOf(where)}` : "elsewhere", pageId: w.pageId, working: false };
    }),
  ];
  // About how wide each chip is with its line (lines cap at 260px).
  const full = rows.reduce((n, r) => n + 6 + 40 + r.name.length * 7.6 + Math.min(260, 12 + r.line.length * 6.3), 0);
  const short = narrow || full > room;

  const chip = (key: string, w: Pick<Walker, "kind" | "id" | "color">, name: string, line: string, pageId: Id | null, working: boolean) => (
    <li key={key}>
      <button
        type="button"
        className={css.chip}
        data-working={working || undefined}
        data-kind={w.kind}
        disabled={!pageId || !state.pages.has(pageId)}
        style={{ "--who": inkOf(w) } as CSSProperties}
        onClick={() => pageId && onFollow(pageId)}
        aria-label={`${name}: ${line}${pageId ? ". Show on the map." : ""}`}
        title={`${name}: ${line}`}
      >
        <span className={css.chipDot} aria-hidden />
        <span className={css.chipName}>{name}</span>
        {!short && (
          <span className={css.chipLine}>
            <span aria-hidden> · </span>
            {line}
          </span>
        )}
      </button>
    </li>
  );

  return (
    <nav className={css.roster} data-map-control aria-label="Who's out on the map">
      <ul>
        {rows.map((r) => chip(r.key, r.w, r.name, r.line, r.pageId, r.working))}
      </ul>
    </nav>
  );
}
