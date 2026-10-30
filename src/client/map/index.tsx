import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ArrowUpRight, ImagePlus, ScanText } from "lucide-react";
import type { Id, MapGraph, Page } from "@shared/types";
import { api, isNotFound } from "../lib/api";
import { emit, subscribe } from "../lib/events";
import { keys } from "../lib/queries";
import { getDemo, useDemo } from "../lib/demo";
import { getUi, setUi, useUi } from "../lib/ui";
import { paintCover, usePhotoImport } from "../lib/media";
import { attachGestures, CameraController, fitCamera, visibleWorld, type Cam, type Insets } from "./camera";
import { layoutMap, REGION_PAD, unionBox, type Box, type CardBox } from "./layout";
import { detailFor, scaleFor, type Detail, type Lod } from "./lod";
import { ClickIntent } from "./click";
import { Greeting, hello } from "./greeting";
import { CARD_KEYS_ID, CARD_KEYS_TEXT, MapCard } from "./map-card";
import { Minimap } from "./minimap";
import { agentStatuses, applyEvent, fromGraph, writingPages, type MapState } from "./model";
import { Roster, workingLine } from "./roster";
import { SpellBook, type Spell } from "./spells";
import { isTypingTarget, titleOf, useNow, useReducedMotion } from "./util";
import { aspectBucket, overviewCamera } from "./overview";
import { isUntouchedSeed } from "../page/title";
import { Names, Prints, useWalks } from "./walkers";
import { INK_SPAN_MS, inkDelay, WorldBack, worldFrame } from "./world";
import { PeekPanel, panelsSideBySide, type PeekCover } from "../peek/PeekPanel";
import { peekFrom, peekHistory, withPeek } from "../peek/url";
import { FollowGate, peekCamera } from "../peek/follow";
import { useDemoFollow } from "../peek/useDemoFollow";
import { MAP_CAMERA_KEY, useDemoBarRoom } from "../lib/demo-flow";
import { decodeCamera, encodeCamera } from "./saved-camera";
import css from "./map.module.css";

export interface MapViewProps {
  onOpenPage(id: string): void;
  focusPageId?: string;
}

const CAMERA_KEY = MAP_CAMERA_KEY;
const INKED_KEY = "inkwell:map-inked";
const HINT_KEY = "inkwell:map-peek-hint";
/** The hint waits this long after the map first shows its cards. */
const HINT_AFTER_MS = 1800;
const SEEN_KEY = "inkwell:map-last-seen";
const REVEAL_MS = 2600;
/** A page made this recently, while we watched, settles onto the map. */
const BORN_MS = 20_000;
/** Room kept above the map for the greeting when everything's in view, screen px. */
const GREETING_PX = 112;
const GREETING_PX_COMPACT = 88;
/** The greeting needs this much free width beside an open diary. */
const GREETING_MIN_W = 520;

function fixtureParams() {
  if (typeof location === "undefined") return null;
  const q = new URLSearchParams(location.search);
  if (!q.has("fixture") || q.get("fixture") === "0") return null;
  return { pages: Math.max(1, Math.min(2000, Number(q.get("pages")) || 72)), script: q.get("script") !== "0" };
}

