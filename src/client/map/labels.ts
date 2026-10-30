import type { Box } from "./layout";
import { overlaps } from "./layout";

/**
 * Where a walker's name sits on the map. A name is a small pill placed just
 * outside its page's card: under the bottom edge by preference, else beside
 * or above it, whichever covers least of the cards around it (and never a
 * card's title if it can help it). Pure, so it's tested without a browser.
 *
 * Positions are a world anchor on the card's edge plus an offset in screen
 * pixels, so a name keeps its distance from the card at any zoom.
 */

/** The pill's height, and the gap it keeps from the card edge, in screen px. */
export const LABEL_H = 24;
export const LABEL_GAP = 6;
/** How far in from the card's corner a name starts, screen px. */
export const LABEL_INSET = 10;
/** Where the walker's dot sits inside the pill, from its left edge, screen px. */
export const DOT_X = 13;
/** Far out, a name shrinks to its dot: a small round pill this wide and tall, screen px. */
export const DOT_ONLY = 14;

export type Side = "below" | "right" | "above" | "left";

export interface LabelSpot {
  side: Side;
  /** World anchor on the card's edge. */
  ax: number;
  ay: number;
  /** Screen-pixel offset from the anchor to the walker's dot. */
  dx: number;
  dy: number;
  /** The pill's box in world units at the scale it was placed for. */
  box: Box;
}

/** A pill's width for a name and what it's doing: close enough to place it, screen px. */
export function labelWidth(name: string, action = ""): number {
  return Math.round(22 + name.length * 7.4 + (action ? 8 + action.length * 6.2 : 0));
}

/** The part of a card a name must not cover: its title. Far out the title sits in the middle; closer in, at the top. */
export function titleZone(card: Box, far: boolean): Box {
  if (far) return { x: card.x + card.w * 0.08, y: card.y + card.h * 0.22, w: card.w * 0.84, h: card.h * 0.56 };
  return { x: card.x, y: card.y, w: card.w, h: card.h * 0.45 };
}

function area(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Where an area's name is drawn, in world units, at zoom `s`: the same sizes
 * as `.area` in map.module.css (font clamp(17px, s*92px, 116px), sitting a
 * small gap above the point (x, y)).
 */
export function areaNameBox(x: number, y: number, title: string, s: number): Box {
  const font = Math.min(116, Math.max(17, s * 92));
  const gap = Math.min(18, Math.max(4, s * 16));
  const h = font * 1.2;
  const w = Math.max(1, title.length) * font * 0.42;
  return { x, y: y - (gap + h) / s, w: w / s, h: h / s };
}

export interface PlaceOptions {
  /** Other cards nearby (not this one). */
  cards: Box[];
  /** Area names nearby: as bad to cover as a title. */
  areas?: Box[];
  /** Names already placed. */
  taken?: Box[];
  /** True at the territory view, where titles sit mid-card. */
  far?: boolean;
}

/**
 * Pick a spot for a name `w` px wide beside `card` at zoom `s`. Tries along
 * the bottom edge first (left to right, so several names line up), then the
 * right side, the top edge and the left side. The first spot that covers
 * nothing wins; otherwise the one that covers least, with titles counting
 * ten times as much as the rest of a card and other names five times.
 */
export function placeLabel(card: Box, w: number, s: number, opts: PlaceOptions, h = LABEL_H, dotX = DOT_X): LabelSpot {
  const k = 1 / Math.max(s, 1e-3);
  const pw = w * k;
  const ph = h * k;
  const gap = LABEL_GAP * k;
  const inset = LABEL_INSET * k;
  const taken = opts.taken ?? [];
  const zones = opts.cards.map((c) => titleZone(c, !!opts.far));

  const candidates: { side: Side; ax: number; ay: number; x: number; y: number }[] = [];
  // Along the bottom and top edges, a name's width at a time.
  const step = pw + 6 * k;
  const runs = Math.max(1, Math.floor((card.w - inset) / step) + 1);
  for (let i = 0; i < runs; i++) {
    const x = card.x + inset + i * step;
    candidates.push({ side: "below", ax: card.x, ay: card.y + card.h, x, y: card.y + card.h + gap });
  }
  for (let i = 0; i < 3; i++) {
    const y = card.y + card.h - ph - i * (ph + 4 * k);
    if (y < card.y) break;
    candidates.push({ side: "right", ax: card.x + card.w, ay: card.y + card.h, x: card.x + card.w + gap, y });
  }
  for (let i = 0; i < runs; i++) {
    const x = card.x + inset + i * step;
    candidates.push({ side: "above", ax: card.x, ay: card.y, x, y: card.y - gap - ph });
  }
  for (let i = 0; i < 3; i++) {
    const y = card.y + card.h - ph - i * (ph + 4 * k);
    if (y < card.y) break;
    candidates.push({ side: "left", ax: card.x, ay: card.y + card.h, x: card.x - gap - pw, y });
  }

  let best: (typeof candidates)[number] | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const box = { x: c.x, y: c.y, w: pw, h: ph };
    let score = 0;
    for (const t of taken) if (overlaps(t, box)) score += area(t, box) * 5;
    for (const a of opts.areas ?? []) if (overlaps(a, box)) score += area(a, box) * 10;
    for (let i = 0; i < opts.cards.length; i++) {
      const o = opts.cards[i];
      if (!overlaps(o, box)) continue;
      score += area(o, box) + area(zones[i], box) * 10;
    }
    if (score === 0) {
      best = c;
      break;
    }
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  const c = best!;
  return {
    side: c.side,
    ax: c.ax,
    ay: c.ay,
    dx: (c.x - c.ax) * s + dotX,
    dy: (c.y - c.ay) * s + h / 2,
    box: { x: c.x, y: c.y, w: pw, h: ph },
  };
}

/** The walker's dot in world units, for a spot at zoom `s`: where footprints end. */
export const dotOf = (spot: Pick<LabelSpot, "ax" | "ay" | "dx" | "dy">, s: number) => ({
  x: spot.ax + spot.dx / s,
  y: spot.ay + spot.dy / s,
});
