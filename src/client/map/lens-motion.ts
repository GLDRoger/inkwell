import { useLayoutEffect, useRef, type RefObject } from "react";
import type { Id } from "@shared/types";
import type { Box } from "./layout";

/**
 * Cards flying between their place on the map and their place in a lens.
 *
 * A card is placed from --x/--y (world units) plus a flight offset --fx/--fy.
 * When a lens comes or goes, each card jumps to its new place at once and its
 * offset is animated from "where it was" back to zero, on a spring. The offset
 * is in world units, so the camera can fly at the same time and the card keeps
 * its true size and crisp text all the way. Interrupting a flight (the lens
 * cleared halfway in) starts the next one from wherever the card is.
 */

let registered = false;
/** --fx/--fy must be typed numbers to be animated. Without @property, cards simply jump. */
export function registerFlightProps() {
  if (registered || typeof CSS === "undefined" || typeof CSS.registerProperty !== "function") return;
  registered = true;
  for (const name of ["--fx", "--fy"])
    try {
      CSS.registerProperty({ name, syntax: "<number>", inherits: false, initialValue: "0" });
    } catch {
      /* already registered (hot reload) */
    }
}

/**
 * A damped spring as a CSS linear() easing, and how long it takes to settle.
 * Stiff enough to feel deliberate, damped so it overshoots by about 2%.
 */
export function springEasing(stiffness = 70, damping = 13, samples = 48): { easing: string; ms: number } {
  const dt = 1 / 240;
  let x = 0;
  let v = 0;
  let t = 0;
  const trace: number[] = [0];
  while (t < 3) {
    const a = -stiffness * (x - 1) - damping * v;
    v += a * dt;
    x += v * dt;
    t += dt;
    trace.push(x);
    if (Math.abs(x - 1) < 0.002 && Math.abs(v) < 0.02) break;
  }
  const n = trace.length - 1;
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) pts.push(String(Math.round(trace[Math.round((i / samples) * n)] * 1000) / 1000));
  pts[pts.length - 1] = "1";
  return { easing: `linear(${pts.join(", ")})`, ms: Math.round(t * 1000) };
}

const SPRING = springEasing();
const supportsLinear = () => typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("animation-timing-function", "linear(0, 1)");

/** The stagger between cards, and its cap so a big lens still lands quickly. */
export const STAGGER_MS = 42;
export const STAGGER_CAP_MS = 520;
export const flightDelay = (order: number) => Math.min(STAGGER_CAP_MS, order * STAGGER_MS);

/** The offset a card is drawn at right now, mid-flight. */
function currentOffset(el: HTMLElement): { x: number; y: number } {
  const cs = getComputedStyle(el);
  return { x: Number.parseFloat(cs.getPropertyValue("--fx")) || 0, y: Number.parseFloat(cs.getPropertyValue("--fy")) || 0 };
}

interface Flight {
  el: HTMLElement;
  from: Box;
  to: Box;
  order: number;
}

function fly(flights: Flight[], reduced: boolean) {
  const linear = supportsLinear();
  for (const f of flights) {
    const running = f.el.getAnimations().filter((a) => (a as Animation & { id: string }).id === "lens-flight");
    const off = running.length ? currentOffset(f.el) : { x: 0, y: 0 };
    running.forEach((a) => a.cancel());
    if (reduced) {
      // No travel: the card fades out where it was and in where it goes.
      const a = f.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: "cubic-bezier(0.65, 0, 0.35, 1)" });
      a.id = "lens-flight";
      continue;
    }
    const dx = f.from.x - f.to.x + off.x;
    const dy = f.from.y - f.to.y + off.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    const delay = flightDelay(f.order);
    f.el.setAttribute("data-flying", "");
    const a = f.el.animate(
      [
        { "--fx": dx, "--fy": dy },
        { "--fx": 0, "--fy": 0 },
      ] as Keyframe[],
      { duration: linear ? SPRING.ms : 760, delay, easing: linear ? SPRING.easing : "cubic-bezier(0.3, 1.25, 0.5, 1)", fill: "backwards" },
    );
    a.id = "lens-flight";
    // A lift while it travels: it rises off the paper a touch, then settles.
    const lift = f.el.animate([{ scale: 1 }, { scale: 1.035, offset: 0.35 }, { scale: 1 }], { duration: (linear ? SPRING.ms : 760) * 0.9, delay, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    lift.id = "lens-flight";
    const done = () => {
      if (!f.el.getAnimations().some((x) => (x as Animation & { id: string }).id === "lens-flight" && x.playState === "running")) f.el.removeAttribute("data-flying");
    };
    a.onfinish = done;
    a.oncancel = done;
  }
}

/**
 * Fly the cards (and widgets) in `layer` whenever `key` changes: the lens came,
 * went or was replaced. `places` is where everything is drawn now; the hook
 * remembers the last ones, so it knows where each card is flying from.
 */
export function useLensFlight(layer: RefObject<HTMLElement | null>, key: string, places: { cards: Map<Id, Box>; widgets: Map<Id, Box> }, order: (id: Id) => number, reduced: boolean) {
  const prev = useRef<{ key: string; places: typeof places } | null>(null);
  useLayoutEffect(() => {
    registerFlightProps();
    const p = prev.current;
    prev.current = { key, places };
    const el = layer.current;
    if (!p || p.key === key || !el) return;
    const flights: Flight[] = [];
    for (const node of el.querySelectorAll<HTMLElement>("[data-card],[data-widget]")) {
      const id = node.dataset.card ?? node.dataset.widget!;
      const map = node.dataset.card ? "cards" : "widgets";
      const from = p.places[map].get(id);
      const to = places[map].get(id);
      if (!from || !to || (from.x === to.x && from.y === to.y)) continue;
      flights.push({ el: node, from, to, order: order(id) });
    }
    fly(flights, reduced);
  });
}
