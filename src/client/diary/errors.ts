import { ApiError } from "../lib/api";
import { COPY } from "./copy";
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
export function sendErrorCopy(e: unknown): DiaryError {
  const status = e instanceof ApiError ? e.status : -1;
  const code = e instanceof ApiError ? e.code : undefined;
  const message = e instanceof Error ? e.message.trim() : "";
  const back = "Your words are still here.";
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

/** A failed run's reason, as shown under the reply. */
export function runErrorCopy(error: string | null | undefined): string {
  const why = (error ?? "").trim();
  if (!why) return "Stopped with an error. Try again.";
  if (MISSING_KEY.test(why)) return COPY.notConnected;
  if (MODEL_FAILED.test(why)) return "Muse Spark couldn't finish this one. Try again in a moment.";
  if (/^Interrupted by a server restart/i.test(why)) return "Inkwell restarted while this was being written. Ask again to pick it up.";
  return isPlain(why) ? why : "Stopped with an error. Try again.";
}

/** Stopping a run failed. */
export function cancelErrorCopy(e: unknown): string {
  const status = e instanceof ApiError ? e.status : -1;
  if (status === 0) return "Couldn't reach Inkwell to stop the agent. Check your connection.";
  if (status === 404) return "That run has already finished.";
  return "Couldn't stop the agent. Try again.";
}
