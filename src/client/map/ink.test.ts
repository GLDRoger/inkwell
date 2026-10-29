import { describe, expect, it } from "vitest";
import { grow, inkDelay, inkRect, noteFrame } from "./ink";

const box = { x: 100, y: 50, w: 300, h: 250 };

describe("inkRect", () => {
  it("draws the same room the same way every time, and a different room differently", () => {
    expect(inkRect(box, "a")).toBe(inkRect(box, "a"));
    expect(inkRect(box, "a")).not.toBe(inkRect(box, "b"));
  });

  it("is four strokes that stay close to the box", () => {
    const d = inkRect(box, "room", { over: 6, bow: 3, wander: 1.5 });
    expect(d.match(/M/g)).toHaveLength(4);
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    // Overshoot plus wander plus bow, never more.
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(box.x - 12);
    expect(Math.max(...xs)).toBeLessThanOrEqual(box.x + box.w + 12);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(box.y - 12);
    expect(Math.max(...ys)).toBeLessThanOrEqual(box.y + box.h + 12);
  });
});

describe("inkDelay", () => {
  it("inks the middle first and the far edge last, within the span", () => {
    const centre = { x: 250, y: 175 };
    expect(inkDelay(box, centre, 1000, 1300)).toBe(0);
    const far = { x: 2000, y: 2000, w: 10, h: 10 };
    expect(inkDelay(far, centre, 1000, 1300)).toBe(1300);
    const mid = { x: 650, y: 125, w: 100, h: 100 };
    expect(inkDelay(mid, centre, 1000, 1300)).toBeGreaterThan(0);
    expect(inkDelay(mid, centre, 1000, 1300)).toBeLessThan(1300);
  });
});

describe("grow / noteFrame", () => {
  it("grows and shrinks a box on every side", () => {
    expect(grow(box, 10)).toEqual({ x: 90, y: 40, w: 320, h: 270 });
    expect(grow(box, -200).w).toBe(0);
  });

  it("makes a CSS url for the note frame", () => {
    const url = noteFrame();
    expect(url.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(url)).toContain("non-scaling-stroke");
  });
});
