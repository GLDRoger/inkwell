import { useSyncExternalStore } from "react";
import type { DemoScenario, DemoStep, Id, NotebookKind } from "@shared/types";

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
}

let state: DemoUiState = { notebook: "own", playing: false, scenario: null, index: -1, step: null, focus: {} };
const subs = new Set<() => void>();

export function setDemo(patch: Partial<DemoUiState>) {
  state = { ...state, ...patch };
  subs.forEach((l) => l());
}

export const getDemo = () => state;

export function useDemo<T>(select: (s: DemoUiState) => T): T {
  return useSyncExternalStore(
    (l) => (subs.add(l), () => subs.delete(l)),
    () => select(state),
  );
}
