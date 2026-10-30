import type { Run } from "@shared/types";
import { runErrorCopy } from "./errors";
import { maskIncomplete } from "./ink";

/** Ends like a finished thought: sentence punctuation (maybe inside quotes, brackets or bold), a table row or a code fence. */
const ENDED = /(?:[.!?…:;][)\]"”'’*_`]*|\||```)$/;

/**
 * A reply cut off by a stop or a failure: hide markdown that never closed and,
 * when it stops mid-sentence, let it trail off with "…" so it reads as cut, not finished.
 */
export function trailOff(text: string): string {
  const body = maskIncomplete(text).trimEnd();
  if (!body) return "";
  const last = body.slice(body.lastIndexOf("\n") + 1).trim();
  // A heading or a rule is a whole line on its own.
  if (ENDED.test(body) || /^(?:#{1,6}\s|[-*_]{3,}$)/.test(last)) return body;
  return body.replace(/[\s,–—-]+$/, "") + "…";
}

/**
 * When a run fails or is stopped, the server appends why to the reply's text.
 * The diary shows that as a quiet note under the ink rather than in the
 * agent's hand, so split it back off.
 */
export function splitFailure(text: string, run: Run | null | undefined): { text: string; note: string | null } {
  if (!run || (run.status !== "failed" && run.status !== "cancelled")) return { text, note: null };
  const why = run.error?.trim() ?? "";
  const trimmed = text.trimEnd();
  const rest = why && trimmed.endsWith(why) ? trimmed.slice(0, trimmed.length - why.length).trimEnd() : text;
  // The server's stand-in when nothing was written before the stop.
  const body = rest === "Run stopped." ? "" : trailOff(rest);
  if (run.status === "cancelled") return { text: body, note: "Stopped." };
  return { text: body, note: runErrorCopy(why, run.model) };
}
