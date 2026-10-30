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
export const REGION_PAD = 40;
export const REGION_HEADER = 120;
export const REGION_GAP = 150;
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
  /**
   * Places worth saving: a photo's notes, just made, tidied under their
   * heading. Once saved they're ordinary saved places (and can be moved).
   */
  settle: Map<Id, { x: number; y: number }>;
}

type LayoutPage = Pick<Page, "id" | "parentId" | "title" | "position" | "x" | "y"> & { createdAt?: string; updatedAt?: string };

const hasSavedPos = (p: LayoutPage) =>
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

/** An area's frame around its cards: room for its name above, a margin around. */
function regionAround(cards: Box[]): Box {
  const u = unionBox(cards)!;
  return { x: u.x - REGION_PAD, y: u.y - REGION_HEADER, w: u.w + REGION_PAD * 2, h: u.h + REGION_HEADER + REGION_PAD };
}

interface Draft {
  g: { id: string };
  w: number;
  h: number;
  cells: CardBox[];
}

/** Rows of areas, in reading order, about as wide as `aspect` asks. */
function shelfPack(drafts: Draft[], aspect: number): Map<string, Box> {
  const out = new Map<string, Box>();
  const area = drafts.reduce((s, d) => s + (d.w + REGION_GAP) * (d.h + REGION_GAP), 0);
  const widest = drafts.reduce((m, d) => Math.max(m, d.w), 0);
  // Shelves leave gaps, so aim a little wider than the shape asks.
  const rowWidth = Math.max(widest, Math.sqrt(area * aspect) * 1.2);
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const d of drafts) {
    if (x > 0 && x + d.w > rowWidth) {
      x = 0;
      y += rowH + REGION_GAP;
      rowH = 0;
    }
    out.set(d.g.id, { x, y, w: d.w, h: d.h });
    x += d.w + REGION_GAP;
    rowH = Math.max(rowH, d.h);
  }
  return out;
}

/**
 * New areas beside the hand-arranged ones: each goes in whichever free spot
 * next to an area keeps the whole map closest to the screen's shape (so it
 * still fits at a readable zoom), nearest the middle when that ties. Pages an
 * agent makes at the top level land in view instead of below everything.
 */
export function packAround(drafts: Draft[], fixed: Box[], aspect: number): Map<string, Box> {
  const out = new Map<string, Box>();
  const taken = [...fixed];
  const G = REGION_GAP;
  for (const d of drafts) {
    const all = unionBox(taken)!;
    const mid = { x: all.x + all.w / 2, y: all.y + all.h / 2 };
    let best: Box | null = null;
    let bestScore = Infinity;
    let bestDist = Infinity;
    for (const o of taken) {
      const spots = [
        { x: o.x + o.w + G, y: o.y },
        { x: o.x + o.w + G, y: o.y + o.h - d.h },
        { x: o.x, y: o.y + o.h + G },
        { x: o.x + o.w - d.w, y: o.y + o.h + G },
        { x: o.x - G - d.w, y: o.y },
        { x: o.x, y: o.y - G - d.h },
      ];
      for (const p of spots) {
        const box = { x: Math.round(p.x), y: Math.round(p.y), w: d.w, h: d.h };
        if (taken.some((t) => overlaps(t, box, G - 1))) continue;
        const u = unionBox([all, box])!;
        // The zoom that fits the whole map goes as the larger of these: smaller is better.
        const score = Math.round(Math.max(u.w / aspect, u.h));
        const dist = Math.hypot(box.x + box.w / 2 - mid.x, box.y + box.h / 2 - mid.y);
        if (score < bestScore || (score === bestScore && dist < bestDist)) {
          best = box;
          bestScore = score;
          bestDist = dist;
        }
      }
    }
    const box = best ?? { x: all.x, y: all.y + all.h + G, w: d.w, h: d.h };
    out.set(d.g.id, box);
    taken.push(box);
  }
  return out;
}

interface Group {
  id: string;
  title: string;
  pageId: Id | null;
  entries: { page: LayoutPage; depth: number }[];
  maxCols: number;
}

export interface LayoutOptions {
  /** How much wider than tall the map should come out: the screen's shape, about 2 on a laptop, 0.6 on a phone. */
  aspect?: number;
  /**
   * Ignore saved positions and lay every area out in a grid. For phones: an
   * arrangement made on a wide screen can't be read on a narrow one.
   */
  flow?: boolean;
}

