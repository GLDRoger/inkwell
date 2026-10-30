import type { Box } from "./layout";

/** World point at the centre of the viewport, and screen pixels per world unit. */
export interface Cam {
  x: number;
  y: number;
  s: number;
}

export const MIN_SCALE = 0.06;
export const MAX_SCALE = 3;
export const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** The camera that shows `rect` inside the part of the screen the chrome doesn't cover. */
export function fitCamera(rect: Box, vw: number, vh: number, insets: Insets = NO_INSETS, pad = 40, maxScale = 1.1): Cam {
  const w = vw - insets.left - insets.right - pad * 2;
  const h = vh - insets.top - insets.bottom - pad * 2;
  if (!rect.w || !rect.h || w <= 0 || h <= 0) return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, s: 1 };
  const s = clampScale(Math.min(w / rect.w, h / rect.h, maxScale));
  return {
    x: rect.x + rect.w / 2 - (insets.left - insets.right) / 2 / s,
    y: rect.y + rect.h / 2 - (insets.top - insets.bottom) / 2 / s,
    s,
  };
}

export function visibleWorld(c: Cam, vw: number, vh: number): Box {
  return { x: c.x - vw / 2 / c.s, y: c.y - vh / 2 / c.s, w: vw / c.s, h: vh / c.s };
}

export const toScreen = (c: Cam, vw: number, vh: number, x: number, y: number) => ({
  x: (x - c.x) * c.s + vw / 2,
  y: (y - c.y) * c.s + vh / 2,
});

export const toWorld = (c: Cam, vw: number, vh: number, sx: number, sy: number) => ({
  x: (sx - vw / 2) / c.s + c.x,
  y: (sy - vh / 2) / c.s + c.y,
});

/** Zoom by `factor` keeping the world point under screen point (sx, sy) fixed. */
export function zoomAround(c: Cam, factor: number, sx: number, sy: number, vw: number, vh: number): Cam {
  const s = clampScale(c.s * factor);
  const w = toWorld(c, vw, vh, sx, sy);
  return { s, x: w.x - (sx - vw / 2) / s, y: w.y - (sy - vh / 2) / s };
}

interface Tween {
  from: Cam;
  to: Cam;
  /** Pull back to this scale mid-flight on long trips, or null. */
  mid: number | null;
  t0: number;
  ms: number;
}

/** Camera position at progress k (0..1) of a flight: eased, log-space zoom, optional pull-back. */
export function tweenAt(tw: Pick<Tween, "from" | "to" | "mid">, k: number): Cam {
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const a = Math.log(tw.from.s);
  const b = Math.log(tw.to.s);
  let ls = a + (b - a) * e;
  if (tw.mid) {
    const m = 2 * Math.log(tw.mid) - (a + b) / 2;
    ls = (1 - e) * (1 - e) * a + 2 * e * (1 - e) * m + e * e * b;
  }
  return { x: tw.from.x + (tw.to.x - tw.from.x) * e, y: tw.from.y + (tw.to.y - tw.from.y) * e, s: Math.exp(ls) };
}

const reducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export type FrameListener = (cam: Cam, vw: number, vh: number) => void;

/**
 * The map's camera, outside React. Input handlers and flights change it; once
 * per animation frame it calls its listeners, which write CSS variables and
 * transforms straight onto the DOM. Nothing re-renders per frame.
 */
export class CameraController {
  cam: Cam = { x: 0, y: 0, s: 1 };
  vw = 0;
  vh = 0;
  /** False until a person moves the camera; until then a resize refits. */
  touched = false;
  private tween: Tween | null = null;
  private raf = 0;
  private dirty = true;
  private listeners = new Set<FrameListener>();
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private quietUntil = 0;
  /**
   * The next `ms` of movement is the map keeping itself fitted (the diary
   * opening, the window resizing), not someone moving it: the minimap stays asleep.
   */
  hush(ms = 1200) {
    this.quietUntil = (typeof performance !== "undefined" ? performance.now() : Date.now()) + ms;
  }
  get hushed() {
    return (typeof performance !== "undefined" ? performance.now() : Date.now()) < this.quietUntil;
  }
  /** Called a moment after the camera stops moving (save it, recull at leisure). */
  onSettle: ((cam: Cam) => void) | null = null;

  listen(fn: FrameListener): () => void {
    this.listeners.add(fn);
    this.dirty = true;
    this.kick();
    return () => this.listeners.delete(fn);
  }

  resize(vw: number, vh: number) {
    this.vw = vw;
    this.vh = vh;
    this.mark();
  }

  set(c: Cam) {
    this.tween = null;
    this.cam = { ...c, s: clampScale(c.s) };
    this.mark();
  }

