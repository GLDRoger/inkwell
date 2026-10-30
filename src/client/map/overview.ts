import { fitCamera, type Cam, type Insets } from "./camera";
import type { Box } from "./layout";
import { DOTS_AT } from "./lod";

/**
 * The zoom the overview never goes below: where every card still shows its
 * title and every agent its name. A bigger notebook spills past the edges
 * rather than shrinking to unlabelled squares.
 */
export const OVERVIEW_MIN = DOTS_AT;

/**
 * The overview camera: the whole map when it fits at a readable zoom; else
 * that zoom, showing the top of the map and, across, whichever stretch holds
 * the most whole cards (nearest the middle when that ties). The rest is a
 * pan, or a press of "Show the whole map", away.
 */
export function overviewCamera(
  bounds: Box,
  cards: Iterable<Box>,
  vw: number,
  vh: number,
  insets: Insets,
  pad: number,
  maxScale: number,
  min = OVERVIEW_MIN,
): Cam {
  const fit = fitCamera(bounds, vw, vh, insets, pad, maxScale);
  if (fit.s >= min || !bounds.w || !bounds.h) return fit;
  const s = min;
  const w = (vw - insets.left - insets.right - pad * 2) / s;
  const h = (vh - insets.top - insets.bottom - pad * 2) / s;
  if (w <= 0 || h <= 0) return fit;

  // Down: from the top, the way a page reads.
  const y0 = bounds.h > h ? bounds.y : bounds.y + bounds.h / 2 - h / 2;
  // Across: try windows starting at each card's left edge (and the centred one).
  let x0 = bounds.x + bounds.w / 2 - w / 2;
  if (bounds.w > w) {
    const boxes = [...cards].filter((b) => b.y >= y0 && b.y + b.h <= y0 + h);
    const lo = bounds.x;
    const hi = bounds.x + bounds.w - w;
    const clamp = (x: number) => Math.min(hi, Math.max(lo, x));
    const centred = clamp(x0);
    let best = centred;
    let bestN = -1;
    for (const x of new Set([centred, lo, hi, ...boxes.map((b) => clamp(Math.round(b.x - 40)))])) {
      let n = 0;
      for (const b of boxes) if (b.x >= x && b.x + b.w <= x + w) n++;
      if (n > bestN || (n === bestN && Math.abs(x - centred) < Math.abs(best - centred))) {
        best = x;
        bestN = n;
      }
    }
    x0 = best;
  }
  return {
    x: x0 + w / 2 - (insets.left - insets.right) / 2 / s,
    y: y0 + h / 2 - (insets.top - insets.bottom) / 2 / s,
    s,
  };
}

/**
 * The screen's shape, in a few steps (less the chrome above and below), so the
 * map's areas pack to it without reshuffling on every resize.
 */
export function aspectBucket(w: number, h: number): number {
  if (!w || !h) return 2;
  const a = w / Math.max(1, h - 190);
  return a < 0.8 ? 0.6 : a < 1.3 ? 1 : a < 1.9 ? 1.5 : 2.2;
}
