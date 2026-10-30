import { useEffect, useState } from "react";

export function ago(iso: string | number, now: number): string {
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 45) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = h / 24;
  if (d < 14) return `${Math.round(d)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const titleOf = (p: { title?: string | null } | undefined | null) => p?.title?.trim() || "Untitled";

export function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Re-renders every `ms` so relative times and fresh ink age. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Keys typed into a field belong to the field, not the map. */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.closest) return false;
  return !!el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']");
}

/** About how many characters fit on a line of a far-out card's title (see .chipTitle). */
export const TITLE_LINE_CHARS = 10;

/**
 * A far-out card's title. It's set so about TITLE_LINE_CHARS characters fit a
 * line at any zoom, and words are never broken or hyphenated: a long first
 * word shrinks the type a little (to 0.8) so it fits; a long later word ends
 * the title there with an ellipsis instead ("Lisbon food &…").
 */
export function farTitle(title: string): { text: string; fit: number } {
  const words = title.split(/\s+/).filter(Boolean);
  const len = (w: string) => [...w].length;
  const fit = Math.max(0.8, Math.min(1, TITLE_LINE_CHARS / Math.max(1, len(words[0] ?? ""))));
  const room = TITLE_LINE_CHARS / fit;
  const cut = words.findIndex((w, i) => i > 0 && len(w) > room + 0.5);
  if (cut === -1) return { text: title, fit };
  return { text: `${words.slice(0, cut).join(" ")}…`, fit };
}

/** A page with no icon is marked, far out, by its first letter. */
export const initial = (title: string) => ([...title.replace(/^[^\p{L}\p{N}]+/u, "")][0] ?? "·").toUpperCase();
