import { memo } from "react";
import type { Link } from "@shared/types";
import { linkPath, type Box, type MapLayout } from "./layout";
import css from "./map.module.css";

const PAD = 900;
/** The map's first-visit reveal spreads outwards from the middle over this long, ms. */
export const INK_SPAN_MS = 1100;

/** The SVG canvas that covers the territory, in world units, with room around the edges. */
export function worldFrame(bounds: Box) {
  const x = bounds.x - PAD;
  const y = bounds.y - PAD;
  const w = bounds.w + PAD * 2;
  const h = bounds.h + PAD * 2;
  return { x, y, w, h, viewBox: `${x} ${y} ${w} ${h}` };
}

/**
 * When each thing appears during the reveal: nearer the middle of the map
 * first, out to the edges by `span` ms.
 */
export function inkDelay(b: Box, centre: { x: number; y: number }, reach: number, span: number): number {
  const d = Math.hypot(b.x + b.w / 2 - centre.x, b.y + b.h / 2 - centre.y);
  return Math.round(Math.min(1, d / Math.max(1, reach)) * span);
}

/**
 * What's drawn under the cards: a quiet line between each pair of linked
 * pages. One path per link, a few dozen elements however big the notebook.
 */
export const WorldBack = memo(function WorldBack({ layout, links }: { layout: MapLayout; links: Link[] }) {
  const f = worldFrame(layout.bounds);
  const roads = [];
  for (const l of links) {
    const a = layout.cards.get(l.from);
    const z = layout.cards.get(l.to);
    if (!a || !z || l.from === l.to) continue;
    roads.push(<path key={`${l.from}>${l.to}`} d={linkPath(a, z)} />);
  }
  return (
    <svg className={css.worldSvg} style={{ left: f.x, top: f.y, width: f.w, height: f.h }} viewBox={f.viewBox} aria-hidden>
      <g className={css.links}>{roads}</g>
    </svg>
  );
});
