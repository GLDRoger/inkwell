import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { CameraController } from "./camera";
import type { MapLayout } from "./layout";
import type { MapState, Walker } from "./model";
import {
  FOOT_PATH,
  footprintTrail,
  pointAlong,
  printScale,
  standingSpot,
  stepMs,
  strideFor,
  type Print,
  type Pt,
} from "./footprints";
import css from "./map.module.css";

/** How long a print stays on the parchment before it fades out entirely. */
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

/** Agents walk in their own ink; people in the map's own iron-gall ink, so no person is mistaken for an agent. */
export const PERSON_INK = "var(--ink)";
export const inkOf = (w: Pick<Walker, "kind" | "id" | "color">) =>
  w.kind === "agent" ? (w.color ?? "var(--wax)") : PERSON_INK;

/** Where each placed walker stands: agents first, then people, side by side in a room. */
export function standingSpots(state: MapState, layout: MapLayout): Map<string, { pt: Pt; slot: number; pageId: string }> {
  const byPage = new Map<string, Walker[]>();
  for (const w of state.walkers.values()) {
    if (!w.pageId || !layout.cards.has(w.pageId)) continue;
    const list = byPage.get(w.pageId) ?? [];
    list.push(w);
    byPage.set(w.pageId, list);
  }
  const out = new Map<string, { pt: Pt; slot: number; pageId: string }>();
  for (const [pageId, list] of byPage) {
    list.sort((a, b) => (a.kind === b.kind ? (a.key < b.key ? -1 : 1) : a.kind === "agent" ? -1 : 1));
    const card = layout.cards.get(pageId)!;
    list.forEach((w, slot) => out.set(w.key, { pt: standingSpot(card, slot), slot, pageId }));
  }
  return out;
}

/**
 * Turns walker moves into walks: footprints laid one by one along the way,
 * and the name banner carried along with them. Positions are written to the
 * DOM directly, once a frame, only while someone is walking.
 */
