import { describe, expect, it } from "vitest";
import { detailFor, lodFor, scaleFor } from "./lod";
import { fitCamera, tweenAt, visibleWorld, zoomAround } from "./camera";

describe("semantic zoom", () => {
  it("steps far, mid, near with zoom", () => {
    expect(lodFor(0.2)).toBe("far");
    expect(lodFor(0.49)).toBe("far");
    expect(lodFor(0.5)).toBe("mid");
    expect(lodFor(1.2)).toBe("mid");
    expect(lodFor(1.25)).toBe("near");
    expect(lodFor(3)).toBe("near");
  });

  it("starts the page view sooner on a phone so a page fits the width", () => {
    expect(lodFor(1.18, 375)).toBe("near");
    expect(lodFor(1.18, 1280)).toBe("mid");
    // and the near flight scale on a phone is a near scale
    expect(lodFor(scaleFor("near", 375, 700), 375)).toBe("near");
    expect(lodFor(scaleFor("near", 1280, 800), 1280)).toBe("near");
  });

  it("shrinks rooms to dots when too small to name", () => {
    expect(detailFor(0.08)).toBe("dots");
    expect(detailFor(0.3)).toBe("rooms");
    expect(detailFor(0.8)).toBe("mid");
  });
});

describe("camera math", () => {
  it("zooms around the pointer", () => {
    const c = { x: 100, y: 50, s: 1 };
    const z = zoomAround(c, 2, 700, 300, 1000, 600);
    // world point under (700,300) before: x = 100 + 200 = 300, y = 50
    expect((700 - 500) / z.s + z.x).toBeCloseTo(300);
    expect((300 - 300) / z.s + z.y).toBeCloseTo(50);
    expect(z.s).toBe(2);
  });

  it("fits a rect into the free area", () => {
    const cam = fitCamera({ x: 0, y: 0, w: 2000, h: 1000 }, 1000, 600, { top: 60, right: 0, bottom: 0, left: 0 }, 20);
    const v = visibleWorld(cam, 1000, 600);
    expect(v.x).toBeLessThanOrEqual(0);
    expect(v.x + v.w).toBeGreaterThanOrEqual(2000);
    // top inset keeps the rect below the bar
    expect(v.y + (60 / cam.s)).toBeLessThanOrEqual(0.01);
  });

  it("flights start and end exactly, zooming in log space", () => {
    const tw = { from: { x: 0, y: 0, s: 0.25 }, to: { x: 1000, y: 500, s: 1 }, mid: null };
    expect(tweenAt(tw, 0)).toEqual({ x: 0, y: 0, s: 0.25 });
    const end = tweenAt(tw, 1);
    expect(end.x).toBeCloseTo(1000);
    expect(end.s).toBeCloseTo(1);
    expect(tweenAt(tw, 0.5).s).toBeCloseTo(0.5);
  });
});
