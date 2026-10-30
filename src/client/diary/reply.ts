import type { Run } from "@shared/types";
import { runErrorCopy } from "./errors";

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
  const body = rest === "Run stopped." ? "" : rest;
  if (run.status === "cancelled") return { text: body, note: "Stopped." };
  return { text: body, note: runErrorCopy(why) };
}
