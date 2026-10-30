import { useSyncExternalStore } from "react";
import type { DemoScenario, DemoState, DemoStep, Id, NotebookKind, ServerEvent } from "@shared/types";

/**
 * Which notebook the app is showing, and where the demo is. One small store so
 * distant parts (map camera, peek panel, diary, banner) agree. The flow layer
 * (welcome, banner, events) writes it; the map and peek panel read it.
 * See docs/DEMO-MODE.md.
 */
export interface DemoUiState {
  /** "demo" while the visitor watches the recorded demo; "own" otherwise. */
  notebook: NotebookKind;
  playing: boolean;
  scenario: DemoScenario | null;
  index: number;
  step: DemoStep | null;
  /** What the camera and peek panel should show for the current step. */
  focus: { pageId?: Id; agentId?: Id; runId?: Id };
  /** How the demo last ended, while the visitor is still looking at it (null while it plays, or before it starts). */
  ended: "finished" | "stopped" | null;
  /** Waiting for POST /api/demo/start to answer. */
  starting: boolean;
}

/** Remembered for this tab only, so a reload mid-demo comes back to the demo (see restoreDemo in demo-flow.ts). */
export const NOTEBOOK_KEY = "inkwell-notebook";

function savedNotebook(): NotebookKind {
  try {
    return globalThis.sessionStorage?.getItem(NOTEBOOK_KEY) === "demo" ? "demo" : "own";
  } catch {
    return "own";
  }
}

export const initialDemo = (notebook: NotebookKind = "own"): DemoUiState => ({
  notebook,
  playing: false,
  scenario: null,
  index: -1,
  step: null,
  focus: {},
  ended: null,
  starting: false,
});

let state: DemoUiState = initialDemo(savedNotebook());
const subs = new Set<() => void>();

export function setDemo(patch: Partial<DemoUiState>) {
  state = { ...state, ...patch };
  if (patch.notebook) {
    try {
      if (patch.notebook === "demo") sessionStorage.setItem(NOTEBOOK_KEY, "demo");
      else sessionStorage.removeItem(NOTEBOOK_KEY);
    } catch {
      /* storage blocked: a reload lands on the visitor's own notebook */
    }
  }
  subs.forEach((l) => l());
}

export const getDemo = () => state;

export function useDemo<T>(select: (s: DemoUiState) => T): T {
  return useSyncExternalStore(
    (l) => (subs.add(l), () => subs.delete(l)),
    () => select(state),
  );
}

/** Is the app showing the read-only demo notebook? */
export const inDemo = () => state.notebook === "demo";

/** The store's fields for a server snapshot (POST /api/demo/start, GET /api/demo). */
export function fromDemoState(s: DemoState): Partial<DemoUiState> {
  const steps = s.scenario?.steps ?? [];
  const index = s.stepIndex >= 0 && s.stepIndex < steps.length ? s.stepIndex : -1;
  return {
    playing: s.playing,
    scenario: s.scenario,
    index,
    step: index >= 0 ? steps[index] : null,
    ended: s.playing ? null : s.scenario && index >= steps.length - 1 ? "finished" : s.scenario ? "stopped" : null,
  };
}

/** Apply a demo.* server event to the store. Other events are ignored. */
export function applyDemoEvent(e: ServerEvent) {
  if (state.notebook !== "demo") return;
  if (e.type === "demo.step") {
    // A late event from an earlier step never moves the demo backwards.
    if (state.playing && e.index < state.index) return;
    setDemo({ playing: true, index: e.index, step: e.step, focus: e.focus ?? {}, ended: null, starting: false });
  } else if (e.type === "demo.ended") {
    setDemo({ playing: false, ended: e.reason, starting: false });
  }
}

/** The provenance chip for a step's model, as people say it. */
export function stepModelLabel(model: string | undefined | null): string | null {
  if (!model) return null;
  const parts = model.split("+").map((m) => {
    const id = m.trim().toLowerCase();
    if (id.startsWith("sam")) return "SAM 3.1";
    if (id.includes("voice")) return "Muse Voice";
    if (id.includes("image")) return "Muse Image";
    // Recorded text runs use Wonder; older cassettes still say muse-spark.
    return "Muse Wonder";
  });
  return parts.join(" + ");
}
