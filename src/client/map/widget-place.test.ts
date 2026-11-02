import { describe, expect, it } from "vitest";
import type { Widget } from "../../shared/types";
import type { CardBox } from "./layout";
import { placeWidgets } from "./widget-place";

const card = (id: string, x: number, y: number): CardBox => ({ id, x, y, w: 300, h: 250, depth: 0, regionId: "r", pinned: true });
const widget = (id: string, x: number, y: number, pageIds: string[]): Widget => ({
  id, title: id, x, y, pageIds, data: { kind: "countdown", date: "2026-12-04", label: "" },
  createdBy: { kind: "agent", id: "a", name: "Atlas" }, createdAt: "", updatedAt: "",
});
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe("placeWidgets", () => {
  const cards = new Map([["a", card("a", 0, 0)], ["b", card("b", 340, 0)], ["c", card("c", 0, 290)]]);
  it("keeps a widget that covers no card where it is", () => {
    expect(placeWidgets([widget("w", 1000, 0, ["a"])], cards).get("w")).toMatchObject({ x: 1000, y: 0 });
  });
  it("moves a widget off the cards, beside its sources", () => {
    const box = placeWidgets([widget("w", 100, 100, ["a", "b"])], cards).get("w")!;
    for (const c of cards.values()) expect(overlaps(box, c)).toBe(false);
    expect(box.x).toBeGreaterThanOrEqual(640);
  });
  it("stacks two moved widgets without overlap", () => {
    const out = placeWidgets([widget("w1", 10, 10, ["a"]), widget("w2", 20, 20, ["a"])], cards);
    expect(overlaps(out.get("w1")!, out.get("w2")!)).toBe(false);
    for (const box of out.values()) for (const c of cards.values()) expect(overlaps(box, c)).toBe(false);
  });
  it("on a phone's column, lines widgets up in rows above the cards, wherever they were stored", () => {
    const over = { x: 0, y: 0, w: 640, h: 540 };
    const out = placeWidgets([widget("w1", 2000, 900, ["a"]), widget("w2", -800, 40, ["b"]), widget("w3", 5, 5, [])], cards, { strip: over });
    const boxes = [...out.values()];
    expect(boxes).toHaveLength(3);
    for (const b of boxes) {
      expect(b.y + b.h).toBeLessThanOrEqual(over.y);
      expect(b.x).toBeGreaterThanOrEqual(over.x);
      expect(b.x + b.w).toBeLessThanOrEqual(over.x + over.w);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false);
  });
});
