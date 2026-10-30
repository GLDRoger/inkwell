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

export const FIRST_BYTE_TIMEOUT_MS = 30_000;
export const NO_FIRST_BYTE = "Muse didn't start answering in time. Try again in a moment.";

/**
 * A model step that hasn't sent a single byte after `timeoutMs` is abandoned and
 * asked again, once; a second silence fails the step with NO_FIRST_BYTE (a plain
 * error, so the SDK doesn't retry it again). A stalled upstream then costs a live
 * demo about a minute, not the whole run's time budget. The caller's abort signal
 * still ends the request and its body at any point.
 */
export function withFirstByteWatchdog(inner: typeof globalThis.fetch,
  { timeoutMs = FIRST_BYTE_TIMEOUT_MS, retries = 1 } = {}): typeof globalThis.fetch {
  return async (url, init) => {
    const outer = init?.signal ?? undefined;
    for (let attempt = 0; ; attempt++) {
      outer?.throwIfAborted();
      const controller = new AbortController();
      const forward = () => controller.abort(outer!.reason);
      outer?.addEventListener("abort", forward, { once: true });
      const release = () => outer?.removeEventListener("abort", forward);
      let silent = false;
      const timer = setTimeout(() => { silent = true; controller.abort(new Error(NO_FIRST_BYTE)); }, timeoutMs);
      try {
        const response = await inner(url, { ...init, signal: controller.signal });
        if (!response.body) { clearTimeout(timer); release(); return response; }
        const reader = response.body.getReader();
        const first = await reader.read();
        clearTimeout(timer);
        if (first.done) { release(); return new Response(null, response); }
        const body = new ReadableStream<Uint8Array>({
          start(c) { c.enqueue(first.value); },
          async pull(c) {
            try {
              const next = await reader.read();
              if (next.done) { release(); c.close(); } else c.enqueue(next.value);
            } catch (error) { release(); c.error(error); }
          },
          cancel(reason) { release(); return reader.cancel(reason); },
        });
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      } catch (error) {
        clearTimeout(timer);
        release();
        if (!silent || outer?.aborted) throw error;
        if (attempt >= retries) throw new Error(NO_FIRST_BYTE);
      }
    }
  };
}
