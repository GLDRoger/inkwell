import { useSyncExternalStore } from "react";
import { TEXT_MODELS, type TextModelId } from "@shared/types";

/**
 * The visitor's own Meta API key and model choice. Kept in this browser's
 * localStorage only and sent with the visitor's own AI requests
 * (X-Meta-Key, X-Meta-Model); the server never stores it. See docs/DEMO-MODE.md.
 */
export const KEY_STORAGE = "inkwell-meta-key";
export const MODEL_STORAGE = "inkwell-meta-model";
export const DEFAULT_MODEL: TextModelId = TEXT_MODELS[0].id;

export interface MetaKeyState {
  key: string | null;
  model: TextModelId;
}

const isModel = (v: unknown): v is TextModelId => TEXT_MODELS.some((m) => m.id === v);

function read(): MetaKeyState {
  try {
    const key = globalThis.localStorage?.getItem(KEY_STORAGE)?.trim() || null;
    const model = globalThis.localStorage?.getItem(MODEL_STORAGE);
    return { key, model: isModel(model) ? model : DEFAULT_MODEL };
  } catch {
    return { key: null, model: DEFAULT_MODEL };
  }
}

let state = read();
const subs = new Set<() => void>();
const publish = () => subs.forEach((l) => l());

/** Tidy what someone pasted: no surrounding spaces, quotes or a leading "Bearer". */
export function cleanKey(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim()
    .replace(/^bearer\s+/i, "")
    .trim();
}

export function saveKey(raw: string, model: TextModelId = state.model) {
  const key = cleanKey(raw);
  state = { key: key || null, model: isModel(model) ? model : DEFAULT_MODEL };
  try {
    if (state.key) localStorage.setItem(KEY_STORAGE, state.key);
    else localStorage.removeItem(KEY_STORAGE);
    localStorage.setItem(MODEL_STORAGE, state.model);
  } catch {
    /* storage blocked: the key lasts for this tab */
  }
  publish();
}

/** Forget the key and the model choice: the next visitor on this browser starts from the default. */
export function forgetKey() {
  state = { key: null, model: DEFAULT_MODEL };
  try {
    localStorage.removeItem(KEY_STORAGE);
    localStorage.removeItem(MODEL_STORAGE);
  } catch {
    /* nothing stored */
  }
  publish();
}

export const getKeyState = () => state;
export const hasKey = () => !!state.key;

export function useMetaKey(): MetaKeyState {
  return useSyncExternalStore(
    (l) => (subs.add(l), () => subs.delete(l)),
    () => state,
  );
}

/** Headers for an AI request: the visitor's key and model when they've added one. */
export function aiHeaders(): Record<string, string> {
  if (!state.key) return {};
  return { "X-Meta-Key": state.key, "X-Meta-Model": state.model };
}

/** "Muse Wonder", or "Muse Spark" for the Contributor tier. */
export function textModelName(model: string | null | undefined = state.model): string {
  return /spark/i.test(model ?? "") ? "Muse Spark" : "Muse Wonder";
}

/** The text model the visitor's next request will use: theirs with a key, the server's default (Wonder) without. */
export const activeModelName = () => (state.key ? textModelName(state.model) : "Muse Wonder");

/** Re-read storage (tests, or another tab changed it). */
export function reloadKey() {
  state = read();
  publish();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY_STORAGE || e.key === MODEL_STORAGE || e.key === null) reloadKey();
  });
}
