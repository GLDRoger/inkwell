import { useSyncExternalStore } from "react";
import type { Id } from "@shared/types";

/** App-wide UI state that several distant components toggle: the diary and the palette. */
export interface UiState {
  diaryOpen: boolean;
  paletteOpen: boolean;
  /** Text handed to the diary composer (e.g. "Ask an agent" from the palette). */
  diaryDraft: { text: string; agentId: Id | null; nonce: number } | null;
}

let state: UiState = { diaryOpen: false, paletteOpen: false, diaryDraft: null };
const subs = new Set<() => void>();

export function setUi(patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  subs.forEach((l) => l());
}

export const getUi = () => state;

export function useUi<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(
    (l) => (subs.add(l), () => subs.delete(l)),
    () => select(state),
  );
}

export const openDiaryWith = (text: string, agentId: Id | null = null) =>
  setUi({ diaryOpen: true, paletteOpen: false, diaryDraft: { text, agentId, nonce: Date.now() } });

/** Stable per-person colour for carets and presence dots, from a calm ink palette. */
const PERSON_INKS = ["#2f5d8a", "#2f6b4f", "#7a4b8c", "#8a5a1f", "#1f6f78", "#6b3f2a"];
export function personColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return PERSON_INKS[Math.abs(h) % PERSON_INKS.length];
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
