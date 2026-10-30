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

describe("far-out card titles", () => {
  it("never breaks a word: a long later word ends the title with an ellipsis", async () => {
    const { farTitle } = await import("./util");
    expect(farTitle("Lisbon food & neighbourhoods")).toEqual({ text: "Lisbon food &…", fit: 1 });
    expect(farTitle("Product roadmap")).toEqual({ text: "Product roadmap", fit: 1 });
  });

  it("shrinks the type a little for a long first word", async () => {
    const { farTitle } = await import("./util");
    const f = farTitle("Fundraising notes");
    expect(f.text).toBe("Fundraising notes");
    expect(f.fit).toBeCloseTo(10 / 11);
  });

  it("lets the icon take a line of its own rather than shrink the first word", async () => {
    const { farTitle } = await import("./util");
    expect(farTitle("Fundraising notes", { icon: true }).fit).toBeCloseTo(10 / 11);
    // The icon takes room on the first line, so a title that just fits three lines without it doesn't with it.
    expect(farTitle("Weekend in Porto with friends").text).toBe("Weekend in Porto with friends");
    expect(farTitle("Weekend in Porto with friends", { icon: true }).text).toBe("Weekend in Porto with…");
  });

  it("ends a title that runs past three lines at a whole word", async () => {
    const { farTitle } = await import("./util");
    expect(farTitle("The Design of Everyday Things", { icon: true }).text).toBe("The Design of Everyday…");
    expect(farTitle("Trip to Lisbon").text).toBe("Trip to Lisbon");
    expect(farTitle("Startup: launch plan").text).toBe("Startup: launch plan");
  });

  it("splits an agent's 'Kind: Name' title so the name keeps its lines", async () => {
    const { splitTitle, farTitle } = await import("./util");
    expect(splitTitle("Plan: Fundraising notes")).toEqual({ kind: "Plan", name: "Fundraising notes" });
    expect(splitTitle("Summary: Startup: launch plan")).toEqual({ kind: "Summary", name: "Startup: launch plan" });
    expect(splitTitle("Packing checklist: Trip to Lisbon")).toEqual({ kind: "Packing checklist", name: "Trip to Lisbon" });
    expect(farTitle(splitTitle("Plan: Fundraising notes").name).text).toBe("Fundraising notes");
  });

  it("leaves other titles with a colon whole", async () => {
    const { splitTitle } = await import("./util");
    expect(splitTitle("Startup: launch plan")).toEqual({ kind: null, name: "Startup: launch plan" });
    expect(splitTitle("Standup at 10:30")).toEqual({ kind: null, name: "Standup at 10:30" });
    expect(splitTitle("Notes from a very long meeting about things: Q3")).toEqual({ kind: null, name: "Notes from a very long meeting about things: Q3" });
    expect(splitTitle("Plan:")).toEqual({ kind: null, name: "Plan:" });
    expect(splitTitle("Weeknight dinners")).toEqual({ kind: null, name: "Weeknight dinners" });
  });

  it("marks a page with no icon by its first letter", async () => {
    const { initial } = await import("./util");
    expect(initial("“Bread” notes")).toBe("B");
    expect(initial("")).toBe("·");
  });
});

