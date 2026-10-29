import type { Id, Page } from "@shared/types";

/**
 * Where everything sits on the map, in world units.
 *
 * Each top-level page with children is a region (a "wing" of the map) holding
 * its whole subtree; top-level pages without children share one loose region.
 * A page with a saved x/y sits exactly there. A page without one gets a slot:
 *
 * - In a region nobody has arranged by hand, every card sits in a grid in
 *   sidebar order, and those regions are shelf-packed (ported from SPACES).
 * - In a region someone has arranged, a new page takes the first free grid
 *   cell from the region's top-left, so it lands near its siblings without
 *   covering any placed card.
 *
 * Hand-arranged regions keep the space they were given; auto regions are
 * packed below them, so the two never overlap. The same pages always lay out
 * the same way.
 */

export const CARD_W = 300;
export const CARD_H = 250;
export const GAP = 48;
export const REGION_PAD = 56;
export const REGION_HEADER = 120;
export const REGION_GAP = 220;
export const MAX_SECTION_COLS = 4;
export const MAX_LOOSE_COLS = 6;
export const LOOSE_REGION_ID = "__loose__";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CardBox extends Box {
  id: Id;
  depth: number;
  regionId: string;
  /** True when the page has a saved position. */
  pinned: boolean;
}

export interface RegionBox extends Box {
  id: string;
  title: string;
  /** Root page of the region, or null for the loose region. */
  pageId: Id | null;
  pageIds: Id[];
  /** Someone arranged this region by hand (at least one page has x/y). */
  pinned: boolean;
  /** Height of the band above the cards where the region's name is written. */
  head: number;
}

export interface MapLayout {
  cards: Map<Id, CardBox>;
  regions: RegionBox[];
  bounds: Box;
}

type LayoutPage = Pick<Page, "id" | "parentId" | "title" | "position" | "x" | "y">;

const hasPos = (p: LayoutPage) =>
  typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y);

function bySiblingOrder(a: LayoutPage, b: LayoutPage): number {
  if (a.position && b.position) {
    if (a.position < b.position) return -1;
    if (a.position > b.position) return 1;
  } else if (a.position) return -1;
  else if (b.position) return 1;
  const t = (a.title ?? "").localeCompare(b.title ?? "");
  return t !== 0 ? t : a.id < b.id ? -1 : 1;
}

/** About square, capped so a big region grows down instead of across. */
export function gridCols(count: number, max: number): number {
  return Math.max(1, Math.min(max, Math.ceil(Math.sqrt(count))));
}

export const overlaps = (a: Box, b: Box, pad = 0) =>
  a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

