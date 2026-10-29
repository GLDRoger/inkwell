import { HTTPException } from "hono/http-exception";

export interface MetaOptions {
  fetch?: typeof globalThis.fetch;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function mediaError(message: string, status: 400 | 404 | 413 | 415 | 422 | 502 | 503 | 504 = 502): never {
  throw new HTTPException(status, { message });
}

/** Bound provider responses as well as uploads; the fetch signal covers body reads. */
export async function readBytes(response: Response, limit = 32 * 1024 * 1024): Promise<Buffer> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    mediaError("Meta response exceeds the size limit");
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > limit) {
          await reader.cancel();
          mediaError("Meta response exceeds the size limit");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  return Buffer.concat(chunks);
}

export function createMetaClient(options: MetaOptions = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const apiKey = options.apiKey ?? process.env.META_API_KEY ?? "";
  const baseUrl = (options.baseUrl ?? process.env.META_BASE_URL ?? "https://api.meta.ai/v1").replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 120_000;
  const requireKey = () => {
    if (!apiKey.trim()) mediaError("Meta API key isn't configured", 503);
  };
  const redact = (message: string) => apiKey ? message.split(apiKey).join("[redacted]") : message;
  async function request(url: string, init: RequestInit): Promise<Response> {
    try {
      const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
      if (!response.ok) {
        const raw = (await readBytes(response, 64 * 1024)).toString("utf8");
        let message = raw;
        try {
          const body = record(JSON.parse(raw));
          message = String(record(body.error).message ?? body.message ?? body.error ?? response.statusText);
        } catch { /* Some gateways return plain text rather than JSON. */ }
        mediaError(`Meta API ${response.status}: ${redact(message).slice(0, 500)}`);
      }
      return response;
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
        mediaError("Meta request timed out", 504);
      }
      // Fetch exceptions can contain URLs or request headers; do not expose them.
      mediaError("Could not reach Meta API");
    }
  }
  return {
    requireKey,
    async post(endpoint: string, body: object | FormData, stream = false): Promise<unknown> {
      requireKey();
      const multipart = body instanceof FormData;
      const response = await request(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: stream ? "text/event-stream" : "application/json",
          ...(multipart ? {} : { "Content-Type": "application/json" }),
        },
        body: multipart ? body : JSON.stringify(body),
      });
      let raw: string;
      try { raw = (await readBytes(response)).toString("utf8"); }
      catch (error) {
        if (error instanceof HTTPException) throw error;
        mediaError("Meta response was interrupted", 504);
      }
      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        let output = "";
        let completed: unknown;
        for (const event of raw.split(/\r?\n\r?\n/)) {
          const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart()).join("\n");
          if (!data || data === "[DONE]") continue;
          let parsed: Record<string, unknown>;
          try { parsed = record(JSON.parse(data)); } catch { mediaError("Invalid Meta stream response"); }
          if (parsed.type === "error" || parsed.type === "response.failed") mediaError("Meta segmentation failed");
          if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") output += parsed.delta;
          if (parsed.type === "response.completed") completed = parsed.response;
        }
        return output ? { output_text: output } : completed ?? { output_text: "" };
      }
      try { return JSON.parse(raw) as unknown; }
      catch { mediaError("Meta returned invalid JSON"); }
    },
    async downloadImage(urlString: string): Promise<Buffer> {
      let url: URL;
      try { url = new URL(urlString); } catch { mediaError("Meta returned an invalid image URL"); }
      // Signed image URLs need no API credential. Never forward credentials; reject redirects and obvious local hosts.
      if (url.protocol !== "https:" || url.username || url.password ||
          /(^localhost$|\.localhost$|\.local$|^\[|^\d+\.\d+\.\d+\.\d+$)/i.test(url.hostname)) {
        mediaError("Meta returned an unsafe image URL");
      }
      return readBytes(await request(url.href, { method: "GET" }), 20 * 1024 * 1024);
    },
  };
}

export type MetaClient = ReturnType<typeof createMetaClient>;
