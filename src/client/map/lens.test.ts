import { describe, expect, it } from "vitest";
import type { Lens } from "@shared/types";
import { CARD_H, CARD_W, overlaps, type CardBox, type MapLayout } from "./layout";
import { LENS_LIFT, lensKey, lensLayout, withLens } from "./lens";

const card = (id: string, x: number, y: number): CardBox => ({ id, x, y, w: CARD_W, h: CARD_H, depth: 1, regionId: "r", pinned: false });
const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
const home: MapLayout = {
  cards: new Map(ids.map((id, i) => [id, card(id, (i % 4) * 350, Math.floor(i / 4) * 300)])),
  regions: [],
  bounds: { x: -40, y: -120, w: 1440, h: 1100 },
  settle: new Map(),
};
const lens = (kind: Lens["kind"], groups: Lens["groups"]): Lens => ({ id: "l1", title: "What's left", kind, groups, agentId: null, runId: null, createdAt: "2026-11-02T10:00:00Z" });

describe("lensLayout", () => {
  it("puts columns side by side, in order, each group's cards stacked under its label", () => {
    const l = lensLayout(lens("columns", [{ label: "Done", pageIds: ["p0", "p1"] }, { label: "Doing", pageIds: ["p5"] }, { label: "To do", pageIds: ["p9", "p10", "p11"] }]), home);
    expect(l.groups.map((g) => g.label)).toEqual(["Done", "Doing", "To do"]);
    expect(l.groups[0].x).toBeLessThan(l.groups[1].x);
    expect(l.groups[1].x).toBeLessThan(l.groups[2].x);
    const [a, b] = [l.cards.get("p0")!, l.cards.get("p1")!];
    expect(a.x).toBe(b.x);
    expect(b.y).toBeGreaterThan(a.y + CARD_H);
    // Cards sit below their group's label.
    for (const g of l.groups) for (const id of ["p0", "p1", "p5", "p9"]) {
      const c = l.cards.get(id)!;
      if (c.x >= g.x && c.x < g.x + g.w) expect(c.y).toBeGreaterThan(g.y);
    }
  });

  it("never overlaps two lens cards, even when a group wraps into more columns", () => {
    const l = lensLayout(lens("columns", [{ label: "All", pageIds: ids.slice(0, 9) }, { label: "Rest", pageIds: ids.slice(9) }]), home);
    const boxes = [...l.cards.values()];
    expect(boxes).toHaveLength(12);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false);
    expect(l.groups[0].w).toBeGreaterThan(CARD_W * 2);
  });

  it("lays a timeline left to right in its order", () => {
    const l = lensLayout(lens("timeline", [{ label: "Mon", pageIds: ["p3"] }, { label: "Tue", pageIds: ["p1"] }, { label: "Wed", pageIds: ["p7"] }]), home);
    const xs = ["p3", "p1", "p7"].map((id) => l.cards.get(id)!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(["p3", "p1", "p7"].map((id) => l.cards.get(id)!.y)).size).toBe(1);
  });

  it("floats above the map, clear of every card on it", () => {
    const l = lensLayout(lens("columns", [{ label: "A", pageIds: ids }]), home);
    expect(l.bounds.y + l.bounds.h).toBeLessThanOrEqual(home.bounds.y - LENS_LIFT + 1);
    for (const b of l.cards.values()) for (const h of home.cards.values()) expect(overlaps(b, h)).toBe(false);
  });

  it("skips pages that aren't on the map and pages already in an earlier group", () => {
    const l = lensLayout(lens("columns", [{ label: "A", pageIds: ["p0", "gone"] }, { label: "B", pageIds: ["p0", "p2"] }]), home);
    expect([...l.cards.keys()]).toEqual(["p0", "p2"]);
    expect(l.groups.map((g) => g.count)).toEqual([1, 1]);
  });

  it("docks the widgets that read the lens's pages beside it, and leaves the others", () => {
    const l = lensLayout(lens("columns", [{ label: "A", pageIds: ["p0"] }]), home, [
      { id: "w1", w: 300, h: 160, pageIds: ["p0"] },
      { id: "w2", w: 300, h: 160, pageIds: ["p8"] },
    ]);
    expect([...l.widgets.keys()]).toEqual(["w1"]);
    expect(l.widgets.get("w1")!.x).toBeGreaterThan(l.cards.get("p0")!.x + CARD_W);
    expect(l.order.get("w1")).toBe(1);
  });
});

describe("lens widgets", () => {
  it("docks a widget made with the lens even when it reads no pages", () => {
    const l = lensLayout({ ...lens("columns", [{ label: "A", pageIds: ["p0"] }]), agentId: "atlas" }, home, [
      { id: "clock", w: 300, h: 140, pageIds: [], createdAt: "2026-11-02T10:00:20Z", createdBy: { id: "atlas" } },
      { id: "old", w: 300, h: 140, pageIds: [], createdAt: "2026-10-01T10:00:00Z", createdBy: { id: "atlas" } },
    ]);
    expect([...l.widgets.keys()]).toEqual(["clock"]);
  });
});

describe("withLens", () => {
  it("moves only the lens's cards and keeps the stored places of the rest", () => {
    const l = lensLayout(lens("columns", [{ label: "A", pageIds: ["p4"] }]), home);
    const view = withLens(home, l);
    expect(view.cards.get("p4")!.y).toBe(l.cards.get("p4")!.y);
    expect(view.cards.get("p5")).toBe(home.cards.get("p5"));
    expect(view.bounds.y).toBeLessThan(home.bounds.y);
    expect(home.cards.get("p4")!.y).toBe(300);
  });

  it("is the map itself without a lens", () => {
    expect(withLens(home, null)).toBe(home);
    expect(lensKey(null)).toBe("");
  });
});
