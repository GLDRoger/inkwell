import type { Box } from "./layout";

export interface Pt {
  x: number;
  y: number;
}

/** One footprint, in world units. */
export interface Print {
  /** Where the print sits (offset to its side of the walking line). */
  x: number;
  y: number;
  /** On the walking line, for the name banner to follow. */
  cx: number;
  cy: number;
  /** Heading in degrees, 0 = east, clockwise (screen coordinates). */
  angle: number;
  side: "L" | "R";
}

export interface TrailOptions {
  /** Distance between successive prints, world units. */
  stride: number;
  /** Seeds the bend so each walker takes its own line, but the same one every time. */
  seed?: string;
  maxPrints?: number;
  minPrints?: number;
}

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Prints a constant size on screen: about 22px apart whatever the zoom, so
 * a walk reads the same at the territory view and up close.
 */
export function strideFor(scale: number): number {
  return Math.min(160, Math.max(16, 22 / Math.max(scale, 0.01)));
}

/** Where a walker stands in a room: just inside its lower-left, side by side when several share it. */
export function standingSpot(card: Box, slot = 0): Pt {
  const col = slot % 4;
  const row = Math.floor(slot / 4);
  return { x: card.x + 26 + col * Math.min(64, card.w / 4.5), y: card.y + card.h - 20 - row * 36 };
}

function bezier(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y };
}

/**
 * The footprints of a walk from `from` to `to`: alternating left and right,
 * evenly spaced along a gently bent line, the last one at the destination.
 */
export function footprintTrail(from: Pt, to: Pt, opts: TrailOptions): Print[] {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  if (dist < 1) return [];
  const max = opts.maxPrints ?? 48;
  const min = opts.minPrints ?? 3;

  // Bend sideways by up to a fifth of the distance, never quite straight.
  const h = hash(opts.seed ?? "");
  const amount = 0.07 + ((h % 1000) / 1000) * 0.13;
  const bend = (h & 1 ? 1 : -1) * amount * dist;
  const nx = -(to.y - from.y) / dist;
  const ny = (to.x - from.x) / dist;
  const ctrl = { x: (from.x + to.x) / 2 + nx * bend, y: (from.y + to.y) / 2 + ny * bend };

  // Arc-length table so prints are evenly spaced along the curve.
  const N = 64;
  const pts: Pt[] = [];
  const len: number[] = [0];
  for (let i = 0; i <= N; i++) {
    pts.push(bezier(from, ctrl, to, i / N));
    if (i) len.push(len[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = len[N];
  const n = Math.max(min, Math.min(max, Math.round(total / opts.stride) + 1));
  const stride = total / (n - 1);
  const offset = Math.min(stride * 0.24, 40);

  const out: Print[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = i * stride;
    while (j < N - 1 && len[j + 1] < d) j++;
    const seg = len[j + 1] - len[j] || 1;
    const k = Math.min(1, Math.max(0, (d - len[j]) / seg));
    const c = { x: pts[j].x + (pts[j + 1].x - pts[j].x) * k, y: pts[j].y + (pts[j + 1].y - pts[j].y) * k };
    const tx = pts[j + 1].x - pts[j].x;
    const ty = pts[j + 1].y - pts[j].y;
    const tl = Math.hypot(tx, ty) || 1;
    // Left foot on the walker's left: perpendicular to the heading, counter-clockwise on screen.
    const side: Print["side"] = i % 2 === 0 ? "L" : "R";
    const sgn = side === "L" ? -1 : 1;
    const px = (-ty / tl) * sgn * offset;
    const py = (tx / tl) * sgn * offset;
    const heading = (Math.atan2(ty, tx) * 180) / Math.PI;
    // Feet turn out a few degrees.
    const angle = heading + (side === "L" ? -7 : 7);
    out.push({ x: c.x + px, y: c.y + py, cx: c.x, cy: c.y, angle, side });
  }
  return out;
}

/** The walker's position `progress` prints into a trail (fractional), on the walking line. */
export function pointAlong(prints: Print[], progress: number): Pt {
  if (!prints.length) return { x: 0, y: 0 };
  const p = Math.max(0, Math.min(prints.length - 1, progress));
  const i = Math.floor(p);
  const a = prints[i];
  const b = prints[Math.min(prints.length - 1, i + 1)];
  const k = p - i;
  return { x: a.cx + (b.cx - a.cx) * k, y: a.cy + (b.cy - a.cy) * k };
}

/** How long one step takes, ms. Long walks stride a little faster so nobody waits. */
export function stepMs(count: number): number {
  return count > 30 ? 85 : count > 16 ? 105 : 125;
}

/**
 * A shoe print 18 units long pointing east (+x), centred on 0,0: a rounded
 * sole and a separate heel. The right foot is this mirrored top to bottom.
 */
export const FOOT_PATH =
  "M-1.2,-3.3 C2.6,-4.6 7.2,-4.4 8.9,-1.6 C10.1,0.6 8.6,3.6 4.9,3.9 C1.8,4.1 -0.8,3.2 -1.6,1.4 C-2.2,-0.2 -2.3,-2.8 -1.2,-3.3 Z M-8.9,-2.4 C-7.4,-3.6 -4.6,-3.5 -3.9,-1.7 C-3.3,0.2 -4.1,2.6 -6.3,2.7 C-8.4,2.8 -9.6,1.6 -9.6,0 C-9.6,-1 -9.5,-1.9 -8.9,-2.4 Z";
export const FOOT_LENGTH = 18.5;

/** Print scale so a print is about 60% of the stride. */
export const printScale = (stride: number) => (stride * 0.6) / FOOT_LENGTH;
