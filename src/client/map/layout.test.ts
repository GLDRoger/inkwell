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

  it("places a new page in a hand-arranged region near its siblings without covering them", () => {
    const l = layoutMap([page("a", null, { x: 0, y: 0 }), page("a1", "a", { x: 348, y: 0 }), page("a2", "a")]);
    const a2 = l.cards.get("a2")!;
    expect(a2.pinned).toBe(false);
    noOverlaps([...l.cards.values()]);
    expect(Math.hypot(a2.x, a2.y)).toBeLessThan(800);
  });

  it("packs auto regions below hand-arranged ones", () => {
    const l = layoutMap([page("a", null, { x: 0, y: 0 }), page("a1", "a", { x: 400, y: 0 }), page("b"), page("b1", "b")]);
    const a = l.regions.find((r) => r.id === "a")!;
    const b = l.regions.find((r) => r.id === "b")!;
    expect(b.y).toBeGreaterThan(a.y + a.h);
    noOverlaps(l.regions);
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
});
