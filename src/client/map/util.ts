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
/** Lines a far-out card's title may take. */
export const TITLE_LINES = 3;
/** Room an icon (and the gap after it) takes at the start of a title's first line, in characters. */
const ICON_CHARS = 2.5;

/**
 * A title in two parts when it reads "Kind: Name", the way agents name what
 * they make ("Plan: Fundraising notes", "Summary: Startup: launch plan"): the
 * kind is a short lead-in (at most three words) and the name starts with a
 * capital or a digit. Anything else is all name ("Startup: launch plan").
 */
export function splitTitle(title: string): { kind: string | null; name: string } {
  const m = title.match(/^([^:]{1,24}):\s+(\S.*)$/u);
  if (!m) return { kind: null, name: title };
  const kind = m[1].trim();
  const name = m[2].trim();
  if (!kind || kind.split(/\s+/).length > 3 || !/^[\p{Lu}\p{N}\p{Emoji_Presentation}"“'‘(]/u.test(name)) return { kind: null, name: title };
  return { kind, name };
}

/**
 * A far-out card's title. It's set so about TITLE_LINE_CHARS characters fit a
 * line at any zoom, and words are never broken or hyphenated: a long first
 * word shrinks the type a little (to 0.8) so it fits, and the icon goes on a
 * line of its own when it doesn't fit beside it; a long later word, or a title
 * longer than TITLE_LINES lines, ends at a whole word with an ellipsis instead
 * ("Lisbon food &…").
 */
export function farTitle(title: string, opts: { icon?: boolean; lines?: number } = {}): { text: string; fit: number } {
  const words = title.split(/\s+/).filter(Boolean);
  const len = (w: string) => [...w].length;
  const lead = opts.icon ? ICON_CHARS : 0;
  const fit = Math.max(0.8, Math.min(1, TITLE_LINE_CHARS / Math.max(1, len(words[0] ?? ""))));
  const room = TITLE_LINE_CHARS / fit;
  const maxLines = opts.lines ?? TITLE_LINES;
  // Greedy wrap, as the browser would, until a word won't fit or the lines run out.
  let line = 1;
  let used = lead;
  let kept = 0;
  for (const [i, w] of words.entries()) {
    const n = len(w);
    if (i > 0 && n > room + 0.5) break;
    // The icon's room already counts the gap after it.
    const next = used ? used + (i === 0 ? 0 : 1) + n : n;
    if (next <= room + 0.5 || (i === 0 && !lead)) used = next;
    else {
      if (line === maxLines) break;
      line++;
      used = n;
    }
    kept = i + 1;
  }
  if (kept === words.length) return { text: title, fit };
  // Room for the ellipsis on the last line: drop one more word if it would overflow.
  if (kept > 1 && used + 1 > room + 0.5) kept--;
  return { text: `${words.slice(0, Math.max(1, kept)).join(" ")}…`, fit };
}

/** A page with no icon is marked, far out, by its first letter. */
export const initial = (title: string) => ([...title.replace(/^[^\p{L}\p{N}]+/u, "")][0] ?? "·").toUpperCase();
