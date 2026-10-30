import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { CameraController } from "./camera";
import { REGION_PAD, type Box, type MapLayout } from "./layout";
import type { MapState, Walker } from "./model";
import { FOOT_PATH, footprintTrail, pointAlong, printScale, stepMs, strideFor, type Print, type Pt } from "./footprints";
import { areaNameBox, DOT_ONLY, dotOf, labelWidth, placeLabel, SMALL_DOT_X, SMALL_H, type LabelSpot } from "./labels";
import { DOTS_AT, MID_AT } from "./lod";

/** Below this zoom (the overview), names are set a size smaller so they fit between the cards. */
export const SMALL_NAMES_AT = 0.34;
import css from "./map.module.css";

/** How long a print stays on the map before it fades out entirely. */
export const PRINT_LIFE_MS = 3400;

export interface Walk {
  id: string;
  key: string;
  ink: string;
  prints: Print[];
  step: number;
  scale: number;
  t0: number;
}

/**
 * The prints on the map, kept outside React state so laying a trail
 * re-renders only the prints, never the map around them.
 */
export class WalkStore {
  private list: Walk[] = [];
  private subs = new Set<() => void>();
  get = () => this.list;
  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => void this.subs.delete(fn);
  };
  add(walks: Walk[]) {
    if (!walks.length) return;
    this.list = [...this.list, ...walks];
    this.subs.forEach((fn) => fn());
  }
  remove(id: string) {
    this.list = this.list.filter((w) => w.id !== id);
    this.subs.forEach((fn) => fn());
  }
}

/** Agents walk in their own colour; people in the map's ink, so no person is mistaken for an agent. */
export const PERSON_INK = "var(--ink-soft)";
export const inkOf = (w: Pick<Walker, "kind" | "id" | "color">) =>
  w.kind === "agent" ? (w.color ?? "var(--ink-faint)") : PERSON_INK;

const ACTION_TEXT: Record<Walker["action"], string> = {
  reading: "reading",
  writing: "writing",
  thinking: "thinking",
  idle: "",
};
export const actionText = (w: Pick<Walker, "kind" | "action">) => (w.kind === "agent" ? ACTION_TEXT[w.action] : "");

export interface Standing {
  /** Where the name pill sits, placed beside the card for zoom `s`. */
  spot: LabelSpot;
  /** The walker's dot, in world units: where footprints end. */
  pt: Pt;
  slot: number;
  pageId: string;
}

/**
 * Where each placed walker stands: its name just outside its page's card,
 * clear of the titles around it, agents first, then people.
 */
export function standingSpots(state: MapState, layout: MapLayout, s: number): Map<string, Standing> {
  const byPage = new Map<string, Walker[]>();
  for (const w of state.walkers.values()) {
    if (!w.pageId || !layout.cards.has(w.pageId)) continue;
    const list = byPage.get(w.pageId) ?? [];
    list.push(w);
    byPage.set(w.pageId, list);
  }
  const out = new Map<string, Standing>();
  const taken: Box[] = [];
  const far = s < MID_AT;
  const areas = layout.regions.map((r) => areaNameBox(r.x + REGION_PAD, r.y + r.head, r.title, s, r.w - REGION_PAD * 2));
  for (const [pageId, list] of byPage) {
    list.sort((a, b) => (a.kind === b.kind ? (a.key < b.key ? -1 : 1) : a.kind === "agent" ? -1 : 1));
    const card = layout.cards.get(pageId)!;
    // Only the cards around this one can collide with its names.
    const reach = Math.max(card.w, card.h) * 1.5 + 240 / Math.max(s, 0.05);
    const near: Box[] = [];
    for (const c of layout.cards.values()) {
      if (c.id === pageId) continue;
      if (Math.abs(c.x - card.x) < reach && Math.abs(c.y - card.y) < reach) near.push(c);
    }
    list.forEach((w, slot) => {
      // Too far out for names to fit between the cards: just the dot.
      const spot =
        s < DOTS_AT
          ? placeLabel(card, DOT_ONLY, s, { cards: near, areas, taken, far, within: layout.bounds }, DOT_ONLY, DOT_ONLY / 2)
          : s < SMALL_NAMES_AT
            ? placeLabel(card, labelWidth(w.name, actionText(w), true), s, { cards: near, areas, taken, far, within: layout.bounds }, SMALL_H, SMALL_DOT_X)
            : placeLabel(card, labelWidth(w.name, actionText(w)), s, { cards: near, areas, taken, far, within: layout.bounds });
      taken.push(spot.box);
      out.set(w.key, { spot, pt: dotOf(spot, s), slot, pageId });
    });
  }
  return out;
}

