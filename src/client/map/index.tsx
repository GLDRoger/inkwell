import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import type { Id, MapGraph, Page } from "@shared/types";
import { api, isNotFound } from "../lib/api";
import { emit, subscribe } from "../lib/events";
import { keys } from "../lib/queries";
import { attachGestures, CameraController, fitCamera, visibleWorld, type Cam, type Insets } from "./camera";
import { layoutMap, type CardBox } from "./layout";
import { detailFor, scaleFor, type Detail, type Lod } from "./lod";
import { MapCard } from "./map-card";
import { Minimap } from "./minimap";
import { applyEvent, fromGraph, writingPages, type MapState } from "./model";
import { Roster } from "./roster";
import { SpellBook, type Spell } from "./spells";
import { isTypingTarget, titleOf, useNow, useReducedMotion } from "./util";
import { Banners, Prints, useWalks } from "./walkers";
import { WorldBack, worldFrame } from "./world";
import css from "./map.module.css";

export interface MapViewProps {
  onOpenPage(id: string): void;
  focusPageId?: string;
}

const CAMERA_KEY = "inkwell:map-camera";
const INKED_KEY = "inkwell:map-inked";
const REVEAL_MS = 2600;
const LEVEL_NAME: Record<Lod, string> = { far: "Territory", mid: "Cards", near: "Pages" };

function fixtureParams() {
  if (typeof location === "undefined") return null;
  const q = new URLSearchParams(location.search);
  if (!q.has("fixture") || q.get("fixture") === "0") return null;
  return { pages: Math.max(1, Math.min(2000, Number(q.get("pages")) || 72)), script: q.get("script") !== "0" };
}

