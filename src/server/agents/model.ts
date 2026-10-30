import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defaultTextModel } from "../meta-access.ts";

export const MISSING_META_KEY = "The Meta API key isn't configured. Set META_API_KEY to let the agents work.";

/** The installed provider emits max_tokens; Meta only accepts max_completion_tokens. */
export function metaRequestBody(body: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...body, tool_choice: "auto" };
  if (body.max_tokens !== undefined) next.max_completion_tokens = body.max_tokens;
  delete next.max_tokens;
  delete next.stop;
  delete next.n;
  delete next.logprobs;
  delete next.top_logprobs;
  return next;
}

export function createMetaModel(options: {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  fetch?: typeof globalThis.fetch;
} = {}) {
  const apiKey = options.apiKey ?? process.env.META_API_KEY;
  if (!apiKey?.trim()) throw new Error(MISSING_META_KEY);
  return createOpenAICompatible({
    name: "meta",
    baseURL: options.baseURL ?? process.env.META_BASE_URL ?? "https://api.meta.ai/v1",
    apiKey,
    fetch: options.fetch,
    transformRequestBody: metaRequestBody,
  }).chatModel(options.model ?? defaultTextModel());
}
