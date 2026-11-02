import type { Id } from "@shared/types";
import type { Box } from "./layout";

/**
 * Reading a pen stroke on the map. Three gestures, kept forgiving:
 *
 * - circle: a roughly closed loop. The cards inside it are the scope.
 * - link: a line (or an arrow) that starts on one card and ends on another.
 * - strike: a line right across one card (starting and ending off it, or on
 *   its neighbours in a dense grid), or a zig-zag scribbled over it.
 *
 * Anything else is "none" and the ink just fades. Points are in world units;
 * `px` is world units per screen pixel, so tolerances feel the same at any zoom.
 */

export interface Pt {
  x: number;
  y: number;
}

export type Gesture =
  | { kind: "circle"; pageIds: Id[] }
  | { kind: "link"; from: Id; to: Id }
  | { kind: "strike"; pageId: Id }
  | { kind: "none" };

export interface Target {
  id: Id;
  box: Box;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function pathLength(pts: Pt[]): number {
  let t = 0;
  for (let i = 1; i < pts.length; i++) t += dist(pts[i - 1], pts[i]);
  return t;
}

/** Evenly spaced points along the stroke, so jittery input and fast flicks read the same. */
export function resample(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2 || step <= 0) return pts.slice();
  const out: Pt[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let d = dist(a, b);
    while (carry + d >= step) {
      const k = (step - carry) / d;
      const p = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      out.push(p);
      a = p;
      d = dist(a, b);
      carry = 0;
    }
    carry += d;
  }
  const last = pts[pts.length - 1];
  if (dist(out[out.length - 1], last) > step * 0.3) out.push(last);
  return out;
}

function angleDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Total signed turning (radians) and how many sharp reversals the stroke makes. */
export function turning(pts: Pt[]): { total: number; sharp: number } {
  let total = 0;
  let sharp = 0;
  let prev: number | null = null;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    if (!dx && !dy) continue;
    const a = Math.atan2(dy, dx);
    if (prev !== null) {
      const d = angleDiff(prev, a);
      total += d;
      if (Math.abs(d) > (110 * Math.PI) / 180) sharp++;
    }
    prev = a;
  }
  return { total, sharp };
}

export function insidePolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const inBox = (p: Pt, b: Box, m = 0) => p.x >= b.x - m && p.x <= b.x + b.w + m && p.y >= b.y - m && p.y <= b.y + b.h + m;

