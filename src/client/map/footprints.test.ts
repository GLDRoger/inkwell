import { describe, expect, it } from "vitest";
import { footprintTrail, pointAlong, standingSpot, strideFor } from "./footprints";

describe("footprintTrail", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 1000, y: 0 };

  it("spaces prints about a stride apart, ending at the destination", () => {
    const prints = footprintTrail(from, to, { stride: 50, seed: "a" });
    expect(prints.length).toBeGreaterThanOrEqual(20);
    expect(prints.length).toBeLessThanOrEqual(24);
    expect(prints[0].cx).toBeCloseTo(0);
    expect(prints.at(-1)!.cx).toBeCloseTo(1000, 0);
    expect(prints.at(-1)!.cy).toBeCloseTo(0, 0);
    for (let i = 1; i < prints.length; i++) {
      const d = Math.hypot(prints[i].cx - prints[i - 1].cx, prints[i].cy - prints[i - 1].cy);
      expect(d).toBeGreaterThan(35);
      expect(d).toBeLessThan(60);
    }
  });

  it("alternates left and right, either side of the walking line", () => {
    const prints = footprintTrail(from, to, { stride: 50, seed: "a" });
    prints.forEach((p, i) => expect(p.side).toBe(i % 2 ? "R" : "L"));
    // Walking east on screen (y down): the left foot is north (smaller y) of the line.
    const mid = prints.slice(2, -2);
    for (const p of mid) {
      if (p.side === "L") expect(p.y).toBeLessThan(p.cy);
      else expect(p.y).toBeGreaterThan(p.cy);
    }
  });

  it("points prints along the heading", () => {
    const down = footprintTrail({ x: 0, y: 0 }, { x: 0, y: 800 }, { stride: 40, seed: "b" });
    const mid = down[Math.floor(down.length / 2)];
    // heading south = +90deg, give or take bend and toe-out
    expect(Math.abs(mid.angle - 90)).toBeLessThan(35);
  });

  it("bends the same way for the same walker, differently for others", () => {
    const a1 = footprintTrail(from, to, { stride: 50, seed: "archivist" });
    const a2 = footprintTrail(from, to, { stride: 50, seed: "archivist" });
    expect(a1).toEqual(a2);
    const seeds = ["archivist", "scribe", "cartographer", "ada", "kit"];
    const bends = seeds.map((s) => Math.sign(footprintTrail(from, to, { stride: 50, seed: s })[10].cy));
    expect(new Set(bends).size).toBe(2);
  });

  it("caps the number of prints on long walks and keeps a few on short ones", () => {
    expect(footprintTrail(from, { x: 50000, y: 0 }, { stride: 20, maxPrints: 48 }).length).toBe(48);
    expect(footprintTrail(from, { x: 10, y: 0 }, { stride: 50 }).length).toBe(3);
    expect(footprintTrail(from, from, { stride: 50 })).toEqual([]);
  });

  it("follows the walking line for the banner", () => {
    const prints = footprintTrail(from, to, { stride: 100, seed: "a" });
    const p = pointAlong(prints, 2.5);
    expect(p.x).toBeCloseTo((prints[2].cx + prints[3].cx) / 2);
    expect(pointAlong(prints, 999)).toEqual({ x: prints.at(-1)!.cx, y: prints.at(-1)!.cy });
  });

  it("keeps prints a constant size on screen", () => {
    expect(strideFor(1) * 1).toBeCloseTo(22);
    expect(strideFor(0.25) * 0.25).toBeCloseTo(22);
  });

  it("stands walkers side by side inside the room", () => {
    const card = { x: 100, y: 100, w: 300, h: 250 };
    const a = standingSpot(card, 0);
    const b = standingSpot(card, 1);
    expect(b.x).toBeGreaterThan(a.x);
    for (const s of [a, b]) expect(s.x > 100 && s.x < 400 && s.y > 100 && s.y < 350).toBe(true);
  });
});