/**
 * The zoom names were last placed for. Names are placed again once the zoom
 * has settled somewhere noticeably different, never during a gesture.
 */
function usePlacementScale(camera: CameraController): number {
  const [s, setS] = useState(() => camera.cam.s);
  const sRef = useRef(s);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = camera.listen((c) => {
      if (Math.abs(Math.log(c.s / sRef.current)) < 0.12) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        sRef.current = camera.cam.s;
        setS(camera.cam.s);
      }, 160);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [camera]);
  return s;
}

/**
 * Turns walker moves into walks: footprints laid one by one along the way,
 * with the walker's name carried along. Positions are written to the DOM
 * directly, once a frame, only while someone is walking.
 */
export function useWalks(state: MapState, layout: MapLayout, camera: CameraController, reduced: boolean) {
  const store = useMemo(() => new WalkStore(), []);
  const scale = usePlacementScale(camera);
  const spots = useMemo(() => standingSpots(state, layout, scale), [state, layout, scale]);
  const seen = useRef(new Map<string, number>());
  const pos = useRef(new Map<string, Pt>());
  const els = useRef(new Map<string, HTMLElement>());
  const driving = useRef(new Map<string, Walk>());
  const spotsRef = useRef(spots);
  spotsRef.current = spots;
  const raf = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const later = useCallback((ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }, []);

  /** The anchor and offset last written for each walker, so a remounted name goes back where it was. */
  const applied = useRef(new Map<string, [number, number, number, number]>());
  const paint = useCallback((key: string) => {
    const el = els.current.get(key);
    const a = applied.current.get(key);
    if (!el || !a) return;
    el.style.setProperty("--ax", a[0].toFixed(1));
    el.style.setProperty("--ay", a[1].toFixed(1));
    el.style.setProperty("--dx", a[2].toFixed(1));
    el.style.setProperty("--dy", a[3].toFixed(1));
  }, []);

  /** Stand a walker at its spot: anchored on the card's edge, offset in screen pixels. */
  const stand = useCallback(
    (key: string, st: Standing) => {
      pos.current.set(key, st.pt);
      applied.current.set(key, [st.spot.ax, st.spot.ay, st.spot.dx, st.spot.dy]);
      paint(key);
    },
    [paint],
  );

  /** Mid-walk: the dot rides the walking line. */
  const carry = useCallback(
    (key: string, p: Pt) => {
      pos.current.set(key, p);
      applied.current.set(key, [p.x, p.y, 0, 0]);
      paint(key);
    },
    [paint],
  );

  const tick = useCallback(() => {
    raf.current = 0;
    const now = performance.now();
    for (const [key, walk] of driving.current) {
      const progress = (now - walk.t0) / walk.step;
      const el = els.current.get(key);
      if (progress >= walk.prints.length - 1) {
        driving.current.delete(key);
        const st = spotsRef.current.get(key);
        if (st) stand(key, st);
        else carry(key, pointAlong(walk.prints, Infinity));
        el?.removeAttribute("data-walking");
        continue;
      }
      carry(key, pointAlong(walk.prints, Math.max(0, progress)));
      el?.setAttribute("data-walking", "");
    }
    if (driving.current.size) raf.current = requestAnimationFrame(tick);
  }, [stand, carry]);

  const lay = useCallback(
    (fresh: Walk[]) => {
      if (!fresh.length) return;
      store.add(fresh);
      for (const walk of fresh) later(walk.step * walk.prints.length + PRINT_LIFE_MS + 200, () => store.remove(walk.id));
      if (!raf.current) raf.current = requestAnimationFrame(tick);
    },
    [store, later, tick],
  );

  // New moves become walks; everyone else stands at their spot (spots move
  // when the layout or the zoom does). One layout effect, so a walk starts
  // from where the walker was drawn before anyone is re-placed.
  useLayoutEffect(() => {
    const fresh: Walk[] = [];
    for (const w of state.walkers.values()) {
      const move = w.move;
      if (!move) continue;
      const last = seen.current.get(w.key);
      if (last !== undefined && move.seq <= last) continue;
      seen.current.set(w.key, move.seq);
      const st = spots.get(w.key);
      if (!st) continue;
      const fromCard = move.from ? layout.cards.get(move.from) : undefined;
      const from = pos.current.get(w.key) ?? (fromCard ? { x: fromCard.x + fromCard.w / 2, y: fromCard.y + fromCard.h } : null);
      if (!from || reduced) {
        // Nowhere to walk from (or no motion wanted): just be there.
        driving.current.delete(w.key);
        stand(w.key, st);
        const el = els.current.get(w.key);
        if (el && !reduced) {
          el.removeAttribute("data-appear");
          void el.offsetWidth;
          el.setAttribute("data-appear", "");
        }
        continue;
      }
      const stride = strideFor(camera.cam.s);
      const prints = footprintTrail(from, st.pt, { stride, seed: `${w.key}:${move.from}>${move.to}` });
      if (prints.length < 2) {
        stand(w.key, st);
        continue;
      }
      const walk: Walk = {
        id: `${w.key}#${move.seq}`,
        key: w.key,
        ink: inkOf(w),
        prints,
        step: stepMs(prints.length),
        scale: printScale(stride),
        t0: performance.now() + 16,
      };
      driving.current.set(w.key, walk);
      fresh.push(walk);
    }
    for (const [key, st] of spots) if (!driving.current.has(key)) stand(key, st);
    lay(fresh);
  });

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      timers.current.forEach(clearTimeout);
    },
    [],
  );

  // One stable ref callback per walker, so a re-render doesn't detach and reattach every name.
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const attach = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (!el) {
        els.current.delete(key);
        return;
      }
      els.current.set(key, el);
      if (driving.current.has(key)) el.setAttribute("data-walking", "");
      // Only redraw where it was: moving it is the layout effect's job (it may be about to walk).
      if (applied.current.has(key)) paint(key);
      else {
        const st = spotsRef.current.get(key);
        if (st) stand(key, st);
      }
    },
    [stand, paint],
  );
  const register = useCallback(
    (key: string) => {
      let fn = refs.current.get(key);
      if (!fn) refs.current.set(key, (fn = attach(key)));
      return fn;
    },
    [attach],
  );

  return { store, spots, register, scale };
}

