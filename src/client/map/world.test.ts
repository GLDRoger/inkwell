import { describe, expect, it } from "vitest";
import { inkDelay, worldFrame } from "./world";

const box = { x: 100, y: 50, w: 300, h: 250 };

describe("inkDelay", () => {
  it("shows the middle first and the far edge last, within the span", () => {
    const centre = { x: 250, y: 175 };
    expect(inkDelay(box, centre, 1000, 1300)).toBe(0);
    const far = { x: 2000, y: 2000, w: 10, h: 10 };
    expect(inkDelay(far, centre, 1000, 1300)).toBe(1300);
    const mid = { x: 650, y: 125, w: 100, h: 100 };
    expect(inkDelay(mid, centre, 1000, 1300)).toBeGreaterThan(0);
    expect(inkDelay(mid, centre, 1000, 1300)).toBeLessThan(1300);
  });
});

describe("worldFrame", () => {
  it("covers the territory with room around it", () => {
    const f = worldFrame(box);
    expect(f.x).toBeLessThan(box.x);
    expect(f.x + f.w).toBeGreaterThan(box.x + box.w);
    expect(f.viewBox).toBe(`${f.x} ${f.y} ${f.w} ${f.h}`);
  });
});
