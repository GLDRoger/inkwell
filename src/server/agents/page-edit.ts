/**
 * Pure page-edit logic for agent tools. Agents read a block view of the live
 * document (see blockView) plus a version token; writes check that token so an
 * agent never overwrites text a person typed after the agent last read.
 */
import { createHash } from "node:crypto";
import type { JSONContent } from "@tiptap/core";
import {
  blockRoundTrips, blockView, getEditorSchema, markdownToBlocks, type ViewBlock,
} from "../editor-schema.ts";
import { ToolFailure } from "./errors.ts";

export const PAGE_CHANGED = "The page changed since you read it. Read it again, then retry.";
const UNSAFE_BLOCK = "That part of the page holds a table cell with several paragraphs or a list, which can't be edited as markdown without losing content. Edit text outside it, or ask the person to change it in the editor.";

export function pageVersion(markdown: string): string {
  return createHash("sha256").update(markdown).digest("base64url").slice(0, 12);
}

export function readView(json: JSONContent) {
  const view = blockView(json);
  return { ...view, version: pageVersion(view.markdown) };
}

const doc = (content: JSONContent[]): JSONContent =>
  ({ type: "doc", content: content.length ? content : [{ type: "paragraph" }] });

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Exact match first; if there is none, a match that only differs in whitespace. */
function locate(markdown: string, find: string): { at: number; length: number }[] {
  const exact: { at: number; length: number }[] = [];
  for (let at = markdown.indexOf(find); at >= 0 && exact.length < 2; at = markdown.indexOf(find, at + 1)) {
    exact.push({ at, length: find.length });
  }
  if (exact.length || !find.trim()) return exact;
  const pattern = find.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
  const loose: { at: number; length: number }[] = [];
  const re = new RegExp(pattern, "g");
  for (let m = re.exec(markdown); m && loose.length < 2; m = re.exec(markdown)) loose.push({ at: m.index, length: m[0].length });
  return loose;
}

/** The longest stretch of `find` (prefix or suffix) that does appear, with some context. */
export function nearestSnippet(markdown: string, find: string): string | null {
  const longest = (piece: (n: number) => string) => {
    let lo = 0, hi = Math.min(find.length, 400);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (markdown.includes(piece(mid))) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  const prefix = longest((n) => find.slice(0, n));
  const suffix = longest((n) => find.slice(find.length - n));
  const best = Math.max(prefix, suffix);
  if (best < 6) return null;
  const at = prefix >= suffix ? markdown.indexOf(find.slice(0, prefix)) : markdown.indexOf(find.slice(find.length - suffix));
  const start = Math.max(0, at - 60);
  const end = Math.min(markdown.length, at + Math.max(best, Math.min(find.length, 240)) + 60);
  return `${start > 0 ? "…" : ""}${markdown.slice(start, end)}${end < markdown.length ? "…" : ""}`;
}

/**
 * Replace one unique piece of text, re-parsing only the blocks it touches.
 * A stale version still applies when the text is found unchanged in the
 * current page: only the matched blocks are rebuilt, from current content, so
 * a person's edits elsewhere survive (a three-way merge at block level).
 */
export function applyFind(current: JSONContent, version: string, find: string, replacement: string) {
  const view = readView(current);
  const stale = version !== view.version;
  const matches = locate(view.markdown, find);
  if (!matches.length) {
    if (stale) throw new ToolFailure(PAGE_CHANGED);
    const near = nearestSnippet(view.markdown, find);
    throw new ToolFailure(`Text not found. Copy find exactly from read_page.${near ? ` Nearest text on the page: ${JSON.stringify(near)}` : ""}`);
  }
  if (matches.length > 1) throw new ToolFailure("That text appears more than once. Include more of the surrounding text in find.");
  const { at, length } = matches[0]!;
  const end = at + length;
  let touched = view.blocks.filter((b) => b.start < end && b.end > at);
  if (!touched.length) touched = view.blocks.filter((b) => b.start <= end && b.end >= at);
  if (!touched.length) throw new ToolFailure("Text not found. Copy find exactly from read_page.");
  if (touched.some((b) => !blockRoundTrips(b))) throw new ToolFailure(UNSAFE_BLOCK);
  const first = view.blocks.indexOf(touched[0]!);
  const last = view.blocks.indexOf(touched.at(-1)!);
  const spanStart = Math.min(at, touched[0]!.start);
  const spanEnd = Math.max(end, touched.at(-1)!.end);
  const local = view.markdown.slice(spanStart, at) + replacement + view.markdown.slice(end, spanEnd);
  const blocks = view.blocks.map((b) => b.json);
  blocks.splice(first, last - first + 1, ...markdownToBlocks(local));
  return { json: doc(blocks), merged: stale };
}

/**
 * Replace the whole page. Refuses a stale version (no safe merge for a full
 * rewrite). Blocks the agent left as they were keep their original structure,
 * so content markdown can't express is not flattened just by passing through.
 */
export function applyRewrite(current: JSONContent, version: string, markdown: string): JSONContent {
  const view = readView(current);
  if (version !== view.version) throw new ToolFailure(PAGE_CHANGED);
  // Key each original block by what its markdown parses back to; a new block
  // with the same key is one the agent passed through untouched.
  const key = (block: JSONContent) => {
    try { return JSON.stringify(getEditorSchema().nodeFromJSON(block).toJSON()); } catch { return null; }
  };
  const originals = new Map<string, ViewBlock[]>();
  for (const block of view.blocks) {
    const parsed = markdownToBlocks(block.markdown);
    const k = parsed.length === 1 ? key(parsed[0]!) : null;
    if (k) originals.set(k, [...(originals.get(k) ?? []), block]);
  }
  return doc(markdownToBlocks(markdown).map((block) => {
    const k = key(block);
    const same = k ? originals.get(k) : undefined;
    return same?.length ? same.shift()!.json : block;
  }));
}
