/**
 * Which Meta key and text model a request may use (docs/DEMO-MODE.md, "The visitor's key").
 *
 * A visitor's key arrives per request in X-Meta-Key. It lives only in memory, in the
 * objects of the request and of any run it starts; it is never written to the
 * database, logged, put in an error message or in an event. The server's own
 * META_API_KEY is the fallback.
 */
import type { Context } from "hono";
import { TEXT_MODELS, type TextModelId } from "../shared/types.ts";

export const DEFAULT_TEXT_MODEL: TextModelId = TEXT_MODELS[0].id;
export const NOT_CONNECTED = {
  error: "Inkwell isn't connected to Meta's models yet. Add your Meta API key to use the agents.",
  code: "meta_not_connected",
} as const;

export interface MetaAccess {
  apiKey: string;
  /** The text/vision model for agents and photo import. */
  model: string;
  /** Whose key: the visitor's own, or the server's. */
  source: "visitor" | "server";
  /** Overrides META_BASE_URL (demo recording). Never set from a request. */
  baseUrl?: string;
  /** Overrides the HTTP transport (demo replay and recording). Never set from a request. */
  fetchForRun?: (runId: string) => typeof globalThis.fetch;
  /** Runs made with this access are replays of a recording. */
  recorded?: boolean;
}

/** The server's own key, if it has one. */
export function serverMetaKey(): string | null {
  return process.env.META_API_KEY?.trim() || null;
}

/** The default text model: env override for rehearsals and tests, else Muse Wonder. */
export function defaultTextModel(): string {
  return process.env.META_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL;
}

/** Allow-list the visitor's choice; anything else gets the default. */
export function pickTextModel(requested: string | null | undefined): string {
  const id = requested?.trim();
  return TEXT_MODELS.some((m) => m.id === id) ? id! : defaultTextModel();
}

/**
 * A plausible key from a header: printable ASCII, no spaces, bounded length.
 * Anything else is treated as absent rather than echoed back in an error.
 */
export function visitorKey(header: string | null | undefined): string | null {
  const key = header?.trim();
  if (!key || key.length > 512 || !/^[\x21-\x7e]+$/.test(key)) return null;
  return key;
}

export function resolveMetaAccess(c: Context): MetaAccess | null {
  const visitor = visitorKey(c.req.header("x-meta-key"));
  const apiKey = visitor ?? serverMetaKey();
  if (!apiKey) return null;
  return { apiKey, model: pickTextModel(c.req.header("x-meta-model")), source: visitor ? "visitor" : "server" };
}