function bboxOf(pts: Pt[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Is most of the card inside the loop? Its middle, or five of nine points across it. */
function circled(b: Box, poly: Pt[]): boolean {
  if (insidePolygon({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, poly)) return true;
  let n = 0;
  for (const fx of [0.15, 0.5, 0.85]) for (const fy of [0.15, 0.5, 0.85]) if (insidePolygon({ x: b.x + b.w * fx, y: b.y + b.h * fy }, poly)) n++;
  return n >= 5;
}

const topmost = (targets: Target[], p: Pt, m: number) => {
  // Later targets are drawn on top; the one on top wins.
  for (let i = targets.length - 1; i >= 0; i--) if (inBox(p, targets[i].box, m)) return targets[i];
  return null;
};

export function recognize(raw: Pt[], targetsIn: Iterable<Target>, px = 1): Gesture {
  const targets = [...targetsIn];
  if (raw.length < 3) return { kind: "none" };
  const len = pathLength(raw);
  if (len < 40 * px) return { kind: "none" };
  const pts = resample(raw, 6 * px);
  const box = bboxOf(pts);
  const big = Math.max(box.w, box.h);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const gap = dist(first, last);
  const { total, sharp } = turning(pts);

  // A loop: turns most of the way round, and ends near where it began.
  if (Math.abs(total) >= Math.PI * 1.45 && gap <= Math.max(0.45 * big, 40 * px) && Math.min(box.w, box.h) >= 36 * px) {
    const inside = targets.filter((t) => circled(t.box, pts));
    if (!inside.length) return { kind: "none" };
    inside.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    return { kind: "circle", pageIds: inside.map((t) => t.id) };
  }

  // A line across one card in a dense grid starts and ends on its neighbours (the gaps are too
  // thin to aim for). Straight, through the middle of a card that isn't at either end, and mostly
  // on that card rather than on the ends: a strike of that card, not a link of its neighbours.
  const struck = strikeThrough(pts, targets, len, gap);
  if (struck) return { kind: "strike", pageId: struck };

  // A line from one card to another. An arrowhead doubles back, so the tip is the farthest point out.
  const from = topmost(targets, first, 8 * px);
  if (from) {
    let tip = last;
    let far = 0;
    for (const p of pts) {
      const d = dist(first, p);
      if (d > far) [far, tip] = [d, p];
    }
    const to = topmost(targets, last, 16 * px) ?? topmost(targets, tip, 16 * px);
    if (to && to.id !== from.id) return { kind: "link", from: from.id, to: to.id };
  }

  // A zig-zag over one card: back and forth, nearly all of it on that card.
  if (sharp >= 3) {
    for (const t of targets) {
      const on = pts.filter((p) => inBox(p, t.box, 10 * px)).length;
      if (on / pts.length >= 0.7) return { kind: "strike", pageId: t.id };
    }
    return { kind: "none" };
  }

  // A line right across one card: fairly straight, both ends off every card.
  if (gap / len >= 0.75 && !topmost(targets, first, 0) && !topmost(targets, last, 0)) {
    const crossed = targets.filter((t) => pts.some((p) => inBox(p, innerOf(t.box))));
    if (crossed.length === 1) return { kind: "strike", pageId: crossed[0].id };
  }

  return { kind: "none" };
}

const innerOf = (b: Box): Box => ({ x: b.x + b.w * 0.15, y: b.y + b.h * 0.15, w: b.w * 0.7, h: b.h * 0.7 });

/**
 * The card a straight stroke strikes out when its ends rest on other cards:
 * it crosses that one card's middle (and no other card's, besides the ends),
 * and runs over it for at least 1.6× as long as it runs over the end cards
 * together (about 3× when only one end is on a card). A line from deep in one
 * card to deep in another stays a link.
 */
function strikeThrough(pts: Pt[], targets: Target[], len: number, chord: number): Id | null {
  if (chord / len < 0.85) return null;
  const ends = new Set([topmost(targets, pts[0], 0), topmost(targets, pts[pts.length - 1], 0)].filter((t): t is Target => !!t));
  if (!ends.size) return null;
  const crossed = targets.filter((t) => !ends.has(t) && pts.some((p) => inBox(p, innerOf(t.box))));
  if (crossed.length !== 1) return null;
  const mid = crossed[0];
  const onMid = pts.filter((p) => inBox(p, mid.box)).length;
  const onEnds = pts.filter((p) => [...ends].some((t) => inBox(p, t.box))).length;
  // With only one end on a card, that end must barely touch it (a start just over the edge).
  const ratio = ends.size === 2 && topmost(targets, pts[0], 0) !== topmost(targets, pts[pts.length - 1], 0) ? 1.6 : 1 / 0.35;
  return onMid >= onEnds * ratio ? mid.id : null;
}

/**
 * A loop drawn as a hand would around some boxes: a slightly uneven ellipse
 * that starts at the top left, goes round once and overshoots a little. For
 * the demo's lasso. Deterministic for the same boxes.
 */
export function lassoAround(boxes: Box[], pad = 60, steps = 72): Pt[] {
  if (!boxes.length) return [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  // An ellipse through the corners of the box (plus padding) has radii √2 × the half-sides.
  const rx = ((x1 - x0) / 2 + pad) * 1.18;
  const ry = ((y1 - y0) / 2 + pad) * 1.22;
  const out: Pt[] = [];
  const start = Math.PI * 1.15;
  const sweep = Math.PI * 2.12;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const a = start + sweep * k;
    // A hand isn't a compass: the radius wanders a little, and the loop closes slightly inside.
    const wobble = 1 + 0.035 * Math.sin(a * 3 + 0.6) + 0.02 * Math.sin(a * 5 + 1.3) - 0.05 * k * k;
    out.push({ x: cx + Math.cos(a) * rx * wobble, y: cy + Math.sin(a) * ry * wobble });
  }
  return out;
}
