import type { Page } from "@shared/types";
import { pageTitle } from "../lib/queries";

/**
 * What the command palette lists for a query, without any rendering, so the
 * ordering rules can be tested:
 *
 * - Pages whose titles match come first, then actions whose names or
 *   keywords match ("dark" finds Dark mode), unless an action matches much
 *   better than any page title.
 * - "Ask an agent: …" and "New page …" are always offered explicitly for
 *   typed text. They're only the Enter default when nothing else matches.
 * - Pages that only mention the words (full-text search) come last, so the
 *   highlighted row doesn't jump when those results arrive. They're
 *   "Mentioned in" when they have every word you typed, else "Related".
 */

export type ActionId = "diary" | "new" | "map" | "photo" | "cover" | "theme" | "about" | "welcome";

export interface ActionDef {
  id: ActionId;
  label: string;
  /** Extra words people might type to find it. */
  keywords: string[];
}

export type Section = "Pages" | "Actions" | "Ask or create" | "Mentioned in" | "Related";

export type Entry =
  | { kind: "page"; section: Section; page: Page; detail?: string }
  | { kind: "show-on-map"; section: Section; page: Page }
  | { kind: "action"; section: Section; action: ActionDef }
  | { kind: "ask"; section: Section; text: string }
  | { kind: "new-titled"; section: Section; text: string };

export const entryKey = (e: Entry): string =>
  e.kind === "page" ? `page-${e.page.id}` : e.kind === "show-on-map" ? `map-${e.page.id}` : e.kind === "action" ? e.action.id : e.kind;

export function actionDefs({
  theme,
  here,
  onMap = false,
}: {
  theme: "light" | "dark";
  here?: Pick<Page, "title" | "coverUrl"> | null;
  /** Already looking at the map: don't offer to open it. */
  onMap?: boolean;
}): ActionDef[] {
  const list: ActionDef[] = [
    { id: "diary", label: "Open the diary", keywords: ["diary", "chat", "agent", "agents", "ask", "conversation", "talk", "message"] },
    { id: "new", label: "New page", keywords: ["create", "add", "write", "blank"] },
  ];
  if (!onMap) list.push({ id: "map", label: "Open the map", keywords: ["home", "overview", "all", "pages", "back"] });
  list.push({ id: "photo", label: "Turn a photo of notes into cards", keywords: ["photo", "image", "picture", "scan", "import", "camera", "upload", "sticky"] });
  if (here)
    list.push({
      id: "cover",
      label: `${here.coverUrl ? "Make a new cover for" : "Make a cover for"} “${pageTitle(here)}”`,
      keywords: ["cover", "image", "picture", "illustrate", "art"],
    });
  list.push(
    {
      id: "theme",
      label: theme === "dark" ? "Light mode" : "Dark mode",
      keywords: ["dark", "light", "theme", "mode", "night", "day", "appearance", "colour", "color", "switch"],
    },
    { id: "about", label: "About this notebook", keywords: ["about", "help", "privacy", "private", "account", "data", "info", "days"] },
    { id: "welcome", label: "Show the welcome again", keywords: ["welcome", "intro", "introduction", "tour", "start"] },
  );
  return list;
}

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** 0: the name or a keyword starts with what you typed; 1: every word you typed starts a word; -1: no match. */
export function actionScore(action: ActionDef, q: string): number {
  const needle = q.trim().toLowerCase();
  if (!needle) return 1;
  const label = action.label.toLowerCase();
  const vocab = [...words(action.label), ...action.keywords];
  if (label.startsWith(needle) || action.keywords.some((k) => k.startsWith(needle))) return 0;
  const typed = words(needle);
  return typed.length && typed.every((t) => vocab.some((w) => w.startsWith(t))) ? 1 : -1;
}

/** 0: title starts with it; 1: a word in the title does; 2: it's somewhere in the title; -1: no match. */
export function titleScore(page: Page, q: string): number {
  const needle = q.trim().toLowerCase();
  const t = pageTitle(page).toLowerCase();
  if (!needle) return 0;
  return t.startsWith(needle) ? 0 : t.split(/\s+/).some((w) => w.startsWith(needle)) ? 1 : t.includes(needle) ? 2 : -1;
}

/** Rank pages by title match: prefix, then word-start, then substring. Most recent first for an empty query. */
export function rankPages(pages: Page[], q: string, limit = 8): Page[] {
  if (!q.trim()) return [...pages].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, limit);
  const scored: [number, Page][] = [];
  for (const p of pages) {
    const s = titleScore(p, q);
    if (s >= 0) scored.push([s, p]);
  }
  return scored.sort((a, b) => a[0] - b[0] || pageTitle(a[1]).localeCompare(pageTitle(b[1]))).slice(0, limit).map((x) => x[1]);
}

/** Search snippets come from markdown; show them as plain words. */
export function plainSnippet(md: string): string {
  return md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(/- \[[ xX]\]\s*/g, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Does the page's title or snippet contain every word typed (each as the start of a word)? */
export function mentionsAll(hit: { page: Page; snippet: string }, q: string): boolean {
  const typed = words(q);
  if (!typed.length) return false;
  const have = words(`${pageTitle(hit.page)} ${plainSnippet(hit.snippet)}`);
  return typed.every((t) => have.some((w) => w.startsWith(t)));
}

export interface PaletteInput {
  q: string;
  pages: Page[];
  /** Full-text hits from the server, once they arrive. */
  hits?: { page: Page; snippet: string }[];
  actions: ActionDef[];
}

export function paletteEntries({ q, pages, hits = [], actions }: PaletteInput): Entry[] {
  const text = q.trim();
  if (!text) {
    return [
      ...rankPages(pages, "", 5).map((page): Entry => ({ kind: "page", section: "Pages", page })),
      ...actions.map((action): Entry => ({ kind: "action", section: "Actions", action })),
    ];
  }

  const titled = rankPages(pages, text, 6);
  const pageEntries: Entry[] = titled.map((page) => ({ kind: "page", section: "Pages", page }));
  if (titled[0]) pageEntries.push({ kind: "show-on-map", section: "Pages", page: titled[0] });

  const scoredActions = actions
    .map((a) => [actionScore(a, text), a] as const)
    .filter(([s]) => s >= 0)
    .sort((a, b) => a[0] - b[0]);
  const actionEntries: Entry[] = scoredActions.map(([, action]) => ({ kind: "action", section: "Actions", action }));

  // An action that starts with what you typed beats pages that only contain it.
  const bestPage = titled[0] ? titleScore(titled[0], text) : Infinity;
  const actionsFirst = scoredActions[0]?.[0] === 0 && bestPage > 0;

  const create: Entry[] = [{ kind: "ask", section: "Ask or create", text }];
  if (!pages.some((p) => pageTitle(p).toLowerCase() === text.toLowerCase())) create.push({ kind: "new-titled", section: "Ask or create", text });

  // The server returns pages with every word when there are any, else pages with some of them.
  // One word is always a real mention; for more, a hit showing them all means the rest have them too.
  const section: Section = words(text).length <= 1 || hits.some((h) => mentionsAll(h, text)) ? "Mentioned in" : "Related";
  const shown = new Set(titled.map((p) => p.id));
  const mentioned: Entry[] = [];
  for (const hit of hits) {
    if (shown.has(hit.page.id) || mentioned.length >= 5) continue;
    shown.add(hit.page.id);
    mentioned.push({ kind: "page", section, page: hit.page, detail: plainSnippet(hit.snippet) });
  }

  return [...(actionsFirst ? [...actionEntries, ...pageEntries] : [...pageEntries, ...actionEntries]), ...create, ...mentioned];
}
