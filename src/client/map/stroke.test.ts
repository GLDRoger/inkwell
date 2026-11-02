import { describe, expect, it } from "vitest";
import { lassoAround, recognize, type Pt, type Target } from "./stroke";

// Three cards in a row and one below: 300 x 250, 50 apart.
const box = (x: number, y: number) => ({ x, y, w: 300, h: 250 });
const cards: Target[] = [
  { id: "a", box: box(0, 0) },
  { id: "b", box: box(350, 0) },
  { id: "c", box: box(700, 0) },
  { id: "d", box: box(0, 300) },
];

const line = (a: Pt, b: Pt, n = 30): Pt[] => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
const loop = (cx: number, cy: number, rx: number, ry: number, turns = 1, n = 60, jitter = 0): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2 * turns;
    const j = jitter ? Math.sin(i * 1.7) * jitter : 0;
    return { x: cx + Math.cos(a) * (rx + j), y: cy + Math.sin(a) * (ry + j) };
  });

describe("recognize", () => {
  it("reads a loop around two cards as a circle of those cards, in reading order", () => {
    const g = recognize(loop(325, 125, 420, 220, 1, 60, 6), cards);
    expect(g).toEqual({ kind: "circle", pageIds: ["a", "b"] });
  });

  it("forgives a loop that doesn't quite close", () => {
    const g = recognize(loop(175, 125, 230, 200, 0.85), cards);
    expect(g).toEqual({ kind: "circle", pageIds: ["a"] });
  });

  it("does nothing for a loop around empty paper", () => {
    expect(recognize(loop(2000, 2000, 200, 200), cards)).toEqual({ kind: "none" });
  });

  it("reads a line from one card to another as a link", () => {
    expect(recognize(line({ x: 150, y: 125 }, { x: 850, y: 125 }), cards)).toEqual({ kind: "link", from: "a", to: "c" });
  });

  it("reads an arrow (with its head doubling back) as a link to the card at the tip", () => {
    const shaft = line({ x: 150, y: 125 }, { x: 150, y: 420 });
    const head = line({ x: 150, y: 420 }, { x: 110, y: 380 }, 6);
    expect(recognize([...shaft, ...head], cards)).toEqual({ kind: "link", from: "a", to: "d" });
  });

  it("reads a line right across one card as a strike", () => {
    expect(recognize(line({ x: 320, y: 30 }, { x: 670, y: 220 }), cards)).toEqual({ kind: "strike", pageId: "b" });
  });

  it("reads a zig-zag over one card as a strike", () => {
    const pts: Pt[] = [];
    for (let i = 0; i < 6; i++) pts.push(...line({ x: 760, y: 40 + i * 35 }, { x: 940, y: 57 + i * 35 }, 8), ...line({ x: 940, y: 57 + i * 35 }, { x: 760, y: 75 + i * 35 }, 8));
    expect(recognize(pts, cards)).toEqual({ kind: "strike", pageId: "c" });
  });

  it("does nothing for a line across two cards", () => {
    expect(recognize(line({ x: -40, y: 125 }, { x: 1040, y: 125 }), cards)).toEqual({ kind: "none" });
  });

  describe("in a dense grid, where the gaps are too thin to start a stroke in", () => {
    // Three cards in a row, 18 apart, like a packed area seen up close.
    const grid: Target[] = [
      { id: "l", box: { x: 0, y: 0, w: 260, h: 150 } },
      { id: "m", box: { x: 278, y: 0, w: 260, h: 150 } },
      { id: "r", box: { x: 556, y: 0, w: 260, h: 150 } },
      { id: "u", box: { x: 278, y: 168, w: 260, h: 150 } },
    ];

    it("reads a line across the middle card, ending on its neighbours, as a strike of that card", () => {
      expect(recognize(line({ x: 230, y: 60 }, { x: 590, y: 90 }), grid)).toEqual({ kind: "strike", pageId: "m" });
    });

    it("reads it the same drawn the other way, or with one end in the gap", () => {
      expect(recognize(line({ x: 600, y: 100 }, { x: 240, y: 50 }), grid)).toEqual({ kind: "strike", pageId: "m" });
      expect(recognize(line({ x: 268, y: 40 }, { x: 590, y: 110 }), grid)).toEqual({ kind: "strike", pageId: "m" });
    });

    it("strikes the card at the grid's edge, starting just over its neighbour's edge", () => {
      expect(recognize(line({ x: 520, y: 60 }, { x: 850, y: 90 }), grid)).toEqual({ kind: "strike", pageId: "r" });
    });

    it("still reads a line from deep in one card to deep in another as a link", () => {
      expect(recognize(line({ x: 130, y: 75 }, { x: 686, y: 75 }), grid)).toEqual({ kind: "link", from: "l", to: "r" });
    });

    it("still links two neighbours", () => {
      expect(recognize(line({ x: 130, y: 75 }, { x: 400, y: 80 }), grid)).toEqual({ kind: "link", from: "l", to: "m" });
    });

    it("doesn't strike when a wobbly stroke isn't straight", () => {
      const wobble = line({ x: 230, y: 60 }, { x: 590, y: 90 }).map((p, i) => ({ x: p.x, y: p.y + (i % 2 ? 70 : -40) }));
      expect(recognize(wobble, grid).kind).not.toBe("strike");
    });
  });

  it("does nothing for a line from a card to empty paper", () => {
    expect(recognize(line({ x: 150, y: 125 }, { x: 150, y: 900 }), cards)).toEqual({ kind: "none" });
  });

  it("does nothing for a tap or a tiny mark", () => {
    expect(recognize([{ x: 10, y: 10 }, { x: 12, y: 11 }, { x: 14, y: 12 }], cards)).toEqual({ kind: "none" });
  });

  it("does nothing for an open curve", () => {
    const arc = loop(1200, 600, 200, 200, 0.4);
    expect(recognize(arc, cards)).toEqual({ kind: "none" });
  });

  it("keeps its tolerances in screen pixels", () => {
    // Zoomed far out (10 world units a pixel), a 300-unit line is a 30px flick: too small to mean anything.
    expect(recognize(line({ x: 150, y: 125 }, { x: 450, y: 125 }), cards, 10)).toEqual({ kind: "none" });
  });
});

describe("lassoAround", () => {
  it("draws a loop the recogniser reads as circling exactly those cards", () => {
    const pts = lassoAround([cards[0].box, cards[1].box]);
    expect(recognize(pts, cards)).toEqual({ kind: "circle", pageIds: ["a", "b"] });
  });
});
