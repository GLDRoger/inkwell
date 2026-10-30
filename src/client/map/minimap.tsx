import { useEffect, useRef } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { visibleWorld, type CameraController } from "./camera";
import type { MapLayout } from "./layout";
import type { MapState } from "./model";
import { inkOf, type Standing } from "./walkers";
import css from "./map.module.css";

interface Props {
  layout: MapLayout;
  state: MapState;
  spots: Map<string, Standing>;
  writing: Map<string, string>;
  camera: CameraController;
  width: number;
  height: number;
  /** Small screens: zoom buttons only, no overview. */
  compact: boolean;
  onFit(): void;
}

/** After the map stops moving, the overview waits this long before it fades away. */
const AWAKE_MS = 1600;

/** Read a colour as the canvas would paint it, resolving CSS variables and light-dark(). */
function resolveColor(probe: HTMLElement, value: string): string {
  probe.style.color = value;
  return getComputedStyle(probe).color || value;
}

/**
 * Zoom buttons, bottom right, and above them the whole map at a glance:
 * every page, everyone's dot in their colour, and the part you're looking
 * at. The overview shows itself while the map moves (or while you point at
 * it) and otherwise stays out of the way. Click or drag it to go there.
 */
export function Minimap({ layout, state, spots, writing, camera, width, height, compact, onFit }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  // Outlives the drawing effect (which restarts with every change on the map), so the overview always goes back to sleep.
  const sleep = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(sleep.current), []);
  const probe = useRef<HTMLSpanElement>(null);
  const data = useRef({ layout, state, spots, writing });
  data.current = { layout, state, spots, writing };
  const pad = 8;
  const b = layout.bounds;
  const k = Math.min((width - pad * 2) / Math.max(1, b.w), (height - pad * 2) / Math.max(1, b.h));
  const ox = (width - b.w * k) / 2 - b.x * k;
  const oy = (height - b.h * k) / 2 - b.y * k;
  const geo = useRef({ k, ox, oy });
  geo.current = { k, ox, oy };

  useEffect(() => {
    const canvas = ref.current;
    const pr = probe.current;
    if (!canvas || !pr) return;
    const g = canvas.getContext("2d");
    if (!g) return;
    let palette: Record<string, string> = {};
    const inks = new Map<string, string>();
    const readPalette = () => {
      palette = {
        room: resolveColor(pr, "var(--rule-strong)"),
        fresh: resolveColor(pr, "color-mix(in oklab, var(--ink-faint) 70%, var(--rule-strong))"),
        view: resolveColor(pr, "color-mix(in oklab, var(--ink) 55%, transparent)"),
        viewFill: resolveColor(pr, "color-mix(in oklab, var(--ink) 4%, transparent)"),
      };
      inks.clear();
    };
    const ink = (v: string) => {
      let c = inks.get(v);
      if (!c) inks.set(v, (c = resolveColor(pr, v)));
      return c;
    };
    readPalette();
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onScheme = () => {
      readPalette();
      draw(camera.cam, camera.vw, camera.vh);
    };
    mq?.addEventListener("change", onScheme);
    // The app's own light/dark switch sets an attribute on <html>.
    const mo = new MutationObserver(onScheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });

    const draw = (cam: typeof camera.cam, vw: number, vh: number) => {
      const { layout, state, spots, writing } = data.current;
      const { k, ox, oy } = geo.current;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, width, height);
      // Every page a small block; the ones being written in their agent's colour.
      for (const c of layout.cards.values()) {
        g.fillStyle = writing.has(c.id) ? ink(writing.get(c.id)!) : state.fresh.has(c.id) ? palette.fresh : palette.room;
        g.fillRect(ox + c.x * k, oy + c.y * k, Math.max(1.5, c.w * k), Math.max(1.5, c.h * k));
      }
      for (const w of state.walkers.values()) {
        const s = spots.get(w.key);
        if (!s) continue;
        g.beginPath();
        g.arc(ox + s.pt.x * k, oy + s.pt.y * k, w.kind === "agent" ? 3 : 2.5, 0, Math.PI * 2);
        g.fillStyle = ink(inkOf(w));
        g.fill();
        if (w.kind === "person") {
          g.lineWidth = 1;
          g.strokeStyle = palette.fresh;
          g.stroke();
        }
      }
      const v = visibleWorld(cam, vw, vh);
      g.fillStyle = palette.viewFill;
      g.fillRect(ox + v.x * k, oy + v.y * k, v.w * k, v.h * k);
      g.strokeStyle = palette.view;
      g.lineWidth = 1;
      g.strokeRect(Math.round(ox + v.x * k) + 0.5, Math.round(oy + v.y * k) + 0.5, Math.round(v.w * k), Math.round(v.h * k));
    };
    // Wake the overview while the map moves; let it fade once it's still.
    let last: { x: number; y: number; s: number } | null = null;
    const off = camera.listen((cam, vw, vh) => {
      draw(cam, vw, vh);
      const moved = last && (cam.x !== last.x || cam.y !== last.y || cam.s !== last.s);
      last = { ...cam };
      // A refit for the diary or a resize isn't someone moving the map: don't wake over the cards.
      if (!moved || camera.hushed) return;
      dock.current?.setAttribute("data-awake", "");
      clearTimeout(sleep.current);
      sleep.current = setTimeout(() => dock.current?.removeAttribute("data-awake"), AWAKE_MS);
    });
    draw(camera.cam, camera.vw, camera.vh);
    return () => {
      off();
      mo.disconnect();
      mq?.removeEventListener("change", onScheme);
    };
  }, [camera, width, height, layout, state, spots, writing]);

  const jump = (e: React.PointerEvent, glide: boolean) => {
    const r = e.currentTarget.getBoundingClientRect();
    const { k, ox, oy } = geo.current;
    const x = (e.clientX - r.left - ox) / k;
    const y = (e.clientY - r.top - oy) / k;
    const target = { ...camera.cam, x, y };
    camera.byUser();
    if (glide) camera.flyTo(target, 280);
    else camera.set(target);
  };

  const zoomBy = (f: number) => (camera.byUser(), camera.flyTo({ ...camera.cam, s: camera.cam.s * f }, 220));
  return (
    <div ref={dock} className={css.dock} data-map-control>
      <span ref={probe} className={css.probe} aria-hidden />
      {!compact && (
        <canvas
          ref={ref}
          className={css.minimap}
          style={{ width, height }}
          role="img"
          aria-label="Overview of the whole map. Click to go there."
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            jump(e, true);
          }}
          onPointerMove={(e) => {
            if (e.buttons) jump(e, false);
          }}
        />
      )}
      <div className={css.zoom} role="group" aria-label="Zoom">
        <button type="button" className={css.tool} onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out" title="Zoom out (−)">
          <Minus size={16} strokeWidth={1.75} aria-hidden />
        </button>
        <button type="button" className={css.tool} onClick={onFit} aria-label="Show the whole map" title="Show everything (0)">
          <Maximize size={15} strokeWidth={1.75} aria-hidden />
        </button>
        <button type="button" className={css.tool} onClick={() => zoomBy(1.4)} aria-label="Zoom in" title="Zoom in (+)">
          <Plus size={16} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </div>
  );
}