function savedCamera(): Cam | null {
  try {
    const c = JSON.parse(sessionStorage.getItem(CAMERA_KEY) ?? "null");
    return c && [c.x, c.y, c.s].every((n) => typeof n === "number" && Number.isFinite(n)) ? c : null;
  } catch {
    return null;
  }
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The map: every page a room on a parchment map, zoomable from the whole
 * territory down to a readable page, with agents and people walking between
 * rooms in real time.
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

  // ------------------------------------------------------------ live state
  const [state, setState] = useState<MapState | null>(null);
  useEffect(() => {
    if (graph) setState((prev) => fromGraph(graph, Date.now(), prev));
  }, [graph]);
  useEffect(() => subscribe((e) => setState((s) => (s ? applyEvent(s, e, Date.now()) : s))), []);

  const pages = state?.pages;
  const pageList = useMemo(() => (pages ? [...pages.values()] : []), [pages]);
  // Portrait screens get a taller territory. Only the orientation matters, so resizing doesn't reshuffle.
  const [portrait, setPortrait] = useState(false);
  const layout = useMemo(() => layoutMap(pageList, undefined, portrait ? 1.05 : 2.1), [pageList, portrait]);
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
  const frontRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const narrow = size.w > 0 && size.w < 640;
  const [detail, setDetail] = useState<Detail>("rooms");
  const detailRef = useRef(detail);
  const [visible, setVisible] = useState<string[]>([]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => () => camera.dispose(), [camera]);

  useLayoutEffect(() => {
    const el = rootRef.current!;
    const measure = () => {
      camera.resize(el.clientWidth, el.clientHeight);
      if (el.clientWidth && el.clientHeight) setPortrait(el.clientWidth / el.clientHeight < 0.8);
      setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [camera]);

  const recull = useCallback((c: Cam, vw: number, vh: number) => {
    if (!vw) return;
    const v = visibleWorld(c, vw, vh);
    const m = Math.max(v.w, v.h) * 0.35;
    const out: string[] = [];
    for (const [id, b] of layoutRef.current.cards) {
      if (b.x + b.w < v.x - m || b.x > v.x + v.w + m || b.y + b.h < v.y - m || b.y > v.y + v.h + m) continue;
      out.push(id);
    }
    setVisible((prev) => (sameList(prev, out) ? prev : out));
  }, []);

  useEffect(
    () =>
      camera.listen((c, vw, vh) => {
        for (const el of [cardsRef.current, labelsRef.current, bannersRef.current]) {
          if (!el) continue;
          el.style.setProperty("--cx", String(c.x));
          el.style.setProperty("--cy", String(c.y));
          el.style.setProperty("--s", String(c.s));
          el.style.setProperty("--hw", String(vw / 2));
          el.style.setProperty("--hh", String(vh / 2));
        }
        const t = `translate(${vw / 2 - c.x * c.s}px, ${vh / 2 - c.y * c.s}px) scale(${c.s})`;
        if (backRef.current) {
          backRef.current.style.transform = t;
          // Dash lengths are in world units; keep them steady on screen (stepped, so panning restyles nothing).
          const k = (1 / c.s).toPrecision(2);
          if (backRef.current.style.getPropertyValue("--k") !== k) backRef.current.style.setProperty("--k", k);
        }
        if (frontRef.current) frontRef.current.style.transform = t;
        const d = detailFor(c.s, vw);
        if (d !== detailRef.current) {
          detailRef.current = d;
          setDetail(d);
        }
        recull(c, vw, vh);
      }),
    [camera, recull],
  );
  useEffect(() => recull(camera.cam, camera.vw, camera.vh), [layout, camera, recull]);

  useEffect(() => {
    camera.onSettle = (c) => {
      try {
        sessionStorage.setItem(CAMERA_KEY, JSON.stringify(c));
      } catch {
        /* private mode: the map just starts fitted next time */
      }
    };
    return () => {
      camera.onSettle = null;
    };
  }, [camera]);

  const insets = useMemo<Insets>(
    () => ({ top: narrow ? 56 : 64, right: 12, bottom: narrow ? 112 : 16, left: 12 }),
    [narrow],
  );
  const fitAll = useCallback(
    () => fitCamera(layoutRef.current.bounds, camera.vw, camera.vh, insets, narrow ? 8 : 32, 0.9),
    [camera, insets, narrow],
  );

  const cameraFor = useCallback(
    (box: CardBox, level: Lod): Cam => {
      const s = scaleFor(level, camera.vw, camera.vh);
      return { x: box.x + box.w / 2, y: box.y + box.h / 2 - (insets.top - insets.bottom) / 2 / s, s };
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

  // First view: the page you came back from, else where you left the map, else all of it.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || !size.w || !layout.cards.size) return;
    placed.current = true;
    if (focusPageId && layout.cards.has(focusPageId)) focusOn(focusPageId, "mid", false);
    else {
      camera.set(savedCamera() ?? fitAll());
      camera.touched = !!savedCamera();
    }
  }, [size, layout, focusPageId, focusOn, fitAll, camera]);
  // Until someone moves the map, keep it fitted as the window changes.
  useEffect(() => {
    if (placed.current && !camera.touched && size.w) camera.set(fitAll());
  }, [size, camera, fitAll]);
  const lastFocus = useRef(focusPageId);
  useEffect(() => {
    if (focusPageId === lastFocus.current) return;
    lastFocus.current = focusPageId;
    if (focusPageId) focusOn(focusPageId, "mid");
  }, [focusPageId, focusOn]);

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

  // ------------------------------------------------------------ find
  const [findOpen, setFindOpen] = useState(false);
  const [q, setQ] = useState("");
  const findRef = useRef<HTMLInputElement>(null);
  const matchIdx = useRef(0);
  const needle = q.trim().toLocaleLowerCase();
  const matches = useMemo(() => {
    if (!needle) return null;
    const ids = layout.regions.flatMap((r) => r.pageIds);
    return ids.filter((id) => titleOf(pages?.get(id)).toLocaleLowerCase().includes(needle));
  }, [needle, layout, pages]);
  const matchSet = useMemo(() => (matches ? new Set(matches) : null), [matches]);
  useEffect(() => {
    matchIdx.current = 0;
  }, [needle]);
  const openFind = useCallback(() => {
    setFindOpen(true);
    requestAnimationFrame(() => findRef.current?.focus());
  }, []);
  const closeFind = useCallback(() => {
    setFindOpen(false);
    setQ("");
    rootRef.current?.focus();
  }, []);

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
          camera.flyTo({ ...camera.cam, s: camera.cam.s * 1.35 }, 200);
          break;
        case "-":
        case "_":
          camera.flyTo({ ...camera.cam, s: camera.cam.s / 1.35 }, 200);
          break;
        case "0":
          camera.flyTo(fitAll());
          break;
        case "f":
        case "F":
          openFind();
          break;
        case "Escape":
          if (findOpen) closeFind();
          else return;
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [book, camera, cast, endReveal, fitAll, openFind, closeFind, findOpen]);

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

  // ------------------------------------------------------------ actions
  const handlers = useRef({
    onActivate: (_id: Id) => {},
    onOpen: (_id: Id) => {},
    onMove: (_id: Id, _x: number, _y: number) => {},
  });
  handlers.current.onActivate = (id) => {
    const d = detailRef.current;
    if (d === "near") return;
    focusOn(id, d === "mid" ? "near" : "mid");
  };
  handlers.current.onOpen = (id) => {
    camera.onSettle?.(camera.cam);
    onOpenPage(id);
  };
  handlers.current.onMove = (id, x, y) => {
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
  const onActivate = useCallback((id: Id) => handlers.current.onActivate(id), []);
  const onOpen = useCallback((id: Id) => handlers.current.onOpen(id), []);
  const onMove = useCallback((id: Id, x: number, y: number) => handlers.current.onMove(id, x, y), []);
  const follow = useCallback((pageId: Id) => focusOn(pageId, "mid"), [focusOn]);

  // ------------------------------------------------------------ walkers
  const emptyState = useMemo(() => fromGraph({ pages: [], links: [], agents: [], runs: [] }, 0), []);
  const live = state ?? emptyState;
  const { walks, spots, register } = useWalks(live, layout, camera, reduced);

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

  // ------------------------------------------------------------ render
  const regionTitle = useMemo(() => new Map(layout.regions.map((r) => [r.id, r.title])), [layout]);
  const crumb = (box: CardBox, page: Page) => {
    const parent = page.parentId ? pages?.get(page.parentId) : null;
    const region = regionTitle.get(box.regionId) ?? "";
    if (box.depth === 0) return box.regionId === "__loose__" ? "Loose leaves" : `${titleOf(page)} · ${layout.regions.find((r) => r.id === box.regionId)?.pageIds.length ?? 1} pages`;
    return parent && parent.id !== box.regionId ? `${region} / ${titleOf(parent)}` : region;
  };
  const agentInk = (p: Page) => (p.updatedBy.kind === "agent" ? (state?.agents.get(p.updatedBy.id)?.color ?? null) : null);
  const levelLabel = LEVEL_NAME[detail === "dots" || detail === "rooms" ? "far" : detail];
  const frame = worldFrame(layout.bounds);
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

  return (
    <div
      ref={rootRef}
      className={css.root}
      lang="en"
      data-detail={detail}
      data-blank={blank || undefined}
      data-finding={matchSet ? "" : undefined}
      tabIndex={0}
      role="application"
      aria-roledescription="map"
      aria-label="Map of your notebook"
      aria-describedby="inkwell-map-help"
      onClickCapture={(e) => {
        if (!blank) return;
        e.stopPropagation();
        e.preventDefault();
        setBlank(false);
        playReveal();
      }}
    >
      <p id="inkwell-map-help" className={css.srOnly}>
        Drag or scroll to move, pinch or Control and scroll to zoom. Arrow keys move, plus and minus zoom, 0 shows
        everything, F finds a page. Enter on a page opens it.
      </p>
      <p className={css.srOnly} aria-live="polite">
        {announce}
      </p>
      <div className={css.paper} aria-hidden />

      <div ref={inkRef} className={css.ink}>
        <div ref={backRef} className={css.world}>
          {state && <WorldBack layout={layout} links={state.links} />}
        </div>

        <div ref={labelsRef} className={css.layer} aria-hidden>
          {layout.regions.map((r) => (
            <div
              key={r.id}
              className={css.regionLabel}
              style={{ "--x": r.x, "--y": r.y, "--w": r.w } as CSSProperties}
              data-busy={writingIn(r.pageIds) || undefined}
            >
              <span className={css.regionName}>
                <span className={css.regionText}>{r.title}</span>
              </span>
              <span className={css.regionMeta}>
                {r.pageIds.length} {r.pageIds.length === 1 ? "page" : "pages"}
              </span>
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
                  touchedInk={agentInk(page)}
                  dim={!!matchSet && !matchSet.has(id)}
                  match={!!matchSet && matchSet.has(id)}
                  crumb={crumb(box, page)}
                  now={now}
                  camera={camera}
                  onActivate={onActivate}
                  onOpen={onOpen}
                  onMove={onMove}
                />
              );
            })}
        </div>

        <div ref={frontRef} className={css.world}>
          <svg
            className={css.worldSvg}
            style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
            viewBox={frame.viewBox}
            aria-hidden
          >
            <Prints walks={walks} />
          </svg>
        </div>

        <div ref={bannersRef} className={css.layer} aria-hidden>
          <Banners state={live} spots={spots} register={register} onFollow={follow} />
        </div>
      </div>
      <div className={css.wash} aria-hidden />

      {state && (
        <div className={css.chrome}>
          <Roster state={state} narrow={narrow} onFollow={follow} />

          <div className={css.find} data-map-control data-open={findOpen || undefined}>
            {findOpen ? (
              <label className={css.findField}>
                <Search size={15} aria-hidden />
                <input
                  ref={findRef}
                  value={q}
                  placeholder="Find a page"
                  aria-label="Find a page"
                  onChange={(e) => setQ(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      closeFind();
                    } else if (e.key === "Enter" && matches?.length) {
                      e.preventDefault();
                      const id = matches[matchIdx.current % matches.length];
                      matchIdx.current++;
                      focusOn(id, "mid");
                    }
                  }}
                />
                {matches && (
                  <span className={css.findCount}>
                    {matches.length ? `${Math.min(matchIdx.current, matches.length) || 1}/${matches.length}` : "none"}
                  </span>
                )}
                <button type="button" className={css.tool} onClick={closeFind} aria-label="Close find">
                  <X size={15} aria-hidden />
                </button>
              </label>
            ) : (
              <button type="button" className={css.findButton} onClick={openFind} aria-label="Find a page" title="Find a page (F)">
                <Search size={16} aria-hidden />
                {!narrow && <kbd>F</kbd>}
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
              width={narrow ? 128 : 196}
              height={narrow ? 88 : 132}
              levelLabel={levelLabel}
              onFit={() => camera.flyTo(fitAll())}
            />
          )}

          {presenting && (
            <p className={css.presents} role="status">
              <span>Messrs {presenters}</span>
              <span>are proud to present</span>
              <b>The Map</b>
            </p>
          )}
        </div>
      )}

      {!state && !error && <p className={css.status}>Unrolling the map…</p>}
      {error && (
        <div className={css.status}>
          <p>{isNotFound(error) ? "The map isn't drawn yet." : "The map couldn't be read."}</p>
          <button type="button" className={css.retry} onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      )}
      {state && layout.cards.size === 0 && (
        <p className={css.status}>Blank parchment. Write a page and it appears here.</p>
      )}
    </div>
  );
}

export default MapView;
