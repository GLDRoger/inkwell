import { describe, expect, it } from "vitest";
import { visibleWorld } from "./camera";
import { CARD_H, CARD_W, type Box } from "./layout";
import { detailFor } from "./lod";
import { aspectBucket, OVERVIEW_MIN, overviewCamera } from "./overview";
import { layoutMap } from "./layout";

const NO = { top: 0, right: 0, bottom: 0, left: 0 };
const card = (x: number, y: number): Box => ({ x, y, w: CARD_W, h: CARD_H });

describe("the overview", () => {
  it("shows everything when it fits at a readable zoom", () => {
    const bounds = { x: 0, y: 0, w: 2000, h: 1000 };
    const cam = overviewCamera(bounds, [card(0, 0)], 1280, 800, NO, 32, 0.9);
    const v = visibleWorld(cam, 1280, 800);
    expect(cam.s).toBeGreaterThanOrEqual(OVERVIEW_MIN);
    expect(v.x).toBeLessThanOrEqual(0);
    expect(v.x + v.w).toBeGreaterThanOrEqual(2000);
  });

  it("never drops to unlabelled squares: a big notebook spills past the edges instead", () => {
    const bounds = { x: 0, y: 0, w: 9000, h: 6000 };
    const cards = [card(100, 100), card(8600, 5600)];
    const cam = overviewCamera(bounds, cards, 1280, 800, NO, 32, 0.9);
    expect(cam.s).toBe(OVERVIEW_MIN);
    // Titles and names show at the overview's zoom.
    expect(detailFor(cam.s, 1280)).toBe("rooms");
    // It starts from the top of the map, the way a page reads.
    const v = visibleWorld(cam, 1280, 800);
    expect(v.y).toBeLessThanOrEqual(0);
    expect(v.y).toBeGreaterThan(-200);
  });

  it("frames the stretch with the most whole cards when it can't show the width", () => {
    const bounds = { x: 0, y: 0, w: 12000, h: 1200 };
    // Three cards far right, one far left.
    const cards = [card(200, 200), card(10000, 200), card(10400, 200), card(10800, 200)];
    const cam = overviewCamera(bounds, cards, 1280, 800, NO, 32, 0.9);
    const v = visibleWorld(cam, 1280, 800);
    for (const c of cards.slice(1)) {
      expect(c.x).toBeGreaterThanOrEqual(v.x);
      expect(c.x + c.w).toBeLessThanOrEqual(v.x + v.w);
    }
  });

  it("keeps titles readable at the default fit at 1280, 768 and 375 for a grown notebook", () => {
    // The seed notebook's arrangement, plus pages agents added and a photo's group.
    const pinned = [
      ["trip", null, -950, -380], ["t1", "trip", -720, -520], ["t2", "trip", -700, -220], ["t3", "trip", -980, -120],
      ["start", null, 120, -480], ["s1", "start", 380, -620], ["s2", "start", 400, -360], ["s3", "start", 90, -230], ["s4", "start", 350, -140],
      ["read", null, -420, 420], ["r1", "read", -180, 300], ["r2", "read", -160, 560],
      ["rec", null, 820, 300], ["c1", "rec", 1060, 180], ["c2", "rec", 1080, 460],
      ["photo", null, 1680, -400], ["p1", "photo", 1700, 0], ["p2", "photo", 2300, 0], ["p3", "photo", 2900, 300], ["p4", "photo", 1800, 900], ["p5", "photo", 2600, 1000],
    ] as const;
    const pages = [
      ...pinned.map(([id, parentId, x, y]) => ({ id, parentId, title: id, position: id, x, y })),
      ...["a1", "a2", "a3"].map((id) => ({ id, parentId: null, title: id, position: id, x: null, y: null })),
    ];
    for (const [w, h, chrome] of [[1280, 800, 58], [768, 1024, 58], [375, 812, 60]] as const) {
      const flow = w < 640;
      const l = layoutMap(pages, "Other pages", { aspect: aspectBucket(w, h), flow });
      const cam = overviewCamera(l.bounds, l.cards.values(), w, h, { top: chrome + 112, right: 12, bottom: 64, left: 12 }, flow ? 8 : 32, 0.9);
      expect(detailFor(cam.s, w)).toBe("rooms");
    }
  });

  it("sorts screens into a few shapes", () => {
    expect(aspectBucket(1280, 800)).toBe(2.2);
    expect(aspectBucket(768, 1024)).toBe(1);
    expect(aspectBucket(375, 812)).toBe(0.6);
  });
});
