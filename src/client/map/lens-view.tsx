import { memo, type CSSProperties } from "react";
import { ArrowLeft } from "lucide-react";
import type { Agent } from "@shared/types";
import { LENS_HEAD_H, type LensLayout } from "./lens";
import css from "./map.module.css";

/** Where a group's rule (columns) or the timeline's axis runs, world units. */
const ruleY = (lens: LensLayout) => (lens.groups[0]?.y ?? lens.head.y + lens.head.h) + LENS_HEAD_H - 30;
const r = (n: number) => Math.round(n * 10) / 10;

/**
 * The lens's lines, drawn under the cards in world units: a rule under each
 * group (columns) or one axis through the groups in order (timeline), and a
 * thread each column of cards hangs from. They draw themselves in once the cards have started to fly.
 */
export const LensBack = memo(function LensBack({ lens }: { lens: LensLayout }) {
  const y = ruleY(lens);
  // Each column of cards hangs on one thread from its group's rule, seen in the gaps between the cards.
  const columns = new Map<number, { x: number; y: number }>();
  for (const b of lens.cards.values()) {
    const cx = b.x + b.w / 2;
    const c = columns.get(cx);
    if (!c || b.y > c.y) columns.set(cx, { x: cx, y: b.y + b.h / 2 });
  }
  const threads = [...columns.values()].map((c, i) => (
    <path key={`t${i}`} d={`M${r(c.x)},${y} L${r(c.x)},${r(c.y)}`} pathLength={1} style={{ "--i": i } as CSSProperties} />
  ));
  if (lens.kind === "timeline") {
    const first = lens.groups[0];
    const last = lens.groups[lens.groups.length - 1];
    if (!first || !last) return null;
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
      {lens.groups.map((g) => (
        <path key={g.index} d={`M${g.x},${y} L${g.x + g.w},${y}`} pathLength={1} style={{ "--i": g.index } as CSSProperties} />
      ))}
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
          style={{ "--x": g.x + (lens.kind === "timeline" ? 22 : 0), "--y": g.y, "--w": g.w - (lens.kind === "timeline" ? 22 : 0), "--i": g.index } as CSSProperties}
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
