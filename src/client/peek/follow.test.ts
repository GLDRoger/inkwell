import { describe, expect, it } from "vitest";
import { FollowGate, followTarget, peekCamera, type FollowWalker } from "./follow";

const input = (focus: { pageId?: string; agentId?: string }, walkers: Record<string, FollowWalker>, pages: string[], writing: string[] = []) => ({
  focus,
  agentAt: (id: string) => walkers[id],
  hasPage: (id: string) => pages.includes(id),
  writing: new Set(writing),
});

describe("FollowGate", () => {
  it("follows until the viewer moves the map, then waits 8s before following again", () => {
    const g = new FollowGate();
    expect(g.active(0)).toBe(true);
    g.pause(1000);
    expect(g.active(1000)).toBe(false);
    expect(g.active(8999)).toBe(false);
    expect(g.resumesIn(5000)).toBe(4000);
    expect(g.active(9000)).toBe(true);
  });

  it("moving again restarts the wait", () => {
    const g = new FollowGate();
    g.pause(0);
    g.pause(6000);
    expect(g.active(8500)).toBe(false);
    expect(g.active(14_000)).toBe(true);
  });
});

describe("followTarget", () => {
  it("follows the focused agent to the page it's on", () => {
    const t = followTarget(input({ agentId: "wren", pageId: "plan" }, { wren: { pageId: "trip", action: "reading" } }, ["trip", "plan"]));
    expect(t).toEqual({ pageId: "trip", peek: null });
  });

  it("peeks the focused page once an agent writes there", () => {
    const t = followTarget(input({ agentId: "wren", pageId: "plan" }, { wren: { pageId: "plan", action: "writing" } }, ["plan"], ["plan"]));
    expect(t).toEqual({ pageId: "plan", peek: "plan" });
  });

  it("peeks wherever the focused agent writes when the step names no page", () => {
    const t = followTarget(input({ agentId: "scout" }, { scout: { pageId: "summary", action: "writing" } }, ["summary"], ["summary"]));
    expect(t.peek).toBe("summary");
  });

  it("peeks a named page straight away when no agent is named (a new cover)", () => {
    expect(followTarget(input({ pageId: "plan" }, {}, ["plan"]))).toEqual({ pageId: "plan", peek: "plan" });
  });

  it("waits for a page that isn't on the map yet", () => {
    expect(followTarget(input({ agentId: "wren", pageId: "new" }, { wren: { pageId: "new", action: "writing" } }, []))).toEqual({ pageId: null, peek: null });
  });

  it("falls back to the focused page while the agent is between pages", () => {
    expect(followTarget(input({ agentId: "wren", pageId: "plan" }, { wren: { pageId: null, action: "thinking" } }, ["plan"]))).toEqual({
      pageId: "plan",
      peek: null,
    });
  });
});

describe("peekCamera", () => {
  const insets = { top: 60, right: 600, bottom: 60, left: 12 };
  const box = { x: 0, y: 0, w: 260, h: 180 };

  it("leaves the camera alone when the card is already in view beside the panel", () => {
    // Card centred in the free area at scale 1.
    const cam = { x: 130 + (600 - 12) / 2, y: 90, s: 1 };
    expect(peekCamera(box, cam, 1280, 800, insets, 0.85)).toBeNull();
  });

  it("moves a card hidden under the panel into the free area, keeping the zoom", () => {
    const cam = { x: 0, y: 90, s: 1 }; // card's left edge at screen x 640: under the panel
    const t = peekCamera(box, cam, 1280, 800, insets, 0.85)!;
    expect(t.s).toBe(1);
    const left = (box.x - t.x) * t.s + 640;
    expect(left).toBeGreaterThanOrEqual(12);
    expect(left + box.w).toBeLessThanOrEqual(1280 - 600);
  });

  it("zooms in from far out to where cards are readable", () => {
    const t = peekCamera(box, { x: 0, y: 0, s: 0.2 }, 1280, 800, insets, 0.85)!;
    expect(t.s).toBeCloseTo(0.85);
  });

  it("never zooms further than fits the free area", () => {
    const t = peekCamera(box, { x: 0, y: 0, s: 0.2 }, 400, 400, { top: 60, right: 12, bottom: 220, left: 12 }, 0.85)!;
    expect(t.s * box.h).toBeLessThanOrEqual(400 - 60 - 220);
  });
});
