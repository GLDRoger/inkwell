import { describe, expect, it } from "vitest";
import { overlaps } from "./layout";
import { areaNameBox, dotOf, LABEL_GAP, labelWidth, placeLabel, titleZone } from "./labels";

const card = { x: 0, y: 0, w: 300, h: 250 };
const right = { x: 348, y: 0, w: 300, h: 250 };
const below = { x: 0, y: 298, w: 300, h: 250 };
const above = { x: 0, y: -298, w: 300, h: 250 };

describe("placeLabel", () => {
  it("puts a name just under its card, outside it, when there's room", () => {
    const s = 0.85;
    const spot = placeLabel(card, labelWidth("Wren"), s, { cards: [right, below] });
    expect(spot.side).toBe("below");
    expect(spot.box.y).toBeCloseTo(card.y + card.h + LABEL_GAP / s);
    expect(overlaps(spot.box, card)).toBe(false);
    for (const c of [right, below]) expect(overlaps(spot.box, c)).toBe(false);
  });

  it("never covers its own card or a neighbour's title, even far out where the gaps are thin", () => {
    const s = 0.3;
    const spot = placeLabel(card, labelWidth("Atlas", "writing"), s, { cards: [right, below, above], far: true });
    expect(overlaps(spot.box, card)).toBe(false);
    for (const c of [right, below, above]) expect(overlaps(spot.box, titleZone(c, true))).toBe(false);
  });

  it("lines several names up along the edge instead of stacking them", () => {
    const s = 1;
    const a = placeLabel(card, labelWidth("Scout"), s, { cards: [] });
    const b = placeLabel(card, labelWidth("Wren"), s, { cards: [], taken: [a.box] });
    expect(b.side).toBe("below");
    expect(overlaps(a.box, b.box)).toBe(false);
    expect(b.box.x).toBeGreaterThan(a.box.x);
  });

  it("anchors on the card edge with a pixel offset, so the dot sits beside the card at any zoom", () => {
    const spot = placeLabel(card, 80, 0.5, { cards: [] });
    const dot = dotOf(spot, 0.5);
    expect(dot.y).toBeGreaterThan(card.y + card.h);
    expect(dot.x).toBeGreaterThan(card.x);
    expect(dot.x).toBeLessThan(card.x + card.w);
  });

  it("keeps clear of an area's name above the first row", () => {
    const s = 0.2;
    const name = areaNameBox(card.x, card.y - 10, "Search", s);
    const spot = placeLabel(card, labelWidth("Archivist", "writing"), s, { cards: [right, below], areas: [name], far: true });
    expect(overlaps(spot.box, name)).toBe(false);
    expect(overlaps(spot.box, card)).toBe(false);
  });
});
