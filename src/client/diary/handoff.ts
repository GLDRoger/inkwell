import type { Id, Run } from "@shared/types";

/**
 * Handoffs in the diary: when an agent asks another for help (ask_agent), the
 * other agent's run carries `parentRunId`. Its live steps show inline under
 * the reply that asked, so the wait reads as someone working, not a spinner.
 */

/** The runs this run handed work to, in the order they started. */
export function childRuns(runs: Run[] | undefined, parentId: Id): Run[] {
  return (runs ?? [])
    .filter((r) => r.parentRunId === parentId && r.id !== parentId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

const ACTIVE: Run["status"][] = ["queued", "running"];

/** "Waiting for Wren…" while a helper works; null once every helper is done. */
export function waitingFor(kids: Run[], nameOf: (agentId: Id) => string | undefined): string | null {
  const names = [...new Set(kids.filter((k) => ACTIVE.includes(k.status)).map((k) => nameOf(k.agentId) ?? "another agent"))];
  if (!names.length) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Waiting for ${list}…`;
}

/** What the asking agent wrote to its helper, as one short line: the first sentence, trimmed. */
export function askedFor(prompt: string, max = 140): string {
  const flat = prompt
    // Agents hand over pages as markdown links and ids; people read the titles.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s*\((?:page )?ids?\b:?[^)]*\)/gi, "")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+([.,;:!?])/g, "$1");
  if (!flat) return "";
  const sentence = /^(.+?[.!?])(\s|$)/.exec(flat)?.[1] ?? flat;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.6)).trimEnd()}…`;
}

/** The helper's state under its name: "is working on it…", "finished", "stopped", "couldn't finish". */
export function helperState(run: Run): string {
  switch (run.status) {
    case "queued":
      return "is getting ready…";
    case "running":
      return "is working on it…";
    case "succeeded":
      return "finished";
    case "cancelled":
      return "stopped";
    case "failed":
      return "couldn't finish";
  }
}
