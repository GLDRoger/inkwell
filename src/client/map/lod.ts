import { CARD_W } from "./layout";

/**
 * Semantic zoom. Far: the territory, rooms and roads. Mid: parchment cards
 * saying what each page holds. Near: the page itself, readable in place.
 */
export type Lod = "far" | "mid" | "near";

export const MID_AT = 0.5;
export const NEAR_AT = 1.25;
/** Below this, rooms are too small to name: they become dots. */
export const DOTS_AT = 0.13;

/**
 * The level for a zoom. On a narrow screen a card can't get 1.25x wide
 * without overflowing, so the page view starts once a card fills the width.
 */
export function lodFor(scale: number, viewportWidth = Infinity): Lod {
  const near = Math.max(MID_AT + 0.1, Math.min(NEAR_AT, (viewportWidth - 24) / CARD_W));
  if (scale >= near) return "near";
  if (scale >= MID_AT) return "mid";
  return "far";
}

/** Finer steps inside "far": "dots" when even a title won't fit. */
export type Detail = "dots" | "rooms" | Lod;
export function detailFor(scale: number, viewportWidth = Infinity): Detail {
  const lod = lodFor(scale, viewportWidth);
  if (lod !== "far") return lod;
  return scale < DOTS_AT ? "dots" : "rooms";
}

/** The zoom each level opens at, for keyboard and focus flights. */
export function scaleFor(lod: Lod, viewportWidth = Infinity, viewportHeight = Infinity): number {
  if (lod === "far") return 0.3;
  if (lod === "mid") return 0.85;
  // Near: the page as big as fits, never below the near threshold.
  const room = Math.min((viewportWidth - 32) / CARD_W, (viewportHeight - 180) / 250, 1.6);
  const near = Math.max(MID_AT + 0.1, Math.min(NEAR_AT, (viewportWidth - 24) / CARD_W));
  return Math.max(near, room);
}