export function unionBox(boxes: Iterable<Box>): Box | null {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

interface Group {
  id: string;
  title: string;
  pageId: Id | null;
  entries: { page: LayoutPage; depth: number }[];
  maxCols: number;
}

/**
 * `shape` is how much wider than tall the rows of auto regions should run:
 * about 2 on a landscape screen, about 1 on a phone held upright.
 */
export function layoutMap(pages: LayoutPage[], looseTitle = "Loose leaves", shape = 2.1): MapLayout {
  const ids = new Set(pages.map((p) => p.id));
  const children = new Map<Id, LayoutPage[]>();
  const roots: LayoutPage[] = [];
  for (const page of pages) {
    const parent = page.parentId && ids.has(page.parentId) && page.parentId !== page.id ? page.parentId : null;
    if (parent) {
      const list = children.get(parent) ?? [];
      list.push(page);
      children.set(parent, list);
    } else roots.push(page);
  }
  for (const list of children.values()) list.sort(bySiblingOrder);
  roots.sort(bySiblingOrder);

  // Group each root with its subtree, in reading order. Cycles can't reach a
  // root, so pages stuck in one are picked up as loose pages below.
  const groups: Group[] = [];
  const seen = new Set<Id>();
  const loose: Group = { id: LOOSE_REGION_ID, title: looseTitle, pageId: null, entries: [], maxCols: MAX_LOOSE_COLS };
  const walk = (page: LayoutPage, depth: number, out: Group["entries"]) => {
    if (seen.has(page.id)) return;
    seen.add(page.id);
    out.push({ page, depth });
    for (const c of children.get(page.id) ?? []) walk(c, depth + 1, out);
  };
  for (const root of roots) {
    if (children.get(root.id)?.length) {
      const g: Group = {
        id: root.id,
        title: root.title?.trim() || "Untitled",
        pageId: root.id,
        entries: [],
        maxCols: MAX_SECTION_COLS,
      };
      walk(root, 0, g.entries);
      groups.push(g);
    } else walk(root, 0, loose.entries);
  }
  for (const p of pages) if (!seen.has(p.id)) walk(p, 0, loose.entries);
  if (loose.entries.length) groups.push(loose);

  const cards = new Map<Id, CardBox>();
  const placed: Box[] = [];

  // 1. Every page with a saved position goes there, unless that would cover a
  //    card already placed: then it slides out the shortest way. Positions saved
  //    for smaller cards, or photo imports of crowded notes, never stack.
  const pinnedGroups = new Set<string>();
  for (const g of groups) {
    for (const { page, depth } of g.entries) {
      if (!hasPos(page)) continue;
      pinnedGroups.add(g.id);
      const box: CardBox = { id: page.id, x: page.x!, y: page.y!, w: CARD_W, h: CARD_H, depth, regionId: g.id, pinned: true };
      separate(box, placed);
      cards.set(page.id, box);
      placed.push(box);
    }
  }

  // 2. Unplaced pages in hand-arranged regions take the first free cell near their siblings.
  for (const g of groups) {
    if (!pinnedGroups.has(g.id)) continue;
    const mine = g.entries.map((e) => cards.get(e.page.id)).filter((b): b is CardBox => !!b);
    const origin = unionBox(mine)!;
    const cols = gridCols(g.entries.length, g.maxCols);
    let cell = 0;
    for (const { page, depth } of g.entries) {
      if (cards.has(page.id)) continue;
      for (;;) {
        const box: CardBox = {
          id: page.id,
          x: origin.x + (cell % cols) * (CARD_W + GAP),
          y: origin.y + Math.floor(cell / cols) * (CARD_H + GAP),
          w: CARD_W,
          h: CARD_H,
          depth,
          regionId: g.id,
          pinned: false,
        };
        cell++;
        if (placed.some((b) => overlaps(b, box, GAP / 2 - 1))) continue;
        cards.set(page.id, box);
        placed.push(box);
        break;
      }
    }
  }

  // 3. Auto regions: a grid each, shelf-packed below whatever was arranged by hand.
  type Draft = { g: Group; w: number; h: number; cells: CardBox[] };
  const drafts: Draft[] = [];
  for (const g of groups) {
    if (pinnedGroups.has(g.id)) continue;
    const n = g.entries.length;
    const cols = gridCols(n, g.maxCols);
    const rows = Math.ceil(n / cols);
    drafts.push({
      g,
      w: REGION_PAD * 2 + cols * CARD_W + (cols - 1) * GAP,
      h: REGION_HEADER + rows * (CARD_H + GAP) - GAP + REGION_PAD,
      cells: g.entries.map(({ page, depth }, i) => ({
        id: page.id,
        x: REGION_PAD + (i % cols) * (CARD_W + GAP),
        y: REGION_HEADER + Math.floor(i / cols) * (CARD_H + GAP),
        w: CARD_W,
        h: CARD_H,
        depth,
        regionId: g.id,
        pinned: false,
      })),
    });
  }
  const handBounds = unionBox(placed);
  const startX = handBounds ? handBounds.x - REGION_PAD : 0;
  let y = handBounds ? handBounds.y + handBounds.h + REGION_PAD + REGION_GAP : 0;
  const area = drafts.reduce((s, d) => s + d.w * d.h, 0);
  const widest = drafts.reduce((m, d) => Math.max(m, d.w), 0);
  // Rows a bit wider than tall read like a map on a landscape screen.
  const rowWidth = Math.max(widest, Math.sqrt(area) * shape, handBounds ? handBounds.w : 0);
  const autoBoxes = new Map<string, Box>();
  let x = 0;
  let rowH = 0;
  for (const d of drafts) {
    if (x > 0 && x + d.w > rowWidth) {
      x = 0;
      y += rowH + REGION_GAP;
      rowH = 0;
    }
    autoBoxes.set(d.g.id, { x: startX + x, y, w: d.w, h: d.h });
    for (const c of d.cells) cards.set(c.id, { ...c, x: c.x + startX + x, y: c.y + y });
    x += d.w + REGION_GAP;
    rowH = Math.max(rowH, d.h);
  }

  // Regions, in tree order.
  const regions: RegionBox[] = [];
  for (const g of groups) {
    const pageIds = g.entries.map((e) => e.page.id);
    let box = autoBoxes.get(g.id);
    if (!box) {
      const u = unionBox(pageIds.map((id) => cards.get(id)!))!;
      box = { x: u.x - REGION_PAD, y: u.y - REGION_HEADER, w: u.w + REGION_PAD * 2, h: u.h + REGION_HEADER + REGION_PAD };
    }
    regions.push({ id: g.id, title: g.title, pageId: g.pageId, pageIds, pinned: pinnedGroups.has(g.id), head: REGION_HEADER, ...box });
  }
  trimOverlaps(regions, cards);

  const bounds = unionBox(regions) ?? { x: 0, y: 0, w: 0, h: 0 };
  return { cards, regions, bounds };
}

/**
 * Nudge `box` until it covers none of `placed` (with half a gap between),
 * moving along whichever axis needs the smaller push each time.
 */
export function separate(box: Box, placed: Box[], pad = GAP / 2) {
  for (let guard = 0; guard < 64; guard++) {
    const hit = placed.find((b) => overlaps(b, box, pad - 1));
    if (!hit) return;
    const dx = box.x + box.w / 2 - (hit.x + hit.w / 2);
    const dy = box.y + box.h / 2 - (hit.y + hit.h / 2);
    const pushX = dx >= 0 ? hit.x + hit.w + pad - box.x : hit.x - pad - (box.x + box.w);
    const pushY = dy >= 0 ? hit.y + hit.h + pad - box.y : hit.y - pad - (box.y + box.h);
    if (Math.abs(pushX) <= Math.abs(pushY)) box.x += pushX;
    else box.y += pushY;
  }
}

/** The least margin a wall keeps from its cards, and the least room kept for a region's name. */
const WALL_MIN = 20;
const HEAD_MIN = 72;
const WALL_GAP = 16;

/**
 * Hand-arranged regions are framed around wherever their cards ended up, so
 * two can overlap. Pull the facing walls in (never into a card, and leaving
 * room for the name) so neighbouring wings share a corridor instead.
 */
export function trimOverlaps(regions: RegionBox[], cards: Map<Id, Box>) {
  const inner = regions.map((r) => unionBox(r.pageIds.flatMap((id) => cards.get(id) ?? [])));
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const a = regions[i];
      const b = regions[j];
      const ia = inner[i];
      const ib = inner[j];
      if (!ia || !ib || !overlaps(a, b, WALL_GAP - 1)) continue;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + WALL_GAP;
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + WALL_GAP;
      // Resolve along whichever axis needs the smaller pull, if the slack allows it.
      const [lo, hi, ilo, ihi] = (ox <= oy ? a.x <= b.x : a.y <= b.y) ? [a, b, ia, ib] : [b, a, ib, ia];
      if (ox <= oy) {
        const slackLo = Math.max(0, lo.x + lo.w - (ilo.x + ilo.w) - WALL_MIN);
        const slackHi = Math.max(0, ihi.x - hi.x - WALL_MIN);
        if (slackLo + slackHi < ox) continue;
        const takeHi = Math.min(slackHi, ox / 2);
        const takeLo = ox - takeHi;
        lo.w -= takeLo;
        hi.x += takeHi;
        hi.w -= takeHi;
      } else {
        const slackLo = Math.max(0, lo.y + lo.h - (ilo.y + ilo.h) - WALL_MIN);
        const slackHi = Math.max(0, ihi.y - hi.y - HEAD_MIN);
        if (slackLo + slackHi < oy) continue;
        // The upper wing gives up its bottom margin first; the lower one's name band last.
        const takeLo = Math.min(slackLo, oy);
        const takeHi = oy - takeLo;
        lo.h -= takeLo;
        hi.y += takeHi;
        hi.h -= takeHi;
        hi.head -= takeHi;
      }
    }
  }
}

