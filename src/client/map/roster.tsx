import type { CSSProperties } from "react";
import type { Id, Page } from "@shared/types";
import { agentStatuses, type MapState, type Walker } from "./model";
import { inkOf } from "./walkers";
import { titleOf } from "./util";
import css from "./map.module.css";

/**
 * Who's out: every agent and person on the map, what they're doing and
 * where. Click one to fly to them.
 */
export function Roster({
  state,
  narrow,
  onFollow,
}: {
  state: MapState;
  narrow: boolean;
  onFollow(pageId: Id): void;
}) {
  const page = (id: Id | null | undefined): Page | undefined => (id ? state.pages.get(id) : undefined);
  const agents = agentStatuses(state);
  const people = [...state.walkers.values()].filter((w) => w.kind === "person");
  if (!agents.length && !people.length) return null;

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
        {!narrow && <span className={css.chipLine}>{line}</span>}
      </button>
    </li>
  );

  return (
    <nav className={css.roster} data-map-control aria-label="Who's out on the map">
      <ul>
        {agents.map(({ agent, walker, working }) => {
          const where = page(walker?.pageId);
          const doing = walker?.action && walker.action !== "idle" ? walker.action : working ? "working" : "";
          const line = working
            ? `${doing || "working"}${where ? ` in ${titleOf(where)}` : ""}`
            : where
              ? `idle by ${titleOf(where)}`
              : "not out yet";
          return chip(agent.id, { kind: "agent", id: agent.id, color: agent.color }, agent.name, line, walker?.pageId ?? null, working);
        })}
        {people.map((w) => {
          const where = page(w.pageId);
          return chip(w.key, w, w.name, where ? `in ${titleOf(where)}` : "elsewhere", w.pageId, false);
        })}
      </ul>
    </nav>
  );
}
