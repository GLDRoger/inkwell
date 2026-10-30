/**
 * The phone's bottom sheet: it rests half open (the map stays in view above
 * it) or fully open, and a drag down past the half closes it. Pure, so the
 * gesture's decisions are tested apart from the DOM.
 */
export type Snap = "half" | "full";

/** Visible height of the sheet at a snap, px, for a viewport `vh` tall with `top` px of chrome above. */
export function snapHeight(snap: Snap, vh: number, top: number): number {
  const full = Math.max(200, vh - top);
  return snap === "full" ? full : Math.min(full, Math.round(vh * 0.5));
}

/**
 * Where a drag ends: the nearest snap, a flick's direction winning, or closed
 * when pulled well below the half-open height.
 */
export function settleSheet(visible: number, velocity: number, vh: number, top: number): Snap | "closed" {
  const half = snapHeight("half", vh, top);
  const full = snapHeight("full", vh, top);
  // velocity: px/ms, positive downwards.
  if (velocity > 0.6) return visible < half * 0.95 ? "closed" : "half";
  if (velocity < -0.6) return "full";
  if (visible < half * 0.6) return "closed";
  return Math.abs(visible - full) < Math.abs(visible - half) ? "full" : "half";
}
