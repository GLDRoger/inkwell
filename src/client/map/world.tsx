import { memo, type CSSProperties } from "react";
import type { Link } from "@shared/types";
import { grow, inkDelay, inkRect } from "./ink";
import { linkPath, type Box, type MapLayout } from "./layout";
import css from "./map.module.css";

const PAD = 900;
/** How far out from the territory the map's own border is drawn. */
const BORDER = 260;
/** The reveal draws outwards from the middle over this long (ms), then each line takes DRAW_MS. */
export const INK_SPAN_MS = 1300;

/** The SVG canvas that covers the territory, in world units, with room around the edges. */
export function worldFrame(bounds: Box) {
  const x = bounds.x - PAD;
  const y = bounds.y - PAD;
  const w = bounds.w + PAD * 2;
  const h = bounds.h + PAD * 2;
  return { x, y, w, h, viewBox: `${x} ${y} ${w} ${h}` };
}

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

/**
 * What's drawn on the parchment itself, under the cards: the border of the
 * sheet, the walls of each wing, a room for every page, the dotted paths
 * between linked pages, and a compass rose. All hand-drawn, all in ink.
 * Every stroke can draw itself in, nearest the middle first (the reveal).
 */
export const WorldBack = memo(function WorldBack({ layout, links, born }: { layout: MapLayout; links: Link[]; born: ReadonlySet<string> }) {
  const f = worldFrame(layout.bounds);
  const b = layout.bounds;
  const centre = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const reach = Math.hypot(b.w, b.h) / 2;

  // One path per kind of stroke per wing, not one per page: a few dozen
  // elements to rasterise on each zoom, however big the notebook. Within a
  // wing the pen goes round its rooms one after another as it draws in.
  const roads = [];
  for (const l of links) {
    const a = layout.cards.get(l.from);
    const z = layout.cards.get(l.to);
    if (!a || !z || l.from === l.to) continue;
    roads.push(<path key={`${l.from}>${l.to}`} d={linkPath(a, z)} className={css.road} />);
  }
  const rooms = new Map<string, { rooms: string; hubs: string }>();
  const newborn = [];
  for (const c of layout.cards.values()) {
    const d = inkRect(c, c.id, { over: 7, bow: 3 });
    if (born.has(c.id)) {
      newborn.push(<path key={c.id} d={d} pathLength={1} className={`${css.draw} ${c.depth === 0 ? css.hubRoom : css.room}`} data-born />);
      continue;
    }
    const r = rooms.get(c.regionId) ?? { rooms: "", hubs: "" };
    if (c.depth === 0) r.hubs += d;
    else r.rooms += d;
    rooms.set(c.regionId, r);
  }

  const rose = Math.max(220, Math.min(520, Math.min(b.w, b.h) * 0.16));
  const sheet = grow(b, BORDER);
  return (
    <svg
      className={css.worldSvg}
      style={{ left: f.x, top: f.y, width: f.w, height: f.h }}
      viewBox={f.viewBox}
      aria-hidden
    >
      {layout.regions.length > 0 && (
        <g className={css.sheetEdge}>
          <path d={inkRect(sheet, "sheet", { over: 22, bow: 10, wander: 4 })} pathLength={1} className={css.draw} style={delay(0)} />
          <path d={inkRect(grow(sheet, -18), "sheet-in", { over: 12, bow: 8, wander: 3 })} pathLength={1} className={`${css.draw} ${css.thin}`} style={delay(120)} />
        </g>
      )}
      {layout.regions.map((r) => {
        const ms = inkDelay(r, centre, reach, INK_SPAN_MS);
        return (
          <g key={r.id} className={css.wing}>
            <rect className={css.wingFloor} x={r.x} y={r.y} width={r.w} height={r.h} />
            <path d={inkRect(r, `wall:${r.id}`, { over: 14, bow: 6 })} pathLength={1} className={`${css.draw} ${css.wall}`} style={delay(ms)} />
            <path
              d={inkRect(grow(r, -11), `wall-in:${r.id}`, { over: 8, bow: 5 })}
              pathLength={1}
              className={`${css.draw} ${css.wallInner}`}
              style={delay(ms + 160)}
            />
          </g>
        );
      })}
      <g className={css.roads} style={delay(INK_SPAN_MS * 0.6)}>
        {roads}
      </g>
      <g className={css.rooms}>
        {layout.regions.map((r) => {
          const inside = rooms.get(r.id);
          if (!inside) return null;
          const ms = inkDelay(r, centre, reach, INK_SPAN_MS) + 120;
          return (
            <g key={r.id}>
              {inside.hubs && <path d={inside.hubs} pathLength={1} className={`${css.draw} ${css.hubRoom}`} style={delay(ms)} />}
              {inside.rooms && <path d={inside.rooms} pathLength={1} className={`${css.draw} ${css.room} ${css.slow}`} style={delay(ms + 80)} />}
            </g>
          );
        })}
        {newborn}
      </g>
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
