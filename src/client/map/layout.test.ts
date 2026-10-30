import { describe, expect, it } from "vitest";
import { CARD_H, CARD_W, layoutMap, LOOSE_REGION_ID, overlaps } from "./layout";

type P = { id: string; parentId: string | null; title: string; position: string; x: number | null; y: number | null };
const page = (id: string, parentId: string | null = null, extra: Partial<P> = {}): P => ({
  id,
  parentId,
  title: id,
  position: id,
  x: null,
  y: null,
  ...extra,
});

function noOverlaps(boxes: { x: number; y: number; w: number; h: number }[]) {
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false);
}

describe("layoutMap", () => {
  it("makes a region per top-level page with children and one loose region", () => {
    const l = layoutMap([page("a"), page("a1", "a"), page("a2", "a"), page("b"), page("c")]);
    expect(l.regions.map((r) => r.id)).toEqual(["a", LOOSE_REGION_ID]);
    expect(l.regions[0].pageIds).toEqual(["a", "a1", "a2"]);
    expect(l.regions[1].pageIds).toEqual(["b", "c"]);
    expect(l.cards.get("a1")!.depth).toBe(1);
  });

  it("keeps the subtree in reading order (depth first)", () => {
    const l = layoutMap([page("r"), page("r2", "r"), page("r1", "r"), page("r1a", "r1")]);
    expect(l.regions[0].pageIds).toEqual(["r", "r1", "r1a", "r2"]);
  });

  it("is deterministic and overlap-free for 400 pages", () => {
    const pages: P[] = [];
    for (let r = 0; r < 12; r++) {
      pages.push(page(`r${r}`));
      for (let i = 0; i < 30; i++) pages.push(page(`r${r}-${i}`, i > 5 && i % 3 === 0 ? `r${r}-${i - 1}` : `r${r}`));
    }
    for (let i = 0; i < 28; i++) pages.push(page(`loose${i}`));
    const a = layoutMap(pages);
    const b = layoutMap([...pages].reverse());
    expect(a.cards.size).toBe(400);
    expect([...a.cards.values()].map((c) => [c.id, c.x, c.y])).toEqual(
      [...a.cards.keys()].map((id) => [id, b.cards.get(id)!.x, b.cards.get(id)!.y]),
    );
    noOverlaps([...a.cards.values()]);
    noOverlaps(a.regions);
    // Every card is inside its region.
    for (const r of a.regions)
      for (const id of r.pageIds) {
        const c = a.cards.get(id)!;
        expect(c.x >= r.x && c.y >= r.y && c.x + c.w <= r.x + r.w && c.y + c.h <= r.y + r.h).toBe(true);
      }
  });

  it("puts pages with a saved position exactly there", () => {
    const l = layoutMap([page("a", null, { x: 1000, y: -400 }), page("a1", "a", { x: 1400, y: -400 })]);
    expect(l.cards.get("a")).toMatchObject({ x: 1000, y: -400, w: CARD_W, h: CARD_H, pinned: true });
    expect(l.cards.get("a1")).toMatchObject({ x: 1400, y: -400 });
    expect(l.regions[0].pinned).toBe(true);
  });

  it("slides saved cards apart when their positions would stack them", () => {
    const l = layoutMap([
      page("hub", null, { x: -950, y: -380 }),
      page("a", "hub", { x: -720, y: -520 }),
      page("b", "hub", { x: -700, y: -220 }),
      page("c", "hub", { x: -980, y: -120 }),
    ]);
    expect(l.cards.get("hub")).toMatchObject({ x: -950, y: -380 });
    noOverlaps([...l.cards.values()]);
    // Nobody is flung far: each card stays within a card's width of where it was saved.
    for (const [id, x, y] of [["a", -720, -520], ["b", -700, -220], ["c", -980, -120]] as const) {
      const c = l.cards.get(id)!;
      expect(Math.hypot(c.x - x, c.y - y)).toBeLessThan(CARD_W + 60);
    }
  });

  it("places a new page in a hand-arranged region near its siblings without covering them", () => {
    const l = layoutMap([page("a", null, { x: 0, y: 0 }), page("a1", "a", { x: 348, y: 0 }), page("a2", "a")]);
    const a2 = l.cards.get("a2")!;
    expect(a2.pinned).toBe(false);
    noOverlaps([...l.cards.values()]);
    expect(Math.hypot(a2.x, a2.y)).toBeLessThan(800);
  });

  it("packs auto regions beside hand-arranged ones, to the screen's shape", () => {
    const pages = [page("a", null, { x: 0, y: 0 }), page("a1", "a", { x: 400, y: 0 }), page("b"), page("b1", "b")];
    const wide = layoutMap(pages, "Other pages", { aspect: 2.2 });
    const wa = wide.regions.find((r) => r.id === "a")!;
    const wb = wide.regions.find((r) => r.id === "b")!;
    // On a landscape screen the new area goes alongside, not below everything.
    expect(wb.x).toBeGreaterThan(wa.x + wa.w);
    expect(wb.y).toBeLessThan(wa.y + wa.h);
    noOverlaps(wide.regions);
    const tall = layoutMap(pages, "Other pages", { aspect: 0.6 });
    const ta = tall.regions.find((r) => r.id === "a")!;
    const tb = tall.regions.find((r) => r.id === "b")!;
    expect(tb.y).toBeGreaterThan(ta.y + ta.h);
    noOverlaps(tall.regions);
  });

  it("keeps a growing notebook compact: a new loose page and a new group land next to the arranged map", () => {
    const pages = [
      page("trip", null, { x: -950, y: -380 }),
      page("t1", "trip", { x: -720, y: -520 }),
      page("t2", "trip", { x: -700, y: -220 }),
      page("startup", null, { x: 120, y: -480 }),
      page("s1", "startup", { x: 380, y: -620 }),
      page("s2", "startup", { x: 400, y: -360 }),
      page("agent-made"),
      page("group"),
      page("g1", "group"),
      page("g2", "group"),
    ];
    const before = layoutMap(pages.slice(0, 6), "Other pages", { aspect: 2.2 });
    const after = layoutMap(pages, "Other pages", { aspect: 2.2 });
    noOverlaps(after.regions);
    noOverlaps([...after.cards.values()]);
    // Two new areas grow the map by less than they would stacked underneath it.
    const stacked = before.bounds.h + 2 * (120 + 250 + 40 + 150);
    expect(Math.max(after.bounds.w / 2.2, after.bounds.h)).toBeLessThan(Math.max(before.bounds.w / 2.2, stacked));
  });

  it("lays everything out afresh, ignoring saved places, when asked to flow (phones)", () => {
    const pages = [page("a", null, { x: 5000, y: 5000 }), page("a1", "a", { x: -5000, y: 0 }), page("b"), page("b1", "b")];
    const l = layoutMap(pages, "Other pages", { aspect: 0.6, flow: true });
    expect(l.cards.get("a")!.pinned).toBe(false);
    expect(l.bounds.w).toBeLessThan(1600);
    noOverlaps([...l.cards.values()]);
  });

  it("survives parent cycles and missing parents", () => {
    const l = layoutMap([page("x", "y"), page("y", "x"), page("z", "gone")]);
    expect(l.cards.size).toBe(3);
  });

  it("is empty for no pages", () => {
    const l = layoutMap([]);
    expect(l.regions).toEqual([]);
    expect(l.bounds).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it("pulls in the facing walls of hand-arranged wings that would overlap, never into a card", () => {
    const l = layoutMap([
      page("a", null, { x: 0, y: 0 }),
      page("a1", "a", { x: 0, y: 300 }),
      page("b", null, { x: 0, y: 700 }),
      page("b1", "b", { x: 350, y: 700 }),
    ]);
    const [a, b] = l.regions;
    expect(overlaps(a, b)).toBe(false);
    for (const r of l.regions)
      for (const id of r.pageIds) {
        const c = l.cards.get(id)!;
        expect(c.x).toBeGreaterThanOrEqual(r.x);
        expect(c.y).toBeGreaterThanOrEqual(r.y);
        expect(c.x + c.w).toBeLessThanOrEqual(r.x + r.w);
        expect(c.y + c.h).toBeLessThanOrEqual(r.y + r.h);
      }
    // The lower wing keeps room above its cards for its name.
    expect(l.cards.get("b")!.y - b.y).toBe(b.head);
    expect(b.head).toBeGreaterThanOrEqual(72);
    // Cards stay exactly where they were saved.
    expect(l.cards.get("b")).toMatchObject({ x: 0, y: 700 });
  });
});
