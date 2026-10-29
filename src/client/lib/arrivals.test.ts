import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "@shared/types";
import { ARRIVE_STAGGER_MS, arrivalOf, holdArrivals, releaseArrivals } from "./arrivals";

const person = { kind: "person" as const, id: "p1", name: "You" };
const page = (id: string, createdAt: string, kind: "person" | "agent" = "person"): Pick<Page, "id" | "createdAt" | "updatedBy"> => ({
  id,
  createdAt,
  updatedBy: kind === "person" ? person : { kind: "agent", id: "a1", name: "Wren" },
});

describe("arrivals", () => {
  afterEach(() => {
    releaseArrivals([]);
    vi.useRealTimers();
  });

  it("holds only pages first seen during an import, then lets them in one by one", () => {
    vi.useFakeTimers({ now: new Date("2026-10-30T10:00:00Z") });
    const before = page("old", "2026-10-30T09:59:58Z");
    holdArrivals();
    const t = Date.now();
    vi.advanceTimersByTime(500);
    const fresh = page("n1", "2026-10-30T10:00:00Z");
    // Seen before the hold (a seeded page made moments earlier): not held.
    expect(arrivalOf(before, t - 2000)).toBeNull();
    // An agent's new page during the import isn't ours to hold.
    expect(arrivalOf(page("ag", "2026-10-30T10:00:00Z", "agent"), t + 100)).toBeNull();
    expect(arrivalOf(fresh, t + 100)).toEqual({ kind: "held" });

    releaseArrivals(["parent", "n1"], 700);
    const now = Date.now();
    expect(arrivalOf(page("parent", ""), null, now)).toEqual({ kind: "arriving", delayMs: 700 });
    expect(arrivalOf(fresh, t + 100, now)).toEqual({ kind: "arriving", delayMs: 700 + ARRIVE_STAGGER_MS });
    // Long after, cards just show.
    expect(arrivalOf(fresh, t + 100, now + 10_000)).toBeNull();
  });
});
