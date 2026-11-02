import { memo, type CSSProperties } from "react";
import { ArrowLeft } from "lucide-react";
import type { Agent } from "@shared/types";
import { LENS_HEAD_H, type LensLayout } from "./lens";
import css from "./map.module.css";

/** Where a group's rule sits (and its threads start), world units below the group's top. */
const RULE_AT = LENS_HEAD_H - 30;
const r = (n: number) => Math.round(n * 10) / 10;

/**
 * The lens's lines, drawn under the cards in world units: the timeline's axis
 * through the groups in order, and a thread each column of cards hangs from,
 * seen in the gaps between the cards. (A column's rule is drawn with its label,
 * in LensLabels, so it always sits under the label's text at any zoom.) They
 * draw themselves in once the cards have started to fly.
 */
export const LensBack = memo(function LensBack({ lens }: { lens: LensLayout }) {
  // Each column of cards hangs on one thread from its group's rule.
  const columns = new Map<string, { x: number; top: number; y: number }>();
  for (const b of lens.cards.values()) {
    const cx = b.x + b.w / 2;
    const g = lens.groups.find((g) => cx >= g.x && cx <= g.x + g.w && b.y >= g.y && b.y <= g.y + g.h);
    if (!g) continue;
    const key = `${g.index}:${cx}`;
    const c = columns.get(key);
    if (!c || b.y > c.y) columns.set(key, { x: cx, top: g.y + RULE_AT, y: b.y + b.h / 2 });
  }
  const threads = [...columns.values()].map((c, i) => (
    <path key={`t${i}`} d={`M${r(c.x)},${r(c.top)} L${r(c.x)},${r(c.y)}`} pathLength={1} style={{ "--i": i } as CSSProperties} />
  ));
  if (lens.kind === "timeline") {
    const first = lens.groups[0];
    const last = lens.groups[lens.groups.length - 1];
    if (!first || !last) return null;
    const y = first.y + RULE_AT;
    const x0 = first.x;
    const x1 = last.x + last.w + 40;
    return (
      <g className={css.lensLines} data-kind="timeline">
        <path d={`M${x0},${y} L${x1},${y}`} pathLength={1} />
        <path d={`M${x1 - 14},${y - 9} L${x1},${y} L${x1 - 14},${y + 9}`} pathLength={1} />
        {lens.groups.map((g) => (
          <circle key={g.index} cx={g.x + 6} cy={y} r={6} style={{ "--i": g.index } as CSSProperties} />
        ))}
        {threads}
      </g>
    );
  }
  return (
    <g className={css.lensLines} data-kind="columns">
      {threads}
    </g>
  );
});

/** The question and each group's label, written on the map like area names, but in full ink. */
export const LensLabels = memo(function LensLabels({ lens }: { lens: LensLayout }) {
  return (
    <>
      <div className={css.lensTitle} style={{ "--x": lens.head.x, "--y": lens.head.y + 24, "--w": lens.head.w } as CSSProperties}>
        {lens.title}
      </div>
      {lens.groups.map((g) => (
        <div
          key={g.index}
          className={css.lensGroup}
          data-kind={lens.kind}
          style={{ "--x": g.x + (lens.kind === "timeline" ? 22 : 0), "--y": g.y, "--w": g.w - (lens.kind === "timeline" ? 22 : 0), "--rule": RULE_AT, "--i": g.index } as CSSProperties}
        >
          <span className={css.lensLabel}>
            {g.label}
            <span className={css.lensCount}>{g.count === 1 ? "1 page" : `${g.count} pages`}</span>
          </span>
          {g.note && <span className={css.lensNote}>{g.note}</span>}
          {!g.count && <span className={css.lensNote}>Nothing here yet</span>}
        </div>
      ))}
    </>
  );
});

/** The control for a lens: who arranged it, and the way back. */
export function LensBar({ lens, agent, onBack }: { lens: LensLayout; agent: Agent | null; onBack(): void }) {
  return (
    <div className={css.lensBar} role="region" aria-label={`Lens: ${lens.title}`} data-map-control>
      <span className={css.lensBy}>
        {agent ? (
          <>
            Arranged by{" "}
            <b style={{ "--who": agent.color } as CSSProperties} className={css.lensWho}>
              {agent.name}
            </b>
          </>
        ) : (
          "Arranged for your question"
        )}
      </span>
      <button type="button" className={css.lensBack} onClick={onBack} aria-keyshortcuts="Escape">
        <ArrowLeft size={15} strokeWidth={1.75} aria-hidden />
        Back to map
      </button>
    </div>
  );
}
