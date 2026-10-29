import { memo } from "react";
import type { Link } from "@shared/types";
import { linkPath, type Box, type MapLayout } from "./layout";
import css from "./map.module.css";

const PAD = 900;

/** The SVG canvas that covers the territory, in world units, with room around the edges. */
export function worldFrame(bounds: Box) {
  const x = bounds.x - PAD;
  const y = bounds.y - PAD;
  const w = bounds.w + PAD * 2;
  const h = bounds.h + PAD * 2;
  return { x, y, w, h, viewBox: `${x} ${y} ${w} ${h}` };
}

/**
 * What's drawn on the parchment itself, under the rooms: the wings of the
 * map, the roads between linked pages, and a compass rose in the corner.
 */
export const WorldBack = memo(function WorldBack({ layout, links }: { layout: MapLayout; links: Link[] }) {
  const f = worldFrame(layout.bounds);
  const b = layout.bounds;
  const roads = [];
  for (const l of links) {
    const a = layout.cards.get(l.from);
    const z = layout.cards.get(l.to);
    if (!a || !z || l.from === l.to) continue;
    roads.push(<path key={`${l.from}>${l.to}`} d={linkPath(a, z)} className={css.road} />);
  }
  const rose = Math.max(220, Math.min(520, Math.min(b.w, b.h) * 0.16));
  return (
    <svg
      className={css.worldSvg}
      style={{ left: f.x, top: f.y, width: f.w, height: f.h }}
      viewBox={f.viewBox}
      aria-hidden
    >
      {layout.regions.map((r) => (
        <g key={r.id}>
          <rect className={css.region} x={r.x} y={r.y} width={r.w} height={r.h} rx={10} />
          <rect
            className={css.regionEdge}
            x={r.x + 12}
            y={r.y + 12}
            width={Math.max(0, r.w - 24)}
            height={Math.max(0, r.h - 24)}
            rx={4}
          />
        </g>
      ))}
      <g className={css.roads}>{roads}</g>
      {layout.regions.length > 0 && <Compass x={b.x + b.w + rose * 0.85} y={b.y + rose * 0.55} r={rose / 2} />}
    </svg>
  );
});

/** An eight-point compass rose. Drawn, not an icon: it's part of the map. */
function Compass({ x, y, r }: { x: number; y: number; r: number }) {
  const pts = (len: number, half: number, rot: number) => {
    const out: string[] = [];
    for (let i = 0; i < 4; i++) {
      const a = ((rot + i * 90) * Math.PI) / 180;
      const tip = [Math.sin(a) * len, -Math.cos(a) * len];
      const l = [Math.sin(a - Math.PI / 2) * half, -Math.cos(a - Math.PI / 2) * half];
      const rr = [Math.sin(a + Math.PI / 2) * half, -Math.cos(a + Math.PI / 2) * half];
      out.push(`M${l[0].toFixed(1)},${l[1].toFixed(1)} L${tip[0].toFixed(1)},${tip[1].toFixed(1)} L${rr[0].toFixed(1)},${rr[1].toFixed(1)} Z`);
    }
    return out.join(" ");
  };
  const halves = (len: number, half: number) => {
    // The shaded half of each main point, for the engraved look.
    const out: string[] = [];
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const tip = [Math.sin(a) * len, -Math.cos(a) * len];
      const l = [Math.sin(a - Math.PI / 2) * half, -Math.cos(a - Math.PI / 2) * half];
      out.push(`M0,0 L${l[0].toFixed(1)},${l[1].toFixed(1)} L${tip[0].toFixed(1)},${tip[1].toFixed(1)} Z`);
    }
    return out.join(" ");
  };
  return (
    <g className={css.compass} transform={`translate(${x.toFixed(0)} ${y.toFixed(0)})`}>
      <circle r={r * 0.78} className={css.compassRing} />
      <circle r={r * 0.7} className={css.compassRingThin} />
      <path d={pts(r * 0.62, r * 0.08, 45)} className={css.compassMinor} />
      <path d={pts(r, r * 0.13, 0)} className={css.compassMajor} />
      <path d={halves(r, r * 0.13)} className={css.compassShade} />
      <text y={-r - r * 0.12} className={css.compassN} style={{ fontSize: r * 0.3 }}>
        N
      </text>
    </g>
  );
}