  panBy(dx: number, dy: number) {
    this.touched = true;
    this.tween = null;
    this.cam = { ...this.cam, x: this.cam.x - dx / this.cam.s, y: this.cam.y - dy / this.cam.s };
    this.mark();
  }

  zoomAt(factor: number, sx = this.vw / 2, sy = this.vh / 2) {
    this.touched = true;
    this.tween = null;
    this.cam = zoomAround(this.cam, factor, sx, sy, this.vw, this.vh);
    this.mark();
  }

  flyTo(target: Cam, ms?: number) {
    this.touched = true;
    const to = { ...target, s: clampScale(target.s) };
    if (reducedMotion() || ms === 0) return this.set(to);
    const from = { ...this.cam };
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const sMin = Math.min(from.s, to.s);
    // Long trips pull back so the eye keeps its bearings, then settle in.
    const need = (Math.min(this.vw, this.vh) * 0.8) / Math.max(dist, 1);
    const mid = Math.min(sMin, Math.max(MIN_SCALE, need * 1.3));
    this.tween = {
      from,
      to,
      mid: mid < sMin * 0.95 ? mid : null,
      t0: performance.now(),
      ms: ms ?? Math.min(950, 380 + dist * sMin * 0.12),
    };
    this.mark();
  }

  get flying() {
    return !!this.tween;
  }

  stop() {
    this.tween = null;
  }

  private mark() {
    this.dirty = true;
    this.kick();
  }

  private kick() {
    if (this.raf || typeof requestAnimationFrame === "undefined") return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (this.tween) {
      const k = Math.min(1, (now - this.tween.t0) / this.tween.ms);
      this.cam = tweenAt(this.tween, k);
      if (k >= 1) {
        this.cam = { ...this.tween.to };
        this.tween = null;
      }
      this.dirty = true;
    }
    if (this.dirty) {
      this.dirty = false;
      for (const l of this.listeners) l(this.cam, this.vw, this.vh);
      clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => this.onSettle?.(this.cam), 220);
    }
    if (this.tween) this.kick();
  };

  /** Stop any frame in flight. Listeners remove themselves; listening again restarts frames. */
  dispose() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.tween = null;
    clearTimeout(this.settleTimer);
  }
}

export interface GestureOptions {
  /** Return false to let the target handle the pointer itself (controls, dragged cards). */
  canPan(target: HTMLElement): boolean;
  /** Any input at all (skips the ink reveal). */
  onInput?(): void;
}

/**
 * Pan and zoom gestures. Plain wheel or two-finger scroll pans; pinch or
 * Ctrl/Cmd + wheel zooms toward the pointer; dragging empty map pans; two
 * touches pinch. A press only becomes a drag past a few pixels, so cards
 * stay clickable.
 */
export function attachGestures(el: HTMLElement, camera: CameraController, opts: GestureOptions): () => void {
  const onWheel = (e: WheelEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-map-control],[data-scrolls]")) return;
    e.preventDefault();
    opts.onInput?.();
    const r = el.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      // Pinches send small deltas, mouse wheels big ones: cap so a notch is a step.
      const d = Math.max(-60, Math.min(60, e.deltaY * (e.deltaMode === 1 ? 16 : 1)));
      camera.zoomAt(Math.exp(-d * 0.0075), e.clientX - r.left, e.clientY - r.top);
    } else {
      const k = e.deltaMode === 1 ? 16 : 1;
      camera.panBy(-e.deltaX * k, -e.deltaY * k);
    }
  };

  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: number | null = null;
  let origin: { x: number; y: number } | null = null;
  let dragging = false;

  const onDown = (e: PointerEvent) => {
    opts.onInput?.();
    const t = e.target as HTMLElement;
    if (!opts.canPan(t)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    origin = { x: e.clientX, y: e.clientY };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
      dragging = true;
    }
  };
  const onMove = (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    if (!dragging && origin && Math.hypot(next.x - origin.x, next.y - origin.y) > 4) {
      dragging = true;
      el.setPointerCapture?.(e.pointerId);
      el.dataset.panning = "";
    }
    pointers.set(e.pointerId, next);
    if (!dragging) return;
    if (pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = el.getBoundingClientRect();
      camera.zoomAt(d / pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      pinch = d;
    } else camera.panBy(next.x - prev.x, next.y - prev.y);
  };
  const swallow = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  const onUp = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) {
      if (dragging) {
        // The click that ends a drag isn't a click on whatever is under it.
        el.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 0);
      }
      dragging = false;
      origin = null;
      delete el.dataset.panning;
    }
  };
  // Safari's own pinch gestures would zoom the page; the map zooms instead.
  const onGesture = (e: Event) => e.preventDefault();

  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("gesturestart", onGesture);
  return () => {
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
    el.removeEventListener("gesturestart", onGesture);
  };
}
