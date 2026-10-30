import type { Run, RunStep } from "@shared/types";

/**
 * Agents often narrate before they start ("Looking through the notebook for
 * material."). That's useful while they work and noise once the reply is
 * written, so the diary shows it as a passing status and leaves it out of the
 * finished reply.
 */
const LEAD = /^(?:let me|let's|i'll|i will|i'm going to|i am going to|first,? (?:i'll|let me)|one moment|give me a moment|on it)\b/i;
const INTERJECTION = /^(?:okay|ok|sure|alright|all right|right|got it|great)[,!.]?\s+/i;
/** -ing words that start real answers, not narration. */
const NOT_NARRATION = /^(?:nothing|something|everything|anything|during|morning|evening|according|including|regarding|bring|spring|string|king|thing|wing|ring)\b/i;

/** One short sentence of "what I'm about to do", with no links or formatting. */
export function isFiller(paragraph: string): boolean {
  const p = paragraph.trim();
  if (!p || p.includes("\n") || p.length > 140 || /[[\]`*#|>_]/.test(p)) return false;
  const body = p.replace(INTERJECTION, "");
  if (body.includes(",") || /[.!?…]\s+\S/.test(body)) return false;
  if (LEAD.test(body)) return true;
  const first = /^([A-Za-z]+)\b/.exec(body)?.[1]?.toLowerCase() ?? "";
  return first.length >= 6 && first.endsWith("ing") && !NOT_NARRATION.test(body);
}

/** Split a leading narration paragraph off. `rest` is everything after its blank line (maybe nothing yet). */
export function splitFiller(text: string): { filler: string | null; rest: string } {
  const lead = text.replace(/^\s+/, "");
  const gap = /\n[ \t]*\n/.exec(lead);
  const first = gap ? lead.slice(0, gap.index) : lead;
  if (!isFiller(first)) return { filler: null, rest: text };
  return { filler: first.trim(), rest: gap ? lead.slice(gap.index + gap[0].length).replace(/^\s+/, "") : "" };
}

/** A quoted report from another agent opens with its own narration: drop that too. */
export function stripQuotedFiller(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    if (!/^\s*>/.test(lines[i])) {
      out.push(lines[i++]);
      continue;
    }
    const block: string[] = [];
    while (i < lines.length && /^\s*>/.test(lines[i])) block.push(lines[i++].replace(/^\s*>\s?/, ""));
    const { filler, rest } = splitFiller(block.join("\n"));
    // A report can quote another agent's report in turn.
    const inner = stripQuotedFiller(filler && rest.trim() ? rest : block.join("\n"));
    out.push(...inner.split("\n").map((l) => (l ? `> ${l}` : ">")));
  }
  return out.join("\n");
}

const ACTIVE: Run["status"][] = ["queued", "running"];

/**
 * The reply as it should read now: leading narration becomes `status` while the
 * run works, and is dropped once there's a real reply after it, or when the
 * run failed or was stopped (the note under the reply says what happened).
 */
export function tidyReply(text: string, run: Run | null | undefined): { text: string; status: string | null } {
  if (!run) return { text, status: null };
  const active = ACTIVE.includes(run.status);
  const quoted = stripQuotedFiller(text);
  if (!active && !run.steps.length) return { text: quoted, status: null };
  const { filler, rest } = splitFiller(quoted);
  if (!filler) return { text: quoted, status: null };
  if (rest.trim()) return { text: rest, status: null };
  if (active) return { text: "", status: filler };
  if (run.status === "failed" || run.status === "cancelled") return { text: "", status: null };
  return { text: quoted, status: null };
}

/** What a run (and the agents it asked) had already changed in the notebook. */
export interface PageRef {
  pageId: string | null;
  title: string;
}
export interface Work {
  agentId: string;
  made: PageRef[];
  changed: PageRef[];
  deleted: PageRef[];
}

const KIND: Record<string, keyof Omit<Work, "agentId">> = {
  create_page: "made",
  append_to_page: "changed",
  edit_page: "changed",
  rewrite_page: "changed",
  rename_page: "changed",
  move_page: "changed",
  delete_page: "deleted",
};

/** "Created Packing list" → "Packing list". */
const titleOf = (s: RunStep) =>
  s.summary.replace(/^(?:Created|Added to|Edited|Wrote \d+ paragraphs? on|Renamed|Moved|Deleted)\s+/, "").trim() || "a page";

/** The run first, then the agents it handed work to (in the order they started). */
export function workDone(run: Run, others: Run[] = []): Work[] {
  const family: Run[] = [run];
  for (let i = 0; i < family.length; i++) {
    for (const r of others) if (r.parentRunId === family[i].id && !family.includes(r)) family.push(r);
  }
  const byAgent = new Map<string, Work>();
  for (const r of family) {
    const w = byAgent.get(r.agentId) ?? { agentId: r.agentId, made: [], changed: [], deleted: [] };
    byAgent.set(r.agentId, w);
    for (const s of r.steps) {
      const kind = KIND[s.tool];
      if (!kind || !s.ok) continue;
      const seen = (list: PageRef[]) => list.some((p) => (s.pageId ? p.pageId === s.pageId : p.title === titleOf(s)));
      if (seen(w.made) || seen(w.deleted)) continue;
      if (kind !== "changed") w.changed = w.changed.filter((p) => !(s.pageId && p.pageId === s.pageId));
      else if (seen(w.changed)) continue;
      w[kind].push({ pageId: kind === "deleted" ? null : s.pageId, title: titleOf(s) });
    }
  }
  return [...byAgent.values()].filter((w) => w.made.length + w.changed.length + w.deleted.length > 0);
}

/** Pieces of the stop note: text, and pages to link. */
export type NotePart = string | PageRef;

const listOf = (refs: PageRef[]): NotePart[] => {
  const shown = refs.length > 3 ? refs.slice(0, 2) : refs;
  const parts: NotePart[] = [];
  shown.forEach((r, i) => {
    if (i > 0) parts.push(i === shown.length - 1 && refs.length <= 3 ? " and " : ", ");
    parts.push(r);
  });
  if (refs.length > 3) parts.push(` and ${refs.length - 2} more pages`);
  return parts;
};

/** "Stopped. Wren had already made Packing list." */
export function stopNote(work: Work[], nameOf: (agentId: string) => string): NotePart[] {
  if (!work.length) return ["Stopped before any pages changed."];
  const parts: NotePart[] = ["Stopped."];
  for (const w of work) {
    const clauses: NotePart[][] = [];
    if (w.made.length) clauses.push(["made ", ...listOf(w.made)]);
    if (w.changed.length) clauses.push(["changed ", ...listOf(w.changed)]);
    if (w.deleted.length) clauses.push(["deleted ", ...listOf(w.deleted)]);
    parts.push(` ${nameOf(w.agentId)} had already `);
    clauses.forEach((c, i) => {
      if (i > 0) parts.push(i === clauses.length - 1 ? " and " : ", ");
      parts.push(...c);
    });
    parts.push(".");
  }
  return parts;
}

/** Plain text of a note (for tests and screen readers). */
export const noteText = (parts: NotePart[]) => parts.map((p) => (typeof p === "string" ? p : p.title)).join("");