/** Footprints, in world units, drawn above the links. Each print appears on cue and fades behind. */
export function Prints({ store }: { store: WalkStore }) {
  const walks = useSyncExternalStore(store.subscribe, store.get);
  return (
    <>
      <defs>
        <path id="inkwell-foot" d={FOOT_PATH} />
      </defs>
      {walks.map((w) => (
        <g key={w.id} className={css.walk} style={{ "--who": w.ink } as CSSProperties}>
          {w.prints.map((p, i) => (
            <use
              key={i}
              href="#inkwell-foot"
              className={css.print}
              transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.angle.toFixed(1)}) scale(${w.scale.toFixed(3)} ${(p.side === "L" ? -w.scale : w.scale).toFixed(3)})`}
              style={{ animationDelay: `${i * w.step}ms` }}
            />
          ))}
        </g>
      ))}
    </>
  );
}

/** Names on the map: small pills in each walker's colour, beside their page or walking with their prints. */
export function Names({
  state,
  spots,
  scale,
  register,
  onFollow,
}: {
  state: MapState;
  spots: Map<string, Standing>;
  scale: number;
  register: (key: string) => (el: HTMLElement | null) => void;
  onFollow(pageId: string): void;
}) {
  const list = [...state.walkers.values()].filter((w) => spots.has(w.key));
  const tiny = scale < DOTS_AT;
  const small = !tiny && scale < SMALL_NAMES_AT;
  return (
    <>
      {list.map((w) => {
        const spot = spots.get(w.key)!;
        const action = actionText(w);
        return (
          <button
            key={w.key}
            ref={register(w.key)}
            type="button"
            tabIndex={-1}
            className={css.name}
            data-kind={w.kind}
            data-action={w.action}
            data-tiny={tiny || undefined}
            data-small={small || undefined}
            data-map-control
            title={tiny ? w.name : undefined}
            aria-label={w.name}
            style={{ "--who": inkOf(w) } as CSSProperties}
            onClick={(e) => {
              e.stopPropagation();
              onFollow(spot.pageId);
            }}
          >
            <span className={css.nameDot} aria-hidden />
            <span className={css.who}>{w.name}</span>
            {action && <span className={css.doing}>{action}</span>}
          </button>
        );
      })}
    </>
  );
}