/** Where the camera was in this notebook, this tab (see saved-camera.ts). */
function savedCamera(notebook: string): Cam | null {
  try {
    return decodeCamera(sessionStorage.getItem(CAMERA_KEY), notebook);
  } catch {
    return null;
  }
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function lastSeen(): number | null {
  try {
    const t = Number(localStorage.getItem(SEEN_KEY));
    return t > 0 ? t : null;
  } catch {
    return null;
  }
}

/**
 * The map: every page a card on an open canvas, grouped into areas, zoomable
 * from the whole notebook down to a readable page, with agents and people
 * walking between pages in real time.
 */
export function MapView({ onOpenPage, focusPageId }: MapViewProps) {
  const fixture = useMemo(fixtureParams, []);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: keys.map,
    queryFn: api.map,
    enabled: !fixture,
    retry: (n, e) => !isNotFound(e) && n < 2,
  });
  const [fixtureGraph, setFixtureGraph] = useState<MapGraph | null>(null);
  useEffect(() => {
    if (!fixture) return;
    let stop: (() => void) | undefined;
    let dead = false;
    void import("./dev-fixture").then((m) => {
      if (dead) return;
      const g = m.makeFixtureGraph(fixture.pages);
      setFixtureGraph(g);
      (window as unknown as Record<string, unknown>).__inkwellMap = { emit, graph: g };
      if (fixture.script) stop = m.runFixtureScript(g, emit);
    });
    return () => {
      dead = true;
      stop?.();
    };
  }, [fixture]);
  const graph = fixture ? fixtureGraph : query.data;
  // Who "you" are, so a card says "Last edited by you".
  const me = useQuery({ queryKey: keys.me, queryFn: api.me, staleTime: Infinity, enabled: !fixture, retry: 1 });
  const meId = me.data?.person.id ?? null;
  // The recorded demo's notebook is for watching: no moving cards, no editing, no menus.
  // The notebook this map shows. The shell remounts the map when it changes (App.tsx useNotebookHome).
  const [notebook] = useState(() => getDemo().notebook);
  const demo = useDemo((s) => s.notebook === "demo");
  const playing = useDemo((s) => s.playing);
  const demoFocus = useDemo((s) => s.focus);
  const following = demo && playing && !fixture;

  // ------------------------------------------------------------ the peek
  // A single click opens a page beside the map; the URL (?peek=) remembers which.
  const [params, setParams] = useSearchParams();
  const peekId = peekFrom(params);
  const peekRef = useRef(peekId);
  peekRef.current = peekId;
  const setPeek = useCallback(
    (id: Id | null, by: "person" | "demo" = "person") => {
      const how = peekHistory(peekRef.current, id, by);
      if (!how) return;
      peekRef.current = id;
      setParams((q) => new URLSearchParams(withPeek(q, id)), { replace: how === "replace" });
    },
    [setParams],
  );
  /** The demo's caption bar: the map's controls and the camera keep clear of it (lib/demo-flow.ts). */
  const barSpace = useDemoBarRoom(demo).space;
  /** How much of the screen the open peek covers (right edge on wide screens, bottom on phones). */
  const [cover, setCover] = useState<PeekCover>({ right: 0, bottom: 0 });
  const coverRef = useRef(cover);
  coverRef.current = cover;
  const onCover = useCallback((c: PeekCover) => setCover((o) => (o.right === c.right && o.bottom === c.bottom ? o : c)), []);
  /** The demo's follow: paused for a while whenever the viewer moves the map or picks a page. */
  const gate = useRef(new FollowGate());
  const followingRef = useRef(following);
  followingRef.current = following;

  // ------------------------------------------------------------ live state
  const [state, setState] = useState<MapState | null>(null);
  useEffect(() => {
    if (graph) setState((prev) => fromGraph(graph, Date.now(), prev));
  }, [graph]);
  useEffect(() => subscribe((e) => setState((s) => (s ? applyEvent(s, e, Date.now()) : s))), []);

  const pages = state?.pages;
  const pageList = useMemo(() => (pages ? [...pages.values()] : []), [pages]);
  // The areas pack to the screen's shape. A phone held upright lays every area
  // out afresh in a column it can read; wider screens keep the arrangement.
  const [shape, setShape] = useState({ aspect: 2, flow: false });
  const layout = useMemo(() => layoutMap(pageList, "Other pages", shape), [pageList, shape]);
  const writing = useMemo(() => (state ? writingPages(state) : new Map<string, string>()), [state]);
  const reduced = useReducedMotion();
  const now = useNow(15_000);

  // ------------------------------------------------------------ camera
  const camera = useMemo(() => new CameraController(), []);
  const rootRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const bannersRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const backScaleRef = useRef<HTMLDivElement>(null);
  const printsRef = useRef<HTMLDivElement>(null);
  const printsScaleRef = useRef<HTMLDivElement>(null);
  const lastScale = useRef(NaN);
  /** The scale cards and labels were last laid out at. */
  const rendered = useRef(1);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const zoomTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const narrow = size.w > 0 && size.w < 640;
  /** Width left for the map beside an open diary. */
  const [freeW, setFreeW] = useState(0);
  // Phones either way up: smaller chrome, no overview.
  const compact = narrow || (size.h > 0 && size.h < 500);
  const [detail, setDetail] = useState<Detail>("rooms");
  const detailRef = useRef(detail);
  const [visible, setVisible] = useState<string[]>([]);
  const visibleRef = useRef<string[]>([]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => () => camera.dispose(), [camera]);

  useLayoutEffect(() => {
    const el = rootRef.current!;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      camera.resize(w, h);
      if (w && h) {
        const aspect = aspectBucket(w, h);
        const flow = w < 640 && aspect < 0.8;
        setShape((s) => (s.aspect === aspect && s.flow === flow ? s : { aspect, flow }));
      }
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
      const right = Math.max(insetProbe.current?.offsetWidth ?? 0, coverRef.current.right);
      setFreeW((f) => (f === w - right ? f : w - right));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (insetProbe.current) ro.observe(insetProbe.current);
    measure();
    return () => ro.disconnect();
  }, [camera, cover]);

  const recull = useCallback((c: Cam, vw: number, vh: number) => {
    if (!vw) return;
    const v = visibleWorld(c, vw, vh);
    // Generous margin: cards are ready before they arrive, and small pans change nothing.
    const m = Math.max(v.w, v.h) * 0.5;
    const out: string[] = [];
    for (const [id, b] of layoutRef.current.cards) {
      if (b.x + b.w < v.x - m || b.x > v.x + v.w + m || b.y + b.h < v.y - m || b.y > v.y + v.h + m) continue;
      out.push(id);
    }
    // Mounting cards that scroll into view is interruptible: the camera keeps its frame rate.
    if (sameList(visibleRef.current, out)) return;
    visibleRef.current = out;
    startTransition(() => setVisible(out));
  }, []);

  useEffect(
    () =>
      camera.listen((c, vw, vh) => {
        // Zoom is drawn in two speeds. Mid-gesture, layers that were rendered at
        // `rendered.current` are scaled as bitmaps by the compositor (cheap, a
        // touch soft); a moment after the zoom settles, or once the bitmap has
        // been stretched by a third, everything re-renders crisply at the new
        // scale. Panning is always a whole-pixel translate. Neither restyles a card.
        const commit = () => {
          rendered.current = camera.cam.s;
          const s = String(camera.cam.s);
          for (const el of [labelsRef.current, cardsRef.current, bannersRef.current]) el?.style.setProperty("--s", s);
          for (const el of [backScaleRef.current, printsScaleRef.current]) if (el) el.style.transform = `scale(${s})`;
          place(camera.cam, camera.vw, camera.vh);
        };
        const place = (cam: Cam, w: number, h: number) => {
          const ratio = cam.s / rendered.current;
          const tx = w / 2 - cam.x * cam.s;
          const ty = h / 2 - cam.y * cam.s;
          const t =
            ratio === 1
              ? `translate3d(${Math.round(tx)}px, ${Math.round(ty)}px, 0)`
              : `translate3d(${tx}px, ${ty}px, 0) scale(${ratio})`;
          for (const el of [backRef.current, printsRef.current, labelsRef.current, cardsRef.current, bannersRef.current])
            if (el) el.style.transform = t;
        };
        const d = detailFor(c.s, vw);
        if (c.s !== lastScale.current) {
          const first = Number.isNaN(lastScale.current);
          lastScale.current = c.s;
          const ratio = c.s / rendered.current;
          clearTimeout(zoomTimer.current);
          if (first || reducedRef.current || ratio < 0.75 || ratio > 1.33 || d !== detailRef.current) commit();
          else {
            place(c, vw, vh);
            zoomTimer.current = setTimeout(commit, 140);
          }
        } else place(c, vw, vh);
        if (d !== detailRef.current) {
          detailRef.current = d;
          startTransition(() => setDetail(d));
        }
        recull(c, vw, vh);
      }),
    [camera, recull],
  );
  useEffect(() => recull(camera.cam, camera.vw, camera.vh), [layout, camera, recull]);

  useEffect(() => {
    camera.onSettle = (c) => {
      try {
        sessionStorage.setItem(CAMERA_KEY, encodeCamera(c, notebook));
      } catch {
        /* private mode: the map just starts fitted next time */
      }
    };
    return () => {
      camera.onSettle = null;
    };
  }, [camera, notebook]);

  // The free part of the screen: below the shell's bar and the roster, above the
  // zoom buttons, left of an open diary.
  // The shell's variables are calc() expressions, which getComputedStyle hands
  // back unresolved; a hidden probe sized by them reads them in pixels.
  const insetProbe = useRef<HTMLDivElement>(null);
  const insets = useCallback((): Insets => {
    const p = insetProbe.current;
    const top = p?.offsetHeight ?? 0;
    const right = Math.max(p?.offsetWidth ?? 0, cover.right);
    const bottom = compact ? 72 : 64;
    return { top: top + (compact ? 60 : 58), right: right + 12, bottom: bottom + cover.bottom + barSpace, left: 12 };
  }, [compact, cover, barSpace]);
  // Phones on their side, or a map squeezed beside the diary, have no room for the greeting.
  const greets = size.h >= 560 && freeW >= Math.min(GREETING_MIN_W, size.w);
  // The overview: everything, with room above it for the greeting, as long as
  // titles stay readable; past that, a readable part of it.
  const fitAll = useCallback(() => {
    const i = insets();
    const room = greets ? (compact ? GREETING_PX_COMPACT : GREETING_PX) : 0;
    const l = layoutRef.current;
    return overviewCamera(l.bounds, l.cards.values(), camera.vw, camera.vh, { ...i, top: i.top + room }, compact ? 8 : 32, 0.9);
  }, [camera, insets, compact, greets]);
  /** All of it, however small. */
  const fitEverything = useCallback(
    () => fitCamera(layoutRef.current.bounds, camera.vw, camera.vh, insets(), compact ? 8 : 32, 0.9),
    [camera, insets, compact],
  );
  /** "Show the whole map": the overview, and pressed again there, everything. */
  const showWhole = useCallback(() => {
    camera.byUser();
    const o = fitAll();
    const c = camera.cam;
    const atOverview = Math.abs(Math.log(c.s / o.s)) < 0.05 && Math.hypot(c.x - o.x, c.y - o.y) * c.s < 24;
    const all = fitEverything();
    if (atOverview && all.s < o.s * 0.97) camera.flyTo(all);
    else {
      camera.flyTo(o);
      // Back at the overview: keep it fitted again as the window changes, and greet.
      camera.touched = false;
    }
  }, [camera, fitAll, fitEverything]);

  const cameraFor = useCallback(
    (box: CardBox, level: Lod): Cam => {
      const s = scaleFor(level, camera.vw, camera.vh);
      const i = insets();
      return { x: box.x + box.w / 2 + (i.right - i.left) / 2 / s, y: box.y + box.h / 2 - (i.top - i.bottom) / 2 / s, s };
    },
    [camera, insets],
  );

  const focusOn = useCallback(
    (id: Id, level: Lod = "mid", animate = true) => {
      const box = layoutRef.current.cards.get(id);
      if (!box) return;
      const target = cameraFor(box, level);
      if (animate) camera.flyTo(target);
      else camera.set(target);
    },
    [camera, cameraFor],
  );

  // `focus` names one page, or several (comma-separated) to frame together, like a photo's new cards.
  const focusIds = useMemo(() => (focusPageId ? focusPageId.split(",").filter(Boolean) : []), [focusPageId]);
  /** Point the camera at the focus. False when none of its cards are on the map yet. */
  const showFocus = useCallback(
    (ids: Id[], animate: boolean) => {
      const boxes = ids.flatMap((id) => layoutRef.current.cards.get(id) ?? []);
      if (!boxes.length) return false;
      // A chosen view: don't let "keep it fitted" undo it.
      camera.touched = true;
      if (ids.length === 1) {
        focusOn(ids[0], "mid", animate);
        return true;
      }
      // Keep an area's name in view when its first cards are what we're showing (a photo's new cards).
      let frame: Box = unionBox(boxes)!;
      for (const r of layoutRef.current.regions) {
        if (!ids.some((id) => r.pageIds.includes(id))) continue;
        if (frame.y - r.y <= r.head + 8 && r.y < frame.y) frame = { ...frame, y: r.y, h: frame.h + (frame.y - r.y) };
      }
      const target = fitCamera(frame, camera.vw, camera.vh, insets(), narrow ? 16 : 48, 1);
      if (animate) camera.flyTo(target);
      else camera.set(target);
      return true;
    },
    [camera, focusOn, insets, narrow],
  );

  // First view: the page you came back from, else where you left the map, else all of it.
  const placed = useRef(false);
  const lastFocus = useRef(focusPageId);
  const pendingFocus = useRef<Id[] | null>(null);
  useEffect(() => {
    if (placed.current || !size.w || !layout.cards.size) return;
    placed.current = true;
    if (focusIds.length && layout.cards.has(focusIds[0])) {
      // A search result or a photo's cards: fly in from the whole map, so you see where it is.
      camera.set(fitAll());
      if (reduced) showFocus(focusIds, false);
      else requestAnimationFrame(() => showFocus(focusIds, true));
      return;
    }
    if (focusIds.length) pendingFocus.current = focusIds;
    const saved = savedCamera(notebook);
    camera.set(saved ?? fitAll());
    camera.touched = !!saved;
  }, [size, layout, focusIds, showFocus, fitAll, camera, reduced, notebook]);
  // Until someone moves the map, keep it fitted as the window changes, and as
  // the shell's bar and diary settle in or open (they change the free space).
  useEffect(() => {
    if (placed.current && !camera.touched && size.w) {
      camera.hush();
      camera.set(fitAll());
    }
  }, [size, camera, fitAll]);
  useEffect(() => {
    const refit = (animate: boolean) => {
      if (!placed.current || camera.touched) return;
      camera.hush();
      if (animate) {
        camera.flyTo(fitAll());
        camera.touched = false;
      } else camera.set(fitAll());
    };
    const raf = requestAnimationFrame(() => refit(false));
    const shell = rootRef.current?.closest("[data-route]");
    const mo = shell ? new MutationObserver(() => refit(true)) : null;
    if (shell) mo!.observe(shell, { attributes: true, attributeFilter: ["data-route", "data-diary"] });
    return () => {
      cancelAnimationFrame(raf);
      mo?.disconnect();
    };
  }, [camera, fitAll, layout.cards.size]);
  // A new focus flies there; if its cards haven't reached the map yet, wait for them.
  useEffect(() => {
    if (focusPageId !== lastFocus.current) {
      lastFocus.current = focusPageId;
      pendingFocus.current = focusIds.length ? focusIds : null;
    }
    const ids = pendingFocus.current;
    if (!ids || !placed.current) return;
    if (ids.every((id) => layout.cards.has(id)) && showFocus(ids, true)) pendingFocus.current = null;
  }, [focusPageId, focusIds, layout, showFocus]);

  // ------------------------------------------------------------ the ink reveal
  const revealTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const endReveal = useCallback(() => {
    clearTimeout(revealTimer.current);
    rootRef.current?.removeAttribute("data-reveal");
  }, []);
  const playReveal = useCallback(() => {
    const el = rootRef.current;
    if (!el || reduced) return;
    el.removeAttribute("data-reveal");
    void el.offsetWidth;
    el.setAttribute("data-reveal", "");
    clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(endReveal, REVEAL_MS);
  }, [reduced, endReveal]);
  const inked = useRef(false);
  useLayoutEffect(() => {
    if (inked.current || !state || !layout.cards.size) return;
    inked.current = true;
    try {
      if (sessionStorage.getItem(INKED_KEY)) return;
      sessionStorage.setItem(INKED_KEY, "1");
    } catch {
      /* no storage: reveal every time, harmless */
    }
    playReveal();
  }, [state, layout, playReveal]);
  useEffect(() => () => clearTimeout(revealTimer.current), []);

  // ------------------------------------------------------------ the spells
  const [blank, setBlank] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const presentTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cast = useCallback(
    (spell: Spell) => {
      if (spell === "hide") {
        endReveal();
        setPresenting(false);
        setBlank(true);
        return;
      }
      setBlank(false);
      playReveal();
      setPresenting(true);
      clearTimeout(presentTimer.current);
      presentTimer.current = setTimeout(() => setPresenting(false), 6000);
    },
    [endReveal, playReveal],
  );
  useEffect(() => () => clearTimeout(presentTimer.current), []);

  // ------------------------------------------------------------ keys
  const book = useMemo(() => new SpellBook(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const root = rootRef.current;
      if (!root) return;
      const active = document.activeElement;
      if (active && active !== document.body && !root.contains(active)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      endReveal();
      const casting = book.casting(e.key);
      const spell = book.push(e.key);
      if (spell) {
        e.preventDefault();
        e.stopPropagation();
        cast(spell);
        return;
      }
      if (casting && /^[a-z ]$/i.test(e.key)) {
        // Mid-spell: letters and spaces belong to the phrase, not to shortcuts or focused cards.
        e.stopPropagation();
        if (e.key === " ") e.preventDefault();
        return;
      }
      if ((e.target as HTMLElement).closest?.("[data-scrolls]") && e.key.startsWith("Arrow")) return;
      const step = e.shiftKey ? 320 : 80;
      switch (e.key) {
        case "ArrowLeft":
          camera.panBy(step, 0);
          break;
        case "ArrowRight":
          camera.panBy(-step, 0);
          break;
        case "ArrowUp":
          camera.panBy(0, step);
          break;
        case "ArrowDown":
          camera.panBy(0, -step);
          break;
        case "+":
        case "=":
          camera.byUser();
          camera.flyTo({ ...camera.cam, s: camera.cam.s * 1.35 }, 200);
          break;
        case "-":
        case "_":
          camera.byUser();
          camera.flyTo({ ...camera.cam, s: camera.cam.s / 1.35 }, 200);
          break;
        case "0":
          showWhole();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [book, camera, cast, endReveal, showWhole]);

  // ------------------------------------------------------------ gestures
  useEffect(() => {
    const el = rootRef.current!;
    return attachGestures(el, camera, {
      canPan: (t) => {
        if (t.closest("[data-map-control]")) return false;
        // Up close, cards are picked up and moved; far out, the map pans.
        if (t.closest("[data-card]") && (detailRef.current === "mid" || detailRef.current === "near")) return false;
        return true;
      },
      onInput: endReveal,
    });
  }, [camera, endReveal]);

  // ------------------------------------------------------------ card menu
  const [menu, setMenu] = useState<{ id: Id; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback((refocus = false) => {
    setMenu((m) => {
      if (m && refocus) requestAnimationFrame(() => (cardsRef.current?.querySelector(`[data-card="${CSS.escape(m.id)}"]`) as HTMLElement | null)?.focus());
      return null;
    });
  }, []);
  useEffect(() => {
    if (!menu) return;
    requestAnimationFrame(() => menuRef.current?.querySelector("button")?.focus());
    const onDown = (e: PointerEvent) => !menuRef.current?.contains(e.target as Node) && closeMenu();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), closeMenu(true));
    // Moving the map dismisses the menu (listen also fires once straight away; ignore that).
    const at = { ...camera.cam };
    const stopListening = camera.listen((c) => (c.x !== at.x || c.y !== at.y || c.s !== at.s) && closeMenu());
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      stopListening();
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [menu, camera, closeMenu]);
  const onMenu = useCallback((id: Id, x: number, y: number) => {
    const r = rootRef.current?.getBoundingClientRect();
    setMenu({ id, x: x - (r?.left ?? 0), y: y - (r?.top ?? 0) });
  }, []);
  const menuPage = menu ? pages?.get(menu.id) : undefined;
  const importPhoto = usePhotoImport();

  // ------------------------------------------------------------ the peek hint
  // Said once, a moment after the map first shows its cards: how to peek and open a page.
  const [hint, setHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const coarse = useMemo(() => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches, []);
  const dismissHint = useCallback(() => {
    clearTimeout(hintTimer.current);
    setHint(false);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* no storage: it may show again, harmless */
    }
  }, []);
  const hasCards = layout.cards.size > 0;
  useEffect(() => {
    // The demo has its own captions; a deep link to a peek already knows.
    if (!hasCards || demo || fixture) return;
    try {
      if (localStorage.getItem(HINT_KEY)) return;
    } catch {
      return;
    }
    const show = setTimeout(() => {
      if (peekRef.current) return;
      setHint(true);
      try {
        localStorage.setItem(HINT_KEY, "1");
      } catch {
        /* shown once per visit then */
      }
      hintTimer.current = setTimeout(() => setHint(false), 7000);
    }, HINT_AFTER_MS);
    return () => clearTimeout(show);
  }, [hasCards, demo, fixture]);
  useEffect(() => () => clearTimeout(hintTimer.current), []);

  // ------------------------------------------------------------ actions
  const handlers = useRef({
    onPeek: (_id: Id) => {},
    onOpen: (_id: Id) => {},
    onMove: (_id: Id, _x: number, _y: number) => {},
  });
  // A click (or tap) peeks the page beside the map; the demo stops following for a while.
  handlers.current.onPeek = (id) => {
    if (following) gate.current.pause(Date.now());
    if (hint) dismissHint();
    setPeek(id);
  };
  handlers.current.onOpen = (id) => {
    camera.onSettle?.(camera.cam);
    if (hint) dismissHint();
    onOpenPage(id);
  };
  handlers.current.onMove = (id, x, y) => {
    if (demo) return;
    const l = layoutRef.current;
    const box = l.cards.get(id);
    if (!box || (box.x === x && box.y === y)) return;
    const region = l.regions.find((r) => r.id === box.regionId);
    // The first card moved in a region pins the rest where they are, so they don't jump.
    const updates = new Map<Id, { x: number; y: number }>([[id, { x, y }]]);
    if (region && !region.pinned)
      for (const pid of region.pageIds) {
        const b = l.cards.get(pid);
        if (b && pid !== id) updates.set(pid, { x: Math.round(b.x), y: Math.round(b.y) });
      }
    const patchPage = (p: Page) => (updates.has(p.id) ? { ...p, ...updates.get(p.id)! } : p);
    setState((s) => {
      if (!s) return s;
      const next = new Map(s.pages);
      for (const pid of updates.keys()) {
        const p = next.get(pid);
        if (p) next.set(pid, patchPage(p));
      }
      return { ...s, pages: next };
    });
    if (fixture) return;
    client.setQueryData<MapGraph>(keys.map, (old) => (old ? { ...old, pages: old.pages.map(patchPage) } : old));
    for (const [pid, pos] of updates)
      api.updatePage(pid, pos).catch((err) => console.error("[map] couldn't save the card's place", err));
  };
  // A photo's notes arrive placed as on the photo, holes and all; the layout
  // tidies them under their heading. Once they've all arrived, save those
  // places, so from then on they're ordinary cards that stay where moved.
  const settled = useRef(new Set<Id>());
  useEffect(() => {
    if (fixture || demo) return;
    const todo = [...layout.settle].filter(([id]) => !settled.current.has(id));
    if (!todo.length) return;
    const t = setTimeout(() => {
      const at = new Map(todo);
      for (const id of at.keys()) settled.current.add(id);
      // Touched now: the layout stops tidying them, and takes these places as saved.
      const stamp = new Date().toISOString();
      const patchPage = (p: Page) => (at.has(p.id) ? { ...p, ...at.get(p.id)!, updatedAt: stamp } : p);
      setState((st) => {
        if (!st) return st;
        const next = new Map(st.pages);
        for (const id of at.keys()) {
          const p = next.get(id);
          if (p) next.set(id, patchPage(p));
        }
        return { ...st, pages: next };
      });
      client.setQueryData<MapGraph>(keys.map, (old) => (old ? { ...old, pages: old.pages.map(patchPage) } : old));
      for (const [id, pos] of at) api.updatePage(id, pos).catch((err) => console.error("[map] couldn't save the card's place", err));
    }, 2000);
    return () => clearTimeout(t);
  }, [layout, fixture, demo, client]);

  // One click peeks a page; a double-click (or double tap) opens it.
  const clicks = useMemo(
    () => new ClickIntent((id) => handlers.current.onPeek(id), (id) => handlers.current.onOpen(id)),
    [],
  );
  useEffect(() => () => clicks.cancel(), [clicks]);
  const onCardClick = useCallback((id: Id) => clicks.click(id), [clicks]);
  const onOpen = useCallback((id: Id) => {
    clicks.cancel();
    handlers.current.onOpen(id);
  }, [clicks]);
  const onMove = useCallback((id: Id, x: number, y: number) => handlers.current.onMove(id, x, y), []);
  const follow = useCallback((pageId: Id) => focusOn(pageId, "mid"), [focusOn]);

  // ------------------------------------------------------------ peek camera
  // Keep the peeked card in view beside the panel, once the panel has taken its place.
  const midScale = useCallback(() => scaleFor("mid", camera.vw, camera.vh), [camera]);
  // Looked at again when the panel moves or resizes (the diary opening beside it), not on every render.
  const peekShown = useRef<string | null>(null);
  const coverKnown = cover.right > 0 || cover.bottom > 0;
  const peekKey = peekId ? `${peekId}:${cover.right}:${cover.bottom}` : null;
  useEffect(() => {
    if (!peekId || !peekKey) {
      peekShown.current = null;
      return;
    }
    if (!placed.current || !coverKnown || peekShown.current === peekKey) return;
    const box = layout.cards.get(peekId);
    if (!box) return;
    peekShown.current = peekKey;
    const target = peekCamera(box, camera.cam, camera.vw, camera.vh, insets(), midScale());
    if (!target) return;
    if (followingRef.current) camera.hush(1600);
    camera.flyTo(target, followingRef.current ? 1100 : undefined);
  }, [peekId, peekKey, coverKnown, layout, size, camera, insets, midScale]);
  const closePeek = useCallback(() => {
    const id = peekRef.current;
    if (followingRef.current) gate.current.pause(Date.now());
    setPeek(null);
    // Closed from inside the panel: back to the card it showed, for keyboard users.
    if (id && document.activeElement?.closest?.(".peek"))
      requestAnimationFrame(() => (cardsRef.current?.querySelector(`[data-card="${CSS.escape(id)}"]`) as HTMLElement | null)?.focus({ preventScroll: true }));
  }, [setPeek]);
  const onPeekOpenFull = useCallback((id: Id) => handlers.current.onOpen(id), []);
  const onPeekSwap = useCallback((id: Id) => handlers.current.onPeek(id), []);
  // Opening the diary where it and the peek can't sit side by side: the diary comes to the front.
  // The demo wants more of the map in view, so there one panel at a time below DEMO_BOTH_PANELS_MIN_W.
  const diaryOpen = useUi((u) => u.diaryOpen);
  const diaryWas = useRef(diaryOpen);
  useEffect(() => {
    const was = diaryWas.current;
    diaryWas.current = diaryOpen;
    if (!was && diaryOpen && peekRef.current && !panelsSideBySide(window.innerWidth, demo)) setPeek(null);
  }, [diaryOpen, setPeek, demo]);
  // The demo opening a page: the diary makes way where both would squeeze the map.
  const demoPeek = useCallback(
    (id: Id | null, by: "person" | "demo") => {
      if (id && by === "demo" && getUi().diaryOpen && !panelsSideBySide(window.innerWidth, true)) setUi({ diaryOpen: false });
      setPeek(id, by);
    },
    [setPeek],
  );

  // "Watch again" plays a fresh demo notebook: the old peek's page is gone, and the camera starts from the top.
  const starting = useDemo((s) => s.starting);
  const wasStarting = useRef(starting);
  useEffect(() => {
    const was = wasStarting.current;
    wasStarting.current = starting;
    if (!starting || was) return;
    setPeek(null);
    gate.current.reset();
    if (!placed.current) return;
    camera.hush();
    camera.touched = false;
    if (reducedRef.current) camera.set(fitAll());
    else camera.flyTo(fitAll());
    camera.touched = false;
  }, [starting, setPeek, camera, fitAll]);

  // The demo's last frame is the whole notebook, everything the agents made in view,
  // not whichever card the final step happened to be on.
  const ended = useDemo((s) => s.ended);
  const wasEnded = useRef(ended);
  const finale = useRef({ setPeek, fitAll });
  finale.current = { setPeek, fitAll };
  useEffect(() => {
    const was = wasEnded.current;
    wasEnded.current = ended;
    if (ended !== "finished" || was === "finished" || !demo) return;
    // Only the ending re-arms this; peek and layout changes must not cancel it.
    const t = window.setTimeout(() => {
      if (!placed.current) return;
      finale.current.setPeek(null, "demo");
      camera.hush();
      camera.touched = false;
      const whole = finale.current.fitAll();
      if (reducedRef.current) camera.set(whole);
      else camera.flyTo(whole, 1400);
      camera.touched = false;
    }, 1200);
    return () => window.clearTimeout(t);
  }, [ended]);

  // ------------------------------------------------------------ demo camera
  useDemoFollow({ following, focus: demoFocus, camera, gate: gate.current, state, layout, writing, ready: placed, peekRef, setPeek: demoPeek, insets, midScale });

  // ------------------------------------------------------------ walkers
  const emptyState = useMemo(() => fromGraph({ pages: [], links: [], agents: [], runs: [] }, 0), []);
  const live = state ?? emptyState;
  const { store: walkStore, spots, register, scale: nameScale } = useWalks(live, layout, camera, reduced);

  // Say what moved, for screen readers.
  const [announce, setAnnounce] = useState("");
  const lastSeq = useRef(0);
  useEffect(() => {
    if (!state || state.seq === lastSeq.current) return;
    lastSeq.current = state.seq;
    let latest: { name: string; to: Id; action: string; seq: number } | null = null;
    for (const w of state.walkers.values())
      if (w.move && (!latest || w.move.seq > latest.seq))
        latest = { name: w.name, to: w.move.to, action: w.action, seq: w.move.seq };
    if (latest) {
      const where = titleOf(state.pages.get(latest.to));
      setAnnounce(`${latest.name} ${latest.action === "idle" ? "went to" : `is ${latest.action}`} ${where}`);
    }
  }, [state]);

  // New pages, made while we watched: their rooms and titles write themselves in.
  const bornKey = useMemo(() => {
    if (!state) return "";
    const ids: string[] = [];
    for (const [id, at] of state.fresh) {
      const created = Date.parse(state.pages.get(id)?.createdAt ?? "");
      if (now - at < BORN_MS && Math.abs(created - at) < BORN_MS) ids.push(id);
    }
    return ids.sort().join(",");
  }, [state, now]);
  const born = useMemo(() => new Set(bornKey ? bornKey.split(",") : []), [bornKey]);

  // ------------------------------------------------------------ the greeting
  // What's new since you were last on the map: read once, remembered when you leave.
  const since = useMemo(lastSeen, []);
  useEffect(() => {
    const save = () => {
      try {
        localStorage.setItem(SEEN_KEY, String(Date.now()));
      } catch {
        /* no storage: the greeting just gives the hint */
      }
    };
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
  }, []);
  // Worked out once from what was here when you arrived, then only added to: it never recounts under you.
  const greeter = useMemo(() => new Greeting(since), [since]);
  const greetingLine = useMemo(() => {
    if (!state) return "";
    const busy = agentStatuses(state).find((a) => a.working && a.walker?.pageId);
    const where = busy?.walker?.pageId ? state.pages.get(busy.walker.pageId) : undefined;
    const doingNow = busy && where ? workingLine(busy.walker!.action, where) : "";
    const split = doingNow.match(/^(reading|writing in|working in) (.*)$/);
    return greeter.line(pageList, now, busy && split ? { name: busy.agent.name, doing: split[1], where: split[2] } : null);
  }, [state, pageList, greeter, now]);
  // The greeting belongs to the overview: it fades once you move the map, and comes back with "Show the whole map".
  const greetingRef = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      camera.listen((c, _vw, vh) => {
        const el = greetingRef.current;
        if (!el) return;
        const away = camera.touched;
        if (el.hasAttribute("data-away") !== away) el.toggleAttribute("data-away", away);
        if (away) return;
        // When the map is shorter than the screen, the greeting sits just above it, not up by the bar.
        const top = (layoutRef.current.bounds.y - c.y) * c.s + vh / 2;
        const dy = Math.max(0, Math.round(top - 28 - el.offsetHeight - el.offsetTop));
        el.style.translate = dy ? `0 ${dy}px` : "";
      }),
    [camera, greets, layout],
  );

  // ------------------------------------------------------------ render
  const regionTitle = useMemo(() => new Map(layout.regions.map((r) => [r.id, r.title])), [layout]);
  const crumb = (box: CardBox, page: Page) => {
    const parent = page.parentId ? pages?.get(page.parentId) : null;
    const region = regionTitle.get(box.regionId) ?? "";
    if (box.depth === 0) {
      if (box.regionId === "__loose__") return region;
      const n = layout.regions.find((r) => r.id === box.regionId)?.pageIds.length ?? 1;
      return `${titleOf(page)} · ${n} ${n === 1 ? "page" : "pages"}`;
    }
    return parent && parent.id !== box.regionId ? `${region} / ${titleOf(parent)}` : region;
  };
  // The demo pages were all written the moment the notebook was made: say so, as the page does.
  const firstMade = useMemo(() => {
    let t = Infinity;
    let iso = "";
    for (const p of pageList) {
      const v = Date.parse(p.createdAt);
      if (v < t) [t, iso] = [v, p.createdAt];
    }
    return iso ? [{ createdAt: iso }] : [];
  }, [pageList]);
  const agentInk = (p: Page) => (p.updatedBy.kind === "agent" ? (state?.agents.get(p.updatedBy.id)?.color ?? null) : null);
  const frame = worldFrame(layout.bounds);
  const lb = layout.bounds;
  const centre = { x: lb.x + lb.w / 2, y: lb.y + lb.h / 2 };
  const reach = Math.hypot(lb.w, lb.h) / 2;
  const inkAt = (b: { x: number; y: number; w: number; h: number }) => inkDelay(b, centre, reach, INK_SPAN_MS);
  const writingIn = (pageIds: Id[]) => {
    for (const id of pageIds) if (writing.has(id)) return true;
    return false;
  };
  const agentNames = state ? [...state.agents.values()].map((a) => a.name) : [];
  const presenters =
    agentNames.length > 1
      ? `${agentNames.slice(0, -1).join(", ")} & ${agentNames.at(-1)}`
      : agentNames[0] ?? "the Muses of Inkwell";
  const error = !fixture && query.isError ? query.error : null;
  const hour = new Date(now).getHours();

  const view = (
    <div
      ref={rootRef}
      className={css.root}
      lang="en"
      data-detail={detail}
      data-compact={compact || undefined}
      data-blank={blank || undefined}
      data-presenting={presenting || undefined}
      data-peeking={peekId ? "" : undefined}
      // A fully open sheet leaves no room below the bar for the zoom and photo buttons.
      data-sheet-full={cover.bottom > size.h * 0.7 || undefined}
      data-readonly={demo || undefined}
      style={
        {
          ...(cover.right ? { "--map-inset": `${size.w - freeW}px` } : null),
          ...(cover.bottom + barSpace ? { "--map-bottom": `${cover.bottom + barSpace}px` } : null),
        } as CSSProperties
      }
      tabIndex={0}
      role="application"
      aria-roledescription="map"
      aria-label="Map of your notebook"
      aria-describedby="inkwell-map-help"
      // The map's focus ring shows only when Tab brought you here, not while you type on it.
      onKeyUp={(e) => {
        if (e.key === "Tab" && e.target === e.currentTarget) e.currentTarget.setAttribute("data-tabbed", "");
      }}
      onKeyDown={(e) => {
        if (e.key !== "Tab") e.currentTarget.removeAttribute("data-tabbed");
      }}
      onBlur={(e) => e.currentTarget.removeAttribute("data-tabbed")}
      onPointerDown={(e) => e.currentTarget.removeAttribute("data-tabbed")}
      onClickCapture={(e) => {
        if (!blank) return;
        e.stopPropagation();
        e.preventDefault();
        setBlank(false);
        playReveal();
      }}
    >
      <div ref={insetProbe} className={css.insetProbe} aria-hidden />
      <p id="inkwell-map-help" className={css.srOnly}>
        Drag or scroll to move, pinch or Control and scroll to zoom. Arrow keys move, plus and minus zoom, 0 shows
        everything. Click a page, or press Space on it, to peek at it beside the map; double-click it, or press Enter, to
        open it. Escape closes the peek.
      </p>
      <p id={CARD_KEYS_ID} className={css.srOnly}>
        {CARD_KEYS_TEXT}
      </p>
      <p className={css.srOnly} aria-live="polite">
        {announce}
      </p>

      {/* The controls come first, so Tab reaches them before the cards. */}
      {state && (
        <div className={css.chrome}>
          <div className={css.topRow}>
            <Roster state={state} narrow={narrow} room={freeW - 24 - (fixture ? 0 : compact || freeW >= 560 ? 170 : 50)} onFollow={follow} />
            {!fixture && !demo && (
              <button
                type="button"
                className={`${css.pill} ${css.photo}`}
                data-short={(!compact && freeW < 560) || undefined}
                data-map-control
                onClick={() => importPhoto()}
                aria-label="Photo to cards: turn a photo of notes into pages"
                title="Turn a photo of notes into pages"
              >
                <ScanText size={16} strokeWidth={1.75} aria-hidden />
                {/* Beside an open diary on a tablet there's room for the agents' names or this label, not both. */}
                {(compact || freeW >= 560) && <span>Photo to cards</span>}
              </button>
            )}
          </div>

          {layout.cards.size > 0 && (
            <Minimap
              layout={layout}
              state={state}
              spots={spots}
              writing={writing}
              camera={camera}
              width={168}
              height={108}
              compact={compact}
              onFit={showWhole}
            />
          )}

          {hint && !demo && (
            <p className={css.hint} role="status" onClick={() => dismissHint()}>
              {coarse ? "Tap a page to peek." : "Click a page to peek. Double-click to open it."}
            </p>
          )}
        </div>
      )}

      <div ref={inkRef} className={css.ink}>
        <div ref={backRef} className={css.world}>
          <div ref={backScaleRef} className={css.scale}>
            {state && <WorldBack layout={layout} links={state.links} />}
          </div>
        </div>

        {/* Footprints walk under the cards (you see them between pages, never over words), on a
            layer of their own so a fading print never repaints the links. */}
        <div ref={printsRef} className={css.world}>
          <div ref={printsScaleRef} className={css.scale}>
            <svg
              className={css.worldSvg}
              style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
              viewBox={frame.viewBox}
              aria-hidden
            >
              <Prints store={walkStore} />
            </svg>
          </div>
        </div>

        <div ref={labelsRef} className={css.layer} aria-hidden>
          {layout.regions.map((r) => (
            <div
              key={r.id}
              className={css.area}
              style={{ "--x": r.x + REGION_PAD, "--y": r.y + r.head, "--w": r.w - REGION_PAD * 2, "--chars": Math.max(1, r.title.length), "--d": `${inkAt(r)}ms` } as CSSProperties}
              data-busy={writingIn(r.pageIds) || undefined}
            >
              {r.title}
            </div>
          ))}
        </div>

        <div ref={cardsRef} className={css.layer}>
          {state &&
            visible.map((id) => {
              const page = state.pages.get(id);
              const box = layout.cards.get(id);
              if (!page || !box) return null;
              return (
                <MapCard
                  key={id}
                  page={page}
                  box={box}
                  detail={detail}
                  writing={writing.get(id) ?? null}
                  freshAt={state.fresh.get(id) ?? null}
                  born={born.has(id)}
                  inkAt={inkAt(box)}
                  touchedInk={agentInk(page)}
                  crumb={crumb(box, page)}
                  now={now}
                  you={meId !== null && page.updatedBy.kind === "person" && page.updatedBy.id === meId}
                  seeded={isUntouchedSeed(page, firstMade)}
                  movable={!shape.flow && !demo}
                  readOnly={demo}
                  peeked={peekId === id}
                  camera={camera}
                  onClick={onCardClick}
                  onOpen={onOpen}
                  onMove={onMove}
                  onMenu={fixture || demo ? undefined : onMenu}
                />
              );
            })}
        </div>

        <div ref={bannersRef} className={`${css.layer} ${css.names}`} aria-hidden>
          <Names state={live} spots={spots} scale={nameScale} register={register} onFollow={follow} />
        </div>
      </div>

      {state && layout.cards.size > 0 && greets && (
        <div ref={greetingRef} className={css.greeting} data-away={camera.touched || undefined}>
          <span className={css.hello}>{hello(hour)}</span>
          <span className={css.whatsNew}>{greetingLine}</span>
        </div>
      )}

      {menu && menuPage && (
        <div
          ref={menuRef}
          className={css.cardMenu}
          role="menu"
          aria-label={titleOf(menuPage)}
          data-map-control
          style={{ left: Math.min(menu.x, size.w - 220), top: Math.min(menu.y, size.h - 110) }}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const items = [...(menuRef.current?.querySelectorAll("button") ?? [])];
            const i = items.indexOf(document.activeElement as HTMLButtonElement);
            items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu();
              onOpen(menuPage.id);
            }}
          >
            <ArrowUpRight size={15} strokeWidth={1.75} aria-hidden /> Open page
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu(true);
              void paintCover(menuPage);
            }}
          >
            <ImagePlus size={15} strokeWidth={1.75} aria-hidden /> {menuPage.coverUrl ? "Make a new cover" : "Make a cover"}
          </button>
        </div>
      )}

      {presenting && (
        <div className={css.presents} role="status">
          <span className={css.presentsBy}>Messrs {presenters}</span>
          <span className={css.presentsBy}>are proud to present</span>
          <b>The Map</b>
        </div>
      )}
      {blank && (
        <div className={css.managed} role="status">
          <p>Mischief managed.</p>
          <span>Click anywhere to bring the map back.</span>
        </div>
      )}
      {!state && !error && <p className={css.status}>Loading your map…</p>}
      {error && (
        <div className={css.status}>
          <p>{isNotFound(error) ? "There's no map here yet." : "The map couldn't load."}</p>
          <button type="button" className={css.retry} onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      )}
      {state && layout.cards.size === 0 && <p className={css.status}>No pages yet. Write one and it appears here.</p>}
    </div>
  );

  // The peek sits beside the map, outside it: its scrolling and typing aren't the map's gestures and keys.
  return (
    <>
      {view}
      {peekId && (
        <PeekPanel
          pageId={peekId}
          page={pages?.get(peekId)}
          readOnly={demo}
          fixture={!!fixture}
          onClose={closePeek}
          onOpenFull={onPeekOpenFull}
          onSwap={onPeekSwap}
          onCover={onCover}
        />
      )}
    </>
  );
}

export default MapView;
