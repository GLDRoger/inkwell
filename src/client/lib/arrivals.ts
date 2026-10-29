import { useSyncExternalStore } from "react";
import type { Id, Page } from "@shared/types";
import { prefersReducedMotion } from "./ui";

/**
 * Cards that should arrive on the map one by one (a photo's notes becoming
 * pages). While an import is in flight, pages it creates are held back so
 * they don't pop in before the camera gets there; once it returns, each card
 * gets the moment it starts to appear.
 */
export const ARRIVE_STAGGER_MS = 170;
export const ARRIVE_MS = 650;

let holdingSince: number | null = null;
const startAt = new Map<Id, number>();
let version = 0;
const subs = new Set<() => void>();
const bump = () => {
  version++;
  subs.forEach((l) => l());
};

/** Start holding back pages that arrive from now on (an import is running). */
export function holdArrivals() {
  holdingSince = Date.now();
  bump();
}

/** Let `ids` in, one after another, starting `delayMs` from now. */
export function releaseArrivals(ids: Id[], delayMs = 0) {
  holdingSince = null;
  if (!prefersReducedMotion()) {
    const t0 = Date.now() + delayMs;
    ids.forEach((id, i) => startAt.set(id, t0 + i * ARRIVE_STAGGER_MS));
    const end = t0 + ids.length * ARRIVE_STAGGER_MS + ARRIVE_MS + 500;
    setTimeout(() => {
      for (const id of ids) if ((startAt.get(id) ?? 0) <= end) startAt.delete(id);
      bump();
    }, end - Date.now());
  }
  bump();
}

export type Arrival = { kind: "held" } | { kind: "arriving"; delayMs: number } | null;

/** Server and browser clocks differ a little; a page made more than this before the hold isn't new. */
const CLOCK_SKEW_MS = 60_000;

/**
 * How a card should show right now: held back, arriving after a delay, or
 * plainly. `seenAt` is when this tab first saw the page (the map's fresh-ink
 * time, our clock); only pages first seen during the hold, made by a person
 * and recently created, are held.
 */
export function arrivalOf(page: Pick<Page, "id" | "createdAt" | "updatedBy">, seenAt: number | null, now = Date.now()): Arrival {
  const at = startAt.get(page.id);
  if (at !== undefined) return at + ARRIVE_MS > now ? { kind: "arriving", delayMs: at - now } : null;
  if (
    holdingSince !== null &&
    seenAt !== null &&
    seenAt >= holdingSince &&
    page.updatedBy.kind === "person" &&
    Date.parse(page.createdAt) >= holdingSince - CLOCK_SKEW_MS
  )
    return { kind: "held" };
  return null;
}

/** Re-render when arrivals change. */
export function useArrivals(): number {
  return useSyncExternalStore(
    (l) => (subs.add(l), () => subs.delete(l)),
    () => version,
  );
}
