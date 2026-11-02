import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Lasso } from "lucide-react";
import type { Id } from "@shared/types";
import { toWorld, type CameraController } from "./camera";
import type { Box } from "./layout";
import { lassoAround, recognize, type Gesture, type Pt, type Target } from "./stroke";
import css from "./map.module.css";

/**
 * The pen. With it on, a stroke on the map is ink in your colour: circle some
 * cards to ask about just those, draw from one card to another to link them,
 * strike one out to delete it. Whatever the stroke meant (or if it meant
 * nothing) the ink then dries and fades, like everything else written here.
 *
 * Strokes live in world units and are drawn on a screen-sized SVG whose group
 * follows the camera, so a pinch while the ink dries keeps it on its cards.
 */

type Phase = "wet" | "held" | "dry" | "miss" | "drawn";
interface Stroke {
  id: number;
  pts: Pt[];
  phase: Phase;
  /** The demo's lasso draws itself in. */
  animate?: boolean;
}

export type Choice =
  | { kind: "link"; from: Id; to: Id; at: { x: number; y: number }; stroke: number }
  | { kind: "strike"; pageId: Id; at: { x: number; y: number }; stroke: number };

/** Smooth a polyline into quadratic curves through the midpoints. */
export function strokePath(pts: Pt[]): string {
  if (!pts.length) return "";
  if (pts.length < 3) return `M${pts[0].x},${pts[0].y}` + pts.slice(1).map((p) => ` L${p.x},${p.y}`).join("");
  const r = (n: number) => Math.round(n * 10) / 10;
  let d = `M${r(pts[0].x)},${r(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q${r(pts[i].x)},${r(pts[i].y)} ${r(mx)},${r(my)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${r(last.x)},${r(last.y)}`;
}

const DRY_MS = 1700;
const MISS_MS = 750;
const LASSO_DRAW_MS = 1500;
const LASSO_HOLD_MS = 3400;

export interface PenProps {
  camera: CameraController;
  /** Pen mode is on: strokes draw. Off, the layer only shows the demo's lasso. */
  active: boolean;
  ink: string;
  reduced: boolean;
  /** The cards a stroke can mean, in world units, topmost last. */
  targets(): Target[];
  boxOf(id: Id): Box | null;
  titleOf(id: Id): string;
  onCircle(ids: Id[]): void;
  onLink(from: Id, to: Id): void;
  onStrike(id: Id): void;
  /** The demo circles these cards, as if a hand drew it. */
  lasso: { key: string; ids: Id[] } | null;
}