/** Card centre. */
export const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/**
 * A gentle curve leaving `a` and entering `b` on the sides facing each other,
 * like a road drawn between two rooms.
 */
export function linkPath(a: Box, b: Box): string {
  const ac = centre(a);
  const bc = centre(b);
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  if (Math.abs(dx) >= Math.abs(dy) * 0.8) {
    const sx = dx >= 0 ? a.x + a.w : a.x;
    const ex = dx >= 0 ? b.x : b.x + b.w;
    const c = Math.max(40, Math.abs(ex - sx) * 0.45) * Math.sign(dx || 1);
    return `M${r(sx)},${r(ac.y)} C${r(sx + c)},${r(ac.y)} ${r(ex - c)},${r(bc.y)} ${r(ex)},${r(bc.y)}`;
  }
  const sy = dy >= 0 ? a.y + a.h : a.y;
  const ey = dy >= 0 ? b.y : b.y + b.h;
  const c = Math.max(30, Math.abs(ey - sy) * 0.45) * Math.sign(dy || 1);
  return `M${r(ac.x)},${r(sy)} C${r(ac.x)},${r(sy + c)} ${r(bc.x)},${r(ey - c)} ${r(bc.x)},${r(ey)}`;
}

const r = (n: number) => Math.round(n * 10) / 10;
