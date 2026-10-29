import { hash } from "./footprints";
import type { Box } from "./layout";

/**
 * Hand-drawn geometry for the parchment: lines that bow a little, corners
 * where the pen ran past, never the same twice but the same every time for
 * the same room. Everything is in world units.
 */

/** A small seeded random source, so a room is always drawn the same way. */
export function seeded(seed: string): () => number {
  let s = hash(seed) || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number) => (Math.round(n * 10) / 10).toString();

export interface InkRectOptions {
  /** How far the pen runs past each corner. */
  over?: number;
  /** How far a side bows away from straight, at most. */
  bow?: number;
  /** How far each corner wanders. */
  wander?: number;
}

/**
 * A rectangle drawn by hand: four strokes, each starting and ending a touch
 * past its corners and bowing slightly, in the order a pen would go round.
 */
export function inkRect(b: Box, seed: string, opts: InkRectOptions = {}): string {
  const rand = seeded(seed);
  const over = opts.over ?? 6;
  const bow = opts.bow ?? Math.min(4, Math.min(b.w, b.h) * 0.02);
  const wander = opts.wander ?? 1.5;
  const j = () => (rand() - 0.5) * 2 * wander;
  // Corners, clockwise from top-left, each nudged a little.
  const c = [
    { x: b.x + j(), y: b.y + j() },
    { x: b.x + b.w + j(), y: b.y + j() },
    { x: b.x + b.w + j(), y: b.y + b.h + j() },
    { x: b.x + j(), y: b.y + b.h + j() },
  ];
  let d = "";
  for (let i = 0; i < 4; i++) {
    const a = c[i];
    const z = c[(i + 1) % 4];
    const len = Math.hypot(z.x - a.x, z.y - a.y) || 1;
    const ux = (z.x - a.x) / len;
    const uy = (z.y - a.y) / len;
    // Run past both ends by a slightly different amount each.
    const o1 = over * (0.3 + rand() * 0.9);
    const o2 = over * (0.3 + rand() * 0.9);
    const sx = a.x - ux * o1;
    const sy = a.y - uy * o1;
    const ex = z.x + ux * o2;
    const ey = z.y + uy * o2;
    // Bow sideways, either way.
    const k = (rand() - 0.5) * 2 * bow;
    const mx = (sx + ex) / 2 - uy * k;
    const my = (sy + ey) / 2 + ux * k;
    d += `M${f(sx)},${f(sy)}Q${f(mx)},${f(my)} ${f(ex)},${f(ey)}`;
  }
  return d;
}

/** Grow (or with a negative amount, shrink) a box on every side. */
export const grow = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, w: Math.max(0, b.w + by * 2), h: Math.max(0, b.h + by * 2) });

/**
 * When each thing inks itself in during the reveal: nearer the middle of the
 * map first, out to the edges by `span` ms.
 */
export function inkDelay(b: Box, centre: { x: number; y: number }, reach: number, span: number): number {
  const d = Math.hypot(b.x + b.w / 2 - centre.x, b.y + b.h / 2 - centre.y);
  return Math.round(Math.min(1, d / Math.max(1, reach)) * span);
}

/**
 * The hand-drawn double frame round a note, as a CSS mask image. Stretched
 * to the card; the strokes keep their width (non-scaling) at any size.
 */
export function noteFrame(w = 300, h = 250): string {
  const outer = inkRect({ x: 5, y: 5, w: w - 10, h: h - 10 }, "note-frame", { over: 4, bow: 2.2, wander: 1.2 });
  const inner = inkRect({ x: 10, y: 10, w: w - 20, h: h - 20 }, "note-frame-in", { over: 3, bow: 1.8, wander: 1 });
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' preserveAspectRatio='none'>` +
    `<g fill='none' stroke='black' stroke-linecap='round' vector-effect='non-scaling-stroke'>` +
    `<path d='${outer}' stroke-width='1.3' vector-effect='non-scaling-stroke'/>` +
    `<path d='${inner}' stroke-width='0.75' stroke-opacity='0.7' vector-effect='non-scaling-stroke'/>` +
    `</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