export function layoutMap(pages: LayoutPage[], looseTitle = "Loose leaves", opts: LayoutOptions = {}): MapLayout {
  const aspect = opts.aspect ?? 2;
  const hasPos = (p: LayoutPage) => !opts.flow && hasSavedPos(p);
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
  const loose: Group = { id: LOOSE_REGION_ID, title: looseTitle, pageId: null, entries: [], maxCols: opts.flow ? 2 : MAX_LOOSE_COLS };
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
        maxCols: opts.flow ? 2 : MAX_SECTION_COLS,
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
  //    An area made after another (a photo's notes, all at once) moves as one
  //    to keep a corridor from the older one, rather than spilling in beside
  //    it: its cards stay together under its name.
  const pinnedGroups = new Set<string>();
  const frames: { box: Box; newest: number }[] = [];
  const settle = new Map<Id, { x: number; y: number }>();
  const pinned = groups
    .map((g) => ({ g, mine: g.entries.filter(({ page }) => hasPos(page)) }))
    .filter((x) => x.mine.length)
    .map((x) => ({ ...x, oldest: Math.min(...x.mine.map(({ page }) => bornAt(page))), newest: Math.max(...x.mine.map(({ page }) => bornAt(page))) }))
    .sort((a, b) => (a.oldest === b.oldest || Number.isNaN(a.oldest - b.oldest) ? 0 : a.oldest - b.oldest));
  for (const { g, mine, oldest, newest } of pinned) {
    pinnedGroups.add(g.id);
    const boxes: CardBox[] = mine.map(({ page, depth }) => ({ id: page.id, x: page.x!, y: page.y!, w: CARD_W, h: CARD_H, depth, regionId: g.id, pinned: true }));
    const batch = isFreshBatch(g, groups);
    if (batch) tidyUnderRoot(boxes);
    for (let i = 1; i < boxes.length; i++) separate(boxes[i], boxes.slice(0, i));
    const older = frames.filter((f) => f.newest < oldest).map((f) => f.box);
    if (older.length) {
      const frame = regionAround(boxes);
      const moved = { ...frame };
      separate(moved, older, REGION_GAP);
      const dx = moved.x - frame.x;
      const dy = moved.y - frame.y;
      for (const b of boxes) {
        b.x += dx;
        b.y += dy;
      }
    }
    for (const box of boxes) {
      separate(box, placed);
      cards.set(box.id, box);
      placed.push(box);
      if (batch) settle.set(box.id, { x: Math.round(box.x), y: Math.round(box.y) });
    }
    frames.push({ box: regionAround(boxes), newest });
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

  // 3. Auto regions: a grid each, packed beside whatever was arranged by hand, or shelf-packed when nothing was.
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
  const autoBoxes = placed.length
    ? packAround(drafts, groups.filter((g) => pinnedGroups.has(g.id)).map((g) => regionAround(g.entries.map((e) => cards.get(e.page.id)!))), aspect)
    : shelfPack(drafts, aspect);
  for (const d of drafts) {
    const at = autoBoxes.get(d.g.id)!;
    for (const c of d.cells) cards.set(c.id, { ...c, x: c.x + at.x, y: c.y + at.y });
  }

  // Regions, in tree order.
  const regions: RegionBox[] = [];
  for (const g of groups) {
    const pageIds = g.entries.map((e) => e.page.id);
    const box = autoBoxes.get(g.id) ?? regionAround(pageIds.map((id) => cards.get(id)!));
    regions.push({ id: g.id, title: g.title, pageId: g.pageId, pageIds, pinned: pinnedGroups.has(g.id), head: REGION_HEADER, ...box });
  }
  trimOverlaps(regions, cards);

  const bounds = unionBox(regions) ?? { x: 0, y: 0, w: 0, h: 0 };
  return { cards, regions, bounds, settle };
}

/** Pages made within this long of each other were made together (one photo import). */
const BATCH_MS = 5000;

/**
 * A photo's notes, just made: an area whose pages all have saved places,
 * were made together, apart from every other area's, and haven't been
 * touched since. Their places mirror the photo's, which leaves wide holes.
 */
function isFreshBatch(g: Group, groups: Group[]): boolean {
  if (g.id === LOOSE_REGION_ID || g.entries.length < 3) return false;
  const ps = g.entries.map((e) => e.page);
  if (!ps.every((p) => hasSavedPos(p) && p.createdAt && p.updatedAt === p.createdAt)) return false;
  const born = ps.map(bornAt);
  if (born.some(Number.isNaN)) return false;
  const lo = Math.min(...born);
  const hi = Math.max(...born);
  if (hi - lo > BATCH_MS) return false;
  for (const o of groups) {
    if (o === g) continue;
    for (const { page } of o.entries) {
      const t = bornAt(page);
      if (t >= lo - BATCH_MS && t <= hi + BATCH_MS) return false;
    }
  }
  return true;
}

/**
 * The notes in rows under their heading page, in the photo's reading order
 * (rows top to bottom, left to right in a row), a gap apart.
 */
export function tidyUnderRoot(boxes: CardBox[]) {
  const root = boxes.find((b) => b.depth === 0);
  if (!root) return;
  const rest = boxes.filter((b) => b !== root).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: CardBox[][] = [];
  for (const b of rest) {
    const row = rows.at(-1);
    if (row && b.y - row[0].y < CARD_H / 2) row.push(b);
    else rows.push([b]);
  }
  let r = 0;
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 0; i < row.length; i++) {
      if (i > 0 && i % MAX_SECTION_COLS === 0) r++;
      row[i].x = root.x + (i % MAX_SECTION_COLS) * (CARD_W + GAP);
      row[i].y = root.y + (r + 1) * (CARD_H + GAP);
    }
    r++;
  }
}

/** When a page was made, ms (NaN when unknown: such pages never move as a group). */
const bornAt = (p: LayoutPage) => (p.createdAt ? Date.parse(p.createdAt) : NaN);

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
