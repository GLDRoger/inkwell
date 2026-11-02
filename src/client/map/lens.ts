import type { Id, Lens } from "@shared/types";
import { CARD_H, CARD_W, unionBox, type Box, type CardBox, type MapLayout } from "./layout";

/**
 * Where a lens puts things. A lens is a view: the cards it names leave their
 * places on the map and line up above it (columns side by side, or a timeline
 * left to right), and the stored map never changes. The rest of the map stays
 * put underneath, faded, so you can still see where everything came from.
 */

/** Room at the top for the lens's question, world units. */
export const LENS_TITLE_H = 170;
/** Room above each group's cards for its label and note. */
export const LENS_HEAD_H = 118;
export const LENS_COL_GAP = 84;
export const LENS_ROW_GAP = 30;
/** A group's cards wrap into another column past this many. */
export const LENS_ROWS = { columns: 4, timeline: 3 } as const;
/** The lens floats this far above the top of the map. */
export const LENS_LIFT = 280;
const SUB_GAP = 28;

export interface LensGroupBox extends Box {
  index: number;
  label: string;
  note?: string;
  /** How many of its pages are on the map. */
  count: number;
}

export interface LensLayout {
  id: Id;
  kind: Lens["kind"];
  title: string;
  /** Page id -> its place in the lens. */
  cards: Map<Id, Box>;
  /** Widgets that read from the lens's pages, docked beside it. */
  widgets: Map<Id, Box>;
  groups: LensGroupBox[];
  /** Where the question is written. */
  head: Box;
  bounds: Box;
  /** The order things fly in, for the stagger (pages, then docked widgets). */
  order: Map<Id, number>;
}

export interface LensWidget {
  id: Id;
  w: number;
  h: number;
  pageIds: Id[];
}

/** A stable key for a lens, so the same lens shown again doesn't fly twice. */
export const lensKey = (lens: Pick<Lens, "id" | "createdAt"> | null) => (lens ? `${lens.id}@${lens.createdAt}` : "");

export function lensLayout(lens: Lens, home: Pick<MapLayout, "cards" | "bounds">, widgets: LensWidget[] = []): LensLayout {
  const rows = LENS_ROWS[lens.kind] ?? LENS_ROWS.columns;
  const seen = new Set<Id>();
  // A page sits in at most one group: the first that names it. Pages not on the map are skipped.
  const groups = lens.groups.slice(0, 6).map((g) => {
    const ids: Id[] = [];
    for (const id of g.pageIds) {
      if (seen.has(id) || !home.cards.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return { g, ids };
  });

  const cardW = CARD_W;
  const cardH = CARD_H;
  // Size each group: one column up to `rows` cards, then more columns side by side.
  const sized = groups.map(({ g, ids }) => {
    const cols = Math.max(1, Math.ceil(ids.length / rows));
    const inCol = Math.max(1, Math.min(rows, ids.length));
    return { g, ids, cols, w: cols * cardW + (cols - 1) * SUB_GAP, h: inCol * cardH + (inCol - 1) * LENS_ROW_GAP };
  });
  const groupsW = sized.reduce((t, s) => t + s.w, 0) + Math.max(0, sized.length - 1) * LENS_COL_GAP;
  const groupsH = sized.reduce((m, s) => Math.max(m, s.h), cardH);

  const lensWidgets = widgets.filter((w) => w.pageIds.some((id) => seen.has(id)));
  const dockW = lensWidgets.length ? Math.max(...lensWidgets.map((w) => w.w)) : 0;
  const dockH = lensWidgets.reduce((t, w) => t + w.h, 0) + Math.max(0, lensWidgets.length - 1) * LENS_ROW_GAP;
  const totalW = groupsW + (dockW ? LENS_COL_GAP + dockW : 0);
  const bodyH = Math.max(groupsH, dockH - LENS_HEAD_H);
  const totalH = LENS_TITLE_H + LENS_HEAD_H + bodyH;

  // Centred over the map, just above its top edge.
  const hb = home.bounds;
  const x0 = Math.round(hb.x + hb.w / 2 - totalW / 2);
  const y0 = Math.round(hb.y - LENS_LIFT - totalH);
  const top = y0 + LENS_TITLE_H;
  const cardsTop = top + LENS_HEAD_H;

  const cards = new Map<Id, Box>();
  const order = new Map<Id, number>();
  const out: LensGroupBox[] = [];
  let x = x0;
  let n = 0;
  sized.forEach((s, index) => {
    s.ids.forEach((id, i) => {
      const col = Math.floor(i / rows);
      const row = i % rows;
      cards.set(id, { x: x + col * (cardW + SUB_GAP), y: cardsTop + row * (cardH + LENS_ROW_GAP), w: cardW, h: cardH });
      order.set(id, n++);
    });
    out.push({ index, label: s.g.label, note: s.g.note, count: s.ids.length, x, y: top, w: s.w, h: LENS_HEAD_H + s.h });
    x += s.w + LENS_COL_GAP;
  });

  const dock = new Map<Id, Box>();
  let wy = top;
  for (const w of lensWidgets) {
    dock.set(w.id, { x: x0 + groupsW + LENS_COL_GAP, y: wy, w: w.w, h: w.h });
    order.set(w.id, n++);
    wy += w.h + LENS_ROW_GAP;
  }

  const head = { x: x0, y: y0, w: totalW, h: LENS_TITLE_H };
  const bounds = unionBox([head, ...cards.values(), ...dock.values(), ...out])!;
  return { id: lens.id, kind: lens.kind, title: lens.title, cards, widgets: dock, groups: out, head, bounds, order };
}

/**
 * The map as the lens shows it: the lens's cards in their lens places, the
 * rest where they are. Everything that reads card places (culling, the
 * minimap, walkers, the peek camera) then follows the lens for free.
 */
export function withLens(layout: MapLayout, lens: LensLayout | null): MapLayout {
  if (!lens) return layout;
  const cards = new Map<Id, CardBox>(layout.cards);
  for (const [id, b] of lens.cards) {
    const home = layout.cards.get(id);
    if (home) cards.set(id, { ...home, x: b.x, y: b.y, w: b.w, h: b.h });
  }
  return { ...layout, cards, bounds: unionBox([layout.bounds, lens.bounds])! };
}