export function Pen(p: PenProps) {
  const { camera } = p;
  const root = useRef<HTMLDivElement>(null);
  const group = useRef<SVGGElement>(null);
  const live = useRef<SVGPathElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [chip, setChip] = useState<{ text: string; at: Pt } | null>(null);
  const seq = useRef(0);
  const drawing = useRef<{ pointer: number; pts: Pt[] } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const props = useRef(p);
  props.current = p;

  // The group follows the camera; so does the demo's chip.
  useLayoutEffect(
    () =>
      camera.listen((c, vw, vh) => {
        const tx = vw / 2 - c.x * c.s;
        const ty = vh / 2 - c.y * c.s;
        group.current?.setAttribute("transform", `translate(${tx} ${ty}) scale(${c.s})`);
        const el = chipRef.current;
        const at = el?.dataset.x ? { x: Number(el.dataset.x), y: Number(el.dataset.y) } : null;
        if (el && at) el.style.transform = `translate(${Math.round(at.x * c.s + tx)}px, ${Math.round(at.y * c.s + ty)}px)`;
      }),
    [camera],
  );

  const setPhase = useCallback((id: number, phase: Phase) => {
    setStrokes((list) => list.map((s) => (s.id === id ? { ...s, phase } : s)));
    if (phase === "dry" || phase === "miss") later(phase === "dry" ? DRY_MS : MISS_MS, () => setStrokes((list) => list.filter((s) => s.id !== id)));
  }, []);

  // A choice closes when the map moves under it, on Escape, or when pen mode ends.
  useEffect(() => {
    if (!choice) return;
    const at = { ...camera.cam };
    const off = camera.listen((c) => {
      if (c.x !== at.x || c.y !== at.y || c.s !== at.s) close(false);
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close(false);
    };
    window.addEventListener("keydown", onKey, true);
    requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>("[data-primary]")?.focus());
    return () => {
      off();
      window.removeEventListener("keydown", onKey, true);
    };
  }, [choice]); // eslint-disable-line react-hooks/exhaustive-deps
  const choiceRef = useRef(choice);
  choiceRef.current = choice;
  const close = (accept: boolean) => {
    const c = choiceRef.current;
    if (!c) return;
    choiceRef.current = null;
    setChoice(null);
    setPhase(c.stroke, "dry");
    if (accept) {
      if (c.kind === "link") props.current.onLink(c.from, c.to);
      else props.current.onStrike(c.pageId);
    }
  };
  useEffect(() => {
    if (!p.active && choice) close(false);
  }, [p.active]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ drawing
  const worldAt = (e: { clientX: number; clientY: number }) => {
    const r = root.current!.getBoundingClientRect();
    return toWorld(camera.cam, camera.vw, camera.vh, e.clientX - r.left, e.clientY - r.top);
  };
  const paintLive = () => {
    const d = drawing.current;
    live.current?.setAttribute("d", d ? strokePath(d.pts) : "");
  };
  const finish = (e: { clientX: number; clientY: number }) => {
    const d = drawing.current;
    drawing.current = null;
    paintLive();
    if (!d || d.pts.length < 2) return;
    const id = ++seq.current;
    const gesture: Gesture = recognize(d.pts, props.current.targets(), 1 / camera.cam.s);
    setStrokes((list) => [...list, { id, pts: d.pts, phase: gesture.kind === "none" ? "miss" : "held" }]);
    if (gesture.kind === "none") {
      later(MISS_MS, () => setStrokes((list) => list.filter((s) => s.id !== id)));
      return;
    }
    const r = root.current!.getBoundingClientRect();
    const at = { x: Math.min(e.clientX - r.left + 12, r.width - 250), y: Math.min(e.clientY - r.top + 12, r.height - 120) };
    if (gesture.kind === "circle") {
      props.current.onCircle(gesture.pageIds);
      later(900, () => setPhase(id, "dry"));
    } else if (gesture.kind === "link") setChoice({ kind: "link", from: gesture.from, to: gesture.to, at, stroke: id });
    else setChoice({ kind: "strike", pageId: gesture.pageId, at, stroke: id });
  };

  const onDown = (e: React.PointerEvent) => {
    if (!p.active || (e.pointerType === "mouse" && e.button !== 0)) return;
    if ((e.target as HTMLElement).closest("[data-pen-ui]")) return;
    e.preventDefault();
    if (choice) close(false);
    if (e.pointerType === "touch") {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size >= 2) {
        // Two fingers: that's the map moving, not writing. Drop the stroke.
        drawing.current = null;
        paintLive();
        const [a, b] = [...touches.current.values()];
        pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
        return;
      }
    }
    root.current?.setPointerCapture(e.pointerId);
    drawing.current = { pointer: e.pointerId, pts: [worldAt(e)] };
  };
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" && touches.current.has(e.pointerId)) {
      const prev = touches.current.get(e.pointerId)!;
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size >= 2 && pinch.current) {
        const [a, b] = [...touches.current.values()];
        const dd = Math.hypot(a.x - b.x, a.y - b.y);
        const r = root.current!.getBoundingClientRect();
        camera.zoomAt(dd / pinch.current, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        camera.panBy((e.clientX - prev.x) / 2, (e.clientY - prev.y) / 2);
        pinch.current = dd;
        return;
      }
    }
    const d = drawing.current;
    if (!d || d.pointer !== e.pointerId) return;
    const events = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent];
    const min = 1.5 / camera.cam.s;
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const w = worldAt(ev);
      const last = d.pts[d.pts.length - 1];
      if (Math.hypot(w.x - last.x, w.y - last.y) >= min) d.pts.push(w);
    }
    paintLive();
  };
  const onUp = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") {
      touches.current.delete(e.pointerId);
      if (touches.current.size < 2) pinch.current = null;
    }
    if (drawing.current?.pointer === e.pointerId) finish(e);
  };
  const onCancel = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    pinch.current = null;
    if (drawing.current?.pointer === e.pointerId) {
      drawing.current = null;
      paintLive();
    }
  };

  // ------------------------------------------------------------ the demo's lasso
  const lassoKey = p.lasso?.key ?? "";
  useEffect(() => {
    const ids = props.current.lasso?.ids ?? [];
    const boxes = ids.flatMap((id) => props.current.boxOf(id) ?? []);
    if (!boxes.length) return;
    const pts = lassoAround(boxes);
    const id = ++seq.current;
    setStrokes((list) => [...list, { id, pts, phase: "drawn", animate: true }]);
    const top = pts.reduce((m, q) => (q.y < m.y ? q : m), pts[0]);
    const drawMs = props.current.reduced ? 240 : LASSO_DRAW_MS;
    later(drawMs, () => setChip({ text: `${ids.length} ${ids.length === 1 ? "page" : "pages"} circled`, at: { x: top.x, y: top.y } }));
    later(drawMs + LASSO_HOLD_MS, () => {
      setPhase(id, "dry");
      setChip(null);
    });
  }, [lassoKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Place the chip as soon as it mounts; the camera listener keeps it there.
  useLayoutEffect(() => {
    const el = chipRef.current;
    if (!el || !chip) return;
    const c = camera.cam;
    el.style.transform = `translate(${Math.round((chip.at.x - c.x) * c.s + camera.vw / 2)}px, ${Math.round((chip.at.y - c.y) * c.s + camera.vh / 2)}px)`;
  }, [chip, camera]);

  const title = (id: Id) => `“${p.titleOf(id)}”`;
  return (
    <div
      ref={root}
      className={css.pen}
      data-pen-layer
      data-active={p.active || undefined}
      style={{ "--pen": p.ink } as CSSProperties}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
      aria-hidden={!p.active && !choice ? true : undefined}
    >
      <svg className={css.penSvg} aria-hidden>
        <g ref={group}>
          {strokes.map((s) => (
            <path key={s.id} d={strokePath(s.pts)} data-phase={s.phase} data-draw={s.animate || undefined} pathLength={s.animate ? 1 : undefined} style={s.animate ? ({ "--draw-ms": `${p.reduced ? 240 : LASSO_DRAW_MS}ms` } as CSSProperties) : undefined} />
          ))}
          <path ref={live} data-phase="wet" />
        </g>
      </svg>
      {chip && (
        <div ref={chipRef} className={css.penChip} data-x={chip.at.x} data-y={chip.at.y} role="status">
          <span>
            <Lasso size={13} strokeWidth={1.75} aria-hidden />
            {chip.text}
          </span>
        </div>
      )}
      {choice && (
        <div className={css.penChoice} data-pen-ui role="dialog" aria-label={choice.kind === "link" ? "Link these pages?" : "Delete this page?"} style={{ left: choice.at.x, top: choice.at.y }}>
          <p>{choice.kind === "link" ? <>Link {title(choice.from)} and {title(choice.to)}?</> : <>Delete {title(choice.pageId)}?</>}</p>
          <div>
            <button type="button" data-primary data-danger={choice.kind === "strike" || undefined} onClick={() => close(true)}>
              {choice.kind === "link" ? "Link these" : "Delete page"}
            </button>
            <button type="button" onClick={() => close(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
