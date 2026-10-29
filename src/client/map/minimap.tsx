import { useEffect, useRef } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { visibleWorld, type CameraController } from "./camera";
import type { MapLayout } from "./layout";
import type { MapState } from "./model";
import { inkOf, type standingSpots } from "./walkers";
import css from "./map.module.css";

interface Props {
  layout: MapLayout;
  state: MapState;
  spots: ReturnType<typeof standingSpots>;
  writing: Map<string, string>;
  camera: CameraController;
  width: number;
  height: number;
  levelLabel: string;
  onFit(): void;
}

/** Read a colour as the canvas would paint it, resolving CSS variables and light-dark(). */
function resolveColor(probe: HTMLElement, value: string): string {
  probe.style.color = value;
  return getComputedStyle(probe).color || value;
}

/**
 * The whole territory at a glance, bottom right: rooms, everyone's pin in
 * their ink, and the part you're looking at. Click or drag to go there.
 */
export function Minimap({ layout, state, spots, writing, camera, width, height, levelLabel, onFit }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
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
        region: resolveColor(pr, "color-mix(in oklab, var(--ink) 7%, transparent)"),
        wall: resolveColor(pr, "color-mix(in oklab, var(--ink) 45%, transparent)"),
        room: resolveColor(pr, "color-mix(in oklab, var(--ink-soft) 38%, transparent)"),
        fresh: resolveColor(pr, "var(--ink-soft)"),
        view: resolveColor(pr, "var(--wax)"),
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
      // The territory in miniature: inked walls round each wing, the rooms shaded in.
      g.fillStyle = palette.region;
      g.strokeStyle = palette.wall;
      g.lineWidth = 0.75;
      for (const r of layout.regions) {
        g.fillRect(ox + r.x * k, oy + r.y * k, Math.max(1, r.w * k), Math.max(1, r.h * k));
        g.strokeRect(ox + r.x * k + 0.5, oy + r.y * k + 0.5, Math.max(1, r.w * k - 1), Math.max(1, r.h * k - 1));
      }
      g.fillStyle = palette.room;
      for (const c of layout.cards.values()) {
        g.fillStyle = writing.has(c.id) ? ink(writing.get(c.id)!) : state.fresh.has(c.id) ? palette.fresh : palette.room;
        g.fillRect(ox + c.x * k, oy + c.y * k, Math.max(1.5, c.w * k), Math.max(1.5, c.h * k));
      }
      for (const w of state.walkers.values()) {
        const s = spots.get(w.key);
        if (!s) continue;
        g.beginPath();
        g.arc(ox + s.pt.x * k, oy + s.pt.y * k, w.kind === "agent" ? 3.5 : 3, 0, Math.PI * 2);
        g.fillStyle = ink(inkOf(w));
        g.fill();
        if (w.kind === "person") {
          g.lineWidth = 1;
          g.strokeStyle = palette.fresh;
          g.stroke();
        }
      }
      const v = visibleWorld(cam, vw, vh);
      g.strokeStyle = palette.view;
      g.lineWidth = 1.25;
      g.strokeRect(ox + v.x * k, oy + v.y * k, v.w * k, v.h * k);
    };
    const off = camera.listen(draw);
    draw(camera.cam, camera.vw, camera.vh);
    return () => {
      off();
      mq?.removeEventListener("change", onScheme);
    };
  }, [camera, width, height, layout, state, spots, writing]);

  const jump = (e: React.PointerEvent, glide: boolean) => {
    const r = e.currentTarget.getBoundingClientRect();
    const { k, ox, oy } = geo.current;
    const x = (e.clientX - r.left - ox) / k;
    const y = (e.clientY - r.top - oy) / k;
    const target = { ...camera.cam, x, y };
    if (glide) camera.flyTo(target, 280);
    else camera.set(target);
  };

  return (
    <div className={css.dock} data-map-control>
      <span ref={probe} className={css.probe} aria-hidden />
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
      <div className={css.zoom}>
        <button type="button" className={css.tool} onClick={() => camera.flyTo({ ...camera.cam, s: camera.cam.s * 1.4 }, 220)} aria-label="Zoom in" title="Zoom in (+)">
          <Plus size={16} aria-hidden />
        </button>
        <button type="button" className={css.tool} onClick={() => camera.flyTo({ ...camera.cam, s: camera.cam.s / 1.4 }, 220)} aria-label="Zoom out" title="Zoom out (−)">
          <Minus size={16} aria-hidden />
        </button>
        <button type="button" className={css.tool} onClick={onFit} aria-label="Fit the whole map" title="Fit (0)">
          <Maximize size={15} aria-hidden />
        </button>
        <span className={css.level} aria-live="polite">
          {levelLabel}
        </span>
      </div>
    </div>
  );
}