export function useWalks(state: MapState, layout: MapLayout, camera: CameraController, reduced: boolean) {
  const [walks, setWalks] = useState<Walk[]>([]);
  const spots = useMemo(() => standingSpots(state, layout), [state, layout]);
  const seen = useRef(new Map<string, number>());
  const pos = useRef(new Map<string, Pt>());
  const els = useRef(new Map<string, HTMLElement>());
  const driving = useRef(new Map<string, Walk>());
  const spotsRef = useRef(spots);
  spotsRef.current = spots;
  const raf = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const place = useCallback((key: string, p: Pt) => {
    pos.current.set(key, p);
    const el = els.current.get(key);
    if (!el) return;
    el.style.setProperty("--ax", p.x.toFixed(1));
    el.style.setProperty("--ay", p.y.toFixed(1));
  }, []);

  const tick = useCallback(() => {
    raf.current = 0;
    const now = performance.now();
    for (const [key, walk] of driving.current) {
      const progress = (now - walk.t0) / walk.step;
      const el = els.current.get(key);
      if (progress >= walk.prints.length - 1) {
        driving.current.delete(key);
        const spot = spotsRef.current.get(key);
        place(key, spot?.pt ?? pointAlong(walk.prints, Infinity));
        el?.removeAttribute("data-walking");
        continue;
      }
      place(key, pointAlong(walk.prints, Math.max(0, progress)));
      el?.setAttribute("data-walking", "");
    }
    if (driving.current.size) raf.current = requestAnimationFrame(tick);
  }, [place]);

  // New moves become walks; everyone else stands at their spot (rooms move
  // when the layout does). One layout effect, so a walk starts from where the
  // walker was drawn before anyone is re-placed.
  useLayoutEffect(() => {
    const fresh: Walk[] = [];
    for (const w of state.walkers.values()) {
      const move = w.move;
      if (!move) continue;
      const last = seen.current.get(w.key);
      if (last !== undefined && move.seq <= last) continue;
      seen.current.set(w.key, move.seq);
      const to = spots.get(w.key)?.pt;
      if (!to) continue;
      const fromCard = move.from ? layout.cards.get(move.from) : undefined;
      const from = pos.current.get(w.key) ?? (fromCard ? standingSpot(fromCard, 0) : null);
      if (!from || reduced) {
        // Nowhere to walk from (or no motion wanted): just be there.
        driving.current.delete(w.key);
        place(w.key, to);
        const el = els.current.get(w.key);
        if (el && !reduced) {
          el.removeAttribute("data-appear");
          void el.offsetWidth;
          el.setAttribute("data-appear", "");
        }
        continue;
      }
      const stride = strideFor(camera.cam.s);
      const prints = footprintTrail(from, to, { stride, seed: `${w.key}:${move.from}>${move.to}` });
      if (prints.length < 2) {
        place(w.key, to);
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
    for (const [key, s] of spots) if (!driving.current.has(key)) place(key, s.pt);
    if (!fresh.length) return;
    setWalks((cur) => [...cur, ...fresh]);
    for (const walk of fresh) {
      const t = setTimeout(
        () => {
          timers.current.delete(t);
          setWalks((cur) => cur.filter((x) => x.id !== walk.id));
        },
        walk.step * walk.prints.length + PRINT_LIFE_MS + 200,
      );
      timers.current.add(t);
    }
    if (!raf.current) raf.current = requestAnimationFrame(tick);
  });

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      timers.current.forEach(clearTimeout);
    },
    [],
  );

  const register = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) {
        els.current.set(key, el);
        const p = pos.current.get(key) ?? spotsRef.current.get(key)?.pt;
        if (p) {
          el.style.setProperty("--ax", p.x.toFixed(1));
          el.style.setProperty("--ay", p.y.toFixed(1));
        }
        if (driving.current.has(key)) el.setAttribute("data-walking", "");
      } else els.current.delete(key);
    },
    [],
  );

  return { walks, spots, register };
}

/** Footprints, in world units, drawn above the rooms. Each print inks in on cue and fades behind. */
export function Prints({ walks }: { walks: Walk[] }) {
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

const ACTION_TEXT: Record<Walker["action"], string> = {
  reading: "reading",
  writing: "writing",
  thinking: "thinking",
  idle: "",
};

/** Name banners in each walker's ink, standing in their room or walking with their prints. */
export function Banners({
  state,
  spots,
  register,
  onFollow,
}: {
  state: MapState;
  spots: ReturnType<typeof standingSpots>;
  register: (key: string) => (el: HTMLElement | null) => void;
  onFollow(pageId: string): void;
}) {
  const list = [...state.walkers.values()].filter((w) => spots.has(w.key));
  return (
    <>
      {list.map((w) => {
        const spot = spots.get(w.key)!;
        const action = w.kind === "agent" ? ACTION_TEXT[w.action] : "";
        return (
          <button
            key={w.key}
            ref={register(w.key)}
            type="button"
            tabIndex={-1}
            className={css.banner}
            data-kind={w.kind}
            data-action={w.action}
            data-map-control
            style={{ "--who": inkOf(w), "--slot": spot.slot } as CSSProperties}
            onClick={(e) => {
              e.stopPropagation();
              onFollow(spot.pageId);
            }}
          >
            <span className={css.ribbon}>
              <span className={css.who}>{w.name}</span>
              {action && <span className={css.doing}>{action}</span>}
            </span>
            <svg className={css.stand} viewBox="-12 -12 24 24" aria-hidden>
              <use href="#inkwell-foot" transform="translate(-4.2 0) rotate(-88) scale(0.62 -0.62)" />
              <use href="#inkwell-foot" transform="translate(4.2 0) rotate(-92) scale(0.62 0.62)" />
            </svg>
          </button>
        );
      })}
    </>
  );
}
