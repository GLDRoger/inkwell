import { ApiError } from "../lib/api";
import { COPY, modelName } from "./copy";
import type { DiaryError } from "./state";

/** The server's missing-key reason for a failed run (src/server/agents/model.ts). */
const MISSING_KEY = /META_API_KEY|API key isn't configured/i;
/** The server's catch-all for a provider failure (src/server/agents/runtime.ts). */
const MODEL_FAILED = /^The Meta model couldn't complete this request/i;

/** A server message that already reads as a sentence for people (not "page not found" or a stack). */
const isPlain = (m: string) => /^[A-Z][^\n]{3,200}[.!?]$/.test(m.trim()) && !/\b(error|exception|undefined|null)\b:/i.test(m);

/**
 * Why sending to the diary failed, in plain words. Nothing was saved on the
 * server, so the words go back in the composer and every message says so.
 */
function sendErrorCopyRaw(e: unknown, { kept = true }: { kept?: boolean } = {}): DiaryError {
  const status = e instanceof ApiError ? e.status : -1;
  const code = e instanceof ApiError ? e.code : undefined;
  const message = e instanceof Error ? e.message.trim() : "";
  // A retry from a failed reply has nothing in the composer to keep.
  const back = kept ? "Your words are still here." : "";
  if (status === 0) return { kind: "offline", message: `Couldn't reach Inkwell. Check your connection and try again. ${back}` };
  switch (code) {
    case "thread_not_found":
      return { kind: "failed", message: `That conversation was deleted, so this will start a new one. ${back}`, reset: "thread" };
    case "agent_not_found":
      return { kind: "failed", message: `That agent has left this notebook. Pick another and send again. ${back}`, reset: "agent" };
    case "page_not_found":
      return { kind: "failed", message: `The page you had open was deleted. Send again to ask without it. ${back}`, reset: "page" };
    case "attachment_not_found":
      return { kind: "failed", message: `A picture didn't upload. Attach it again. ${back}` };
    case "restarting":
      return { kind: "unavailable", message: `Inkwell is restarting. Try again in a moment. ${back}` };
  }
  if (status === 503) return { kind: "unavailable", message: `The agents are busy right now. Try again in a moment. ${back}` };
  if (status === 413) return { kind: "failed", message: `That's too long to send in one go. Shorten it and try again. ${back}` };
  if (status === 429) return { kind: "failed", message: `That's a lot of requests at once. Wait a moment and try again. ${back}` };
  // Any other 404 (an old server, a missing route): never blame the server's setup.
  if (status === 404) return { kind: "failed", message: `Couldn't reach the agents just now. Try again in a moment. ${back}` };
  if (code === "agent_unavailable" && message && isPlain(message)) return { kind: "failed", message: `${message} ${back}` };
  if (status >= 400 && status < 500 && message && isPlain(message)) return { kind: "failed", message: `${message} ${back}` };
  return { kind: "failed", message: `Something went wrong sending that. Try again. ${back}` };
}

export function sendErrorCopy(e: unknown, opts: { kept?: boolean } = {}): DiaryError {
  const error = sendErrorCopyRaw(e, opts);
  return { ...error, message: error.message.trim() };
}

/** The runtime's "ran out of time / budget / steps" endings, which ask the person to continue. */
const CONTINUE = /\s*Ask it to continue(?: from the changes already made)?\.?$/i;

/** A failed run's reason, as shown under the reply (the button beside it says what to do next). */
export function runErrorCopy(error: string | null | undefined, model?: string | null): string {
  const why = (error ?? "").trim();
  if (!why) return "Something went wrong before this was finished.";
  if (MISSING_KEY.test(why)) return COPY.notConnected;
  if (MODEL_FAILED.test(why)) return `${modelName(model)} couldn't finish this one.`;
  if (/^Interrupted by a server restart/i.test(why)) return "Inkwell restarted while this was being written.";
  if (CONTINUE.test(why)) return why.replace(CONTINUE, "").trim() || "The agent stopped partway.";
  return isPlain(why) ? why : "Something went wrong before this was finished.";
}

/** What a failed reply offers: send the same request again, ask the agent to carry on, or nothing (retrying can't help). */
export function runRecovery(error: string | null | undefined): "retry" | "continue" | null {
  const why = (error ?? "").trim();
  if (MISSING_KEY.test(why)) return null;
  if (CONTINUE.test(why)) return "continue";
  return "retry";
}

/** Stopping a run failed. */
export function cancelErrorCopy(e: unknown): string {
  const status = e instanceof ApiError ? e.status : -1;
  if (status === 0) return "Couldn't reach Inkwell to stop the agent. Check your connection.";
  if (status === 404) return "That run has already finished.";
  return "Couldn't stop the agent. Try again.";
}
