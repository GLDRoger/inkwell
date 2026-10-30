import { useEffect, useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { NotebookKind } from "@shared/types";
import { api } from "./api";
import { fromDemoState, getDemo, initialDemo, setDemo } from "./demo";
import { keys } from "./queries";
import { notify } from "./notices";
import { setUi } from "./ui";
import { hasBeenGuided } from "../guide/seen";

/**
 * Moving between the visitor's own notebook and the recorded demo (docs/DEMO-MODE.md).
 * The store in demo.ts says which one is showing; this starts, stops and leaves
 * the demo and keeps the query cache from mixing the two.
 */

/** The map's saved camera (src/client/map/index.tsx CAMERA_KEY). */
export const MAP_CAMERA_KEY = "inkwell:map-camera";

/**
 * Show another notebook. Every cached query except "me" (the person and the
 * connection flag, the same in both) is dropped and refetched for the new one,
 * so nothing from one notebook flashes up in the other.
 */
export function switchNotebook(client: QueryClient, notebook: NotebookKind) {
  if (getDemo().notebook === notebook) return;
  setDemo({ ...initialDemo(notebook) });
  setUi({ paletteOpen: false, aboutOpen: false, diaryDraft: null });
  // The map remembers where its camera was for this tab; that spot belongs to the other notebook's pages.
  try {
    sessionStorage.removeItem(MAP_CAMERA_KEY);
  } catch {
    /* nothing saved */
  }
  // Stop what's in flight for the old notebook and forget it at once, so nothing
  // from one shows in the other. Refetch a moment later, once the screens that
  // only make sense in the old notebook (its conversation, a peeked page) have gone,
  // so they aren't asked for in the new one.
  const others = { predicate: (q: { queryKey: readonly unknown[] }) => q.queryKey[0] !== keys.me[0] };
  void client.cancelQueries(others);
  for (const q of client.getQueryCache().findAll(others)) q.setState({ data: undefined, dataUpdatedAt: 0, status: "pending", fetchStatus: "idle" });
  setTimeout(() => void client.resetQueries(others), 60);
}

/** "Watch it work": reset the demo notebook, switch to it and play from the top. */
export async function startDemo(client: QueryClient): Promise<boolean> {
  setUi({ guideOpen: false, keyDialog: null });
  setDemo({ starting: true, ended: null });
  try {
    // The first request makes the visitor's session: never race it with a second one.
    await client.ensureQueryData({ queryKey: keys.me, queryFn: api.me });
    const res = await api.startDemo();
    switchNotebook(client, "demo");
    const steps = res.scenario?.steps ?? [];
    const index = typeof res.stepIndex === "number" ? res.stepIndex : 0;
    // The stream (reopened for the demo) brings demo.step events from here; until then, show the first caption.
    setDemo({
      ...fromDemoState({ playing: res.playing ?? true, scenario: res.scenario, stepIndex: Math.min(index, steps.length - 1) }),
      playing: res.playing ?? true,
      ended: null,
      starting: false,
      focus: {},
    });
    return true;
  } catch {
    setDemo({ starting: false });
    notify({ tone: "error", id: "demo", text: "Couldn't start the demo. Try again in a moment." });
    return false;
  }
}

/** "Stop": the recorded runs stop; the demo notebook stays on screen as it is. */
export async function stopDemo() {
  setDemo({ playing: false, ended: "stopped" });
  try {
    await api.stopDemo();
  } catch {
    /* already stopped, or the server is gone: either way nothing is playing */
  }
}

/** "Try it yourself": stop the demo if it's playing and go back to the visitor's own notebook. */
export function leaveDemo(client: QueryClient) {
  const { notebook, playing } = getDemo();
  if (notebook === "demo" && playing) void api.stopDemo().catch(() => {});
  switchNotebook(client, "own");
}

/**
 * Catch up with the server's demo: on a reload mid-demo, and whenever the
 * demo's event stream (re)opens, since steps may have moved on meanwhile.
 * If the demo notebook is gone, go back to the visitor's own.
 */
export async function syncDemo(client: QueryClient) {
  if (getDemo().notebook !== "demo") return;
  try {
    const s = await api.demo();
    if (getDemo().notebook !== "demo") return;
    if (!s.scenario) return leaveDemo(client);
    const current = getDemo();
    const next = fromDemoState(s);
    // Keep the focus (only events carry it) when the step hasn't changed.
    setDemo({ ...next, focus: next.index === current.index ? current.focus : {}, starting: false });
  } catch {
    if (getDemo().notebook === "demo" && !getDemo().scenario) leaveDemo(client);
  }
}

/** "Try it yourself" (from the welcome or the demo): the visitor's own notebook, with the guide the first time. */
export function tryItYourself(client: QueryClient) {
  leaveDemo(client);
  if (!hasBeenGuided()) setUi({ guideOpen: true, diaryOpen: false });
}

// ------------------------------------------------------------ room for the caption bar
/**
 * The demo's caption bar (shell/DemoBar.tsx) is never covered: it carries Stop and
 * Try it yourself. Where there's room it floats centred in the free part of the
 * map; where there isn't (a phone, a bottom sheet, a map squeezed beside the
 * diary), it docks along the bottom in front of everything and the panels
 * (peek, diary) end above it. Either way the map keeps its controls and the
 * camera's framing clear of it.
 *
 * Published on <html>: `data-demo-dock` while docked, and `--demo-bar-space`,
 * the px from the bottom of the screen the bar takes (with a small gap).
 */
export interface DemoBarRoom {
  /** Px from the bottom of the viewport the bar covers, gap included; 0 with no bar. */
  space: number;
  docked: boolean;
}

/** The narrowest free map the floating bar fits into (its 300px minimum plus margins). */
export const DEMO_BAR_MIN_FREE = 340;
/** At or below this width the bar always docks (phones). */
export const DEMO_BAR_DOCK_MAX_W = 640;
const DEMO_BAR_GAP = 8;

/** Dock the bar along the bottom? `free` is the map's width left of the side panels. */
export function demoBarDocked(o: { vw: number; diary: number; peek: number; sheet: boolean }): boolean {
  if (o.vw <= DEMO_BAR_DOCK_MAX_W || o.sheet) return true;
  return o.vw - Math.max(o.diary, o.peek) < DEMO_BAR_MIN_FREE;
}

let barRoom: DemoBarRoom = { space: 0, docked: false };
const barSubs = new Set<() => void>();
let watchers = 0;
let stopWatching: (() => void) | null = null;

function setBarRoom(next: DemoBarRoom) {
  if (next.space === barRoom.space && next.docked === barRoom.docked) return;
  barRoom = next;
  barSubs.forEach((l) => l());
}

/** Measure the bar and what's beside it, then publish where it sits. */
export function measureDemoBar(doc: Document = document) {
  const root = doc.documentElement;
  const bar = doc.querySelector<HTMLElement>(".demo-bar");
  if (!bar) {
    root.removeAttribute("data-demo-dock");
    root.style.removeProperty("--demo-bar-space");
    return setBarRoom({ space: 0, docked: false });
  }
  const win = doc.defaultView ?? window;
  const vw = win.innerWidth;
  const diaryEl = doc.querySelector<HTMLElement>('.app[data-diary="open"] .diary');
  // The diary sits 12px in from the right, with 12px between it and the map.
  const diary = diaryEl && vw > DEMO_BAR_DOCK_MAX_W ? diaryEl.offsetWidth + 24 : 0;
  const peek = parseFloat(root.style.getPropertyValue("--peek-cover-right")) || 0;
  const sheet = !!doc.querySelector('.peek[data-mode="sheet"]');
  const docked = demoBarDocked({ vw, diary, peek, sheet });
  // Docking moves and resizes the bar: settle that before measuring it.
  if (root.hasAttribute("data-demo-dock") !== docked) root.toggleAttribute("data-demo-dock", docked);
  const bottom = parseFloat(win.getComputedStyle(bar).bottom) || 0;
  const space = Math.round(bar.offsetHeight + bottom + DEMO_BAR_GAP);
  const value = `${space}px`;
  if (root.style.getPropertyValue("--demo-bar-space") !== value) root.style.setProperty("--demo-bar-space", value);
  setBarRoom({ space, docked });
}

/** Keep the bar's room up to date while anything that shows it is mounted. Ref-counted. */
export function watchDemoBar(): () => void {
  if (typeof document === "undefined") return () => {};
  watchers++;
  if (!stopWatching) {
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measureDemoBar();
      });
    };
    let observed: HTMLElement | null = null;
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    const follow = () => {
      const bar = document.querySelector<HTMLElement>(".demo-bar");
      if (bar !== observed) {
        if (observed) ro?.unobserve(observed);
        if (bar) ro?.observe(bar);
        observed = bar;
      }
      schedule();
    };
    // The bar coming and going, the diary opening, the peek turning into a sheet or moving.
    const mo = new MutationObserver(follow);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-diary", "data-mode"] });
    const rootMo = new MutationObserver(schedule);
    rootMo.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", schedule);
    follow();
    measureDemoBar();
    stopWatching = () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      rootMo.disconnect();
      ro?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }
  return () => {
    watchers--;
    if (watchers > 0 || !stopWatching) return;
    stopWatching();
    stopWatching = null;
    // Nobody is showing the demo any more: nothing stays docked or lifted.
    document.documentElement.removeAttribute("data-demo-dock");
    document.documentElement.style.removeProperty("--demo-bar-space");
    setBarRoom({ space: 0, docked: false });
  };
}

export const getDemoBarRoom = () => barRoom;

/** Where the demo's caption bar is, for panels and the map camera to keep clear of it. */
export function useDemoBarRoom(active = true): DemoBarRoom {
  useEffect(() => (active ? watchDemoBar() : undefined), [active]);
  return useSyncExternalStore(
    (l) => (barSubs.add(l), () => barSubs.delete(l)),
    () => barRoom,
    () => barRoom,
  );
}
