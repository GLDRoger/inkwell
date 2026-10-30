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
