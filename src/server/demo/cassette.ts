/**
 * Cassettes: every Meta HTTP exchange of one demo recording, in order, so the demo
 * can replay real model output through the real agent runtime without a key.
 *
 * Exchanges are grouped per step into streams: one per agent run (in the order the
 * runs started) and one for media calls. Chat streams are stored decoded (text,
 * tool calls, finish reason, usage) and re-encoded as OpenAI-style SSE on replay.
 *
 * Replay translates what the recording notebook called things into the demo
 * notebook's names: seed pages by title, pages created during the scenario by
 * creation order, and page version tokens by their position in the request's
 * tool results. No request headers are ever stored.
 */
import type { DemoScenario } from "../../shared/types.ts";

export interface ChatToolCall { id: string; name: string; arguments: string }
export interface Usage { input: number; output: number; reasoning?: number; cached?: number }

export type RecordedResponse =
  | { type: "chat-stream"; text: string; toolCalls: ChatToolCall[]; finishReason: string | null; usage?: Usage }
  | { type: "responses-stream"; text: string }
  | { type: "json"; body: unknown; usage?: Usage };

export interface Exchange {
  path: string;
  model?: string;
  /** Short, human-readable hint of what was asked (for reviewing a cassette). */
  note?: string;
  /** Version tokens in the request's tool results, in order. */
  versions?: string[];
  status: number;
  /** Time the real call took, used to pace replay. */
  ms: number;
  response: RecordedResponse;
}

export interface Stream { kind: "run" | "media"; exchanges: Exchange[] }
export interface CassetteStep { id: string; streams: Stream[] }

export interface Cassette {
  scenario: DemoScenario;
  recordedAt: string;
  /** The text model the recording used. */
  model: string;
  /** Seed page ids in the recording notebook, by title. */
  seed: Record<string, string>;
  /** Pages created during the recording, in creation order. */
  created: string[];
  steps: CassetteStep[];
  usage: Usage & { exchanges: number };
}

/* ------------------------------------------------------------------ wire helpers */

const VERSION = /version"?\s*:\s*"?([A-Za-z0-9_-]{12})(?![A-Za-z0-9_-])/g;
const ID = /[A-Za-z0-9_-]{21}/g;

/** Version tokens the request hands back to the model, in order. */
export function requestVersions(body: unknown): string[] {
  const messages = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(messages)) return [];
  const out: string[] = [];
  for (const message of messages as { role?: string; content?: unknown }[]) {
    if (message?.role !== "tool") continue;
    const text = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "");
    for (const match of text.matchAll(VERSION)) out.push(match[1]!);
  }
  return out;
}

/** A short note on a request for people reading a cassette. */
export function requestNote(body: unknown): string | undefined {
  const messages = (body as { messages?: unknown })?.messages;
  if (Array.isArray(messages)) {
    const last = messages.at(-1) as { role?: string; content?: unknown } | undefined;
    const text = typeof last?.content === "string" ? last.content
      : Array.isArray(last?.content) ? last.content.map((p: { text?: string }) => p?.text ?? "").join(" ") : "";
    return `${last?.role ?? "?"}: ${text.replace(/\s+/g, " ").slice(0, 160)}`;
  }
  const input = (body as { input?: unknown })?.input;
  if (Array.isArray(input)) return "segmentation";
  return undefined;
}

function chatUsage(raw: unknown): Usage | undefined {
  const usage = raw as { prompt_tokens?: number; completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number }; prompt_tokens_details?: { cached_tokens?: number } } | undefined;
  if (!usage || typeof usage.prompt_tokens !== "number") return undefined;
  return {
    input: usage.prompt_tokens, output: usage.completion_tokens ?? 0,
    ...(usage.completion_tokens_details?.reasoning_tokens ? { reasoning: usage.completion_tokens_details.reasoning_tokens } : {}),
    ...(usage.prompt_tokens_details?.cached_tokens ? { cached: usage.prompt_tokens_details.cached_tokens } : {}),
  };
}

function sseData(raw: string): unknown[] {
  const out: unknown[] = [];
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") continue;
    try { out.push(JSON.parse(data)); } catch { /* not JSON: skip */ }
  }
  return out;
}

/** Decode a recorded HTTP response into its stored form. */
export function decodeResponse(path: string, contentType: string, raw: string): RecordedResponse {
  if (contentType.includes("text/event-stream")) {
    const events = sseData(raw) as Record<string, any>[];
    if (path.endsWith("/responses")) {
      let text = events.filter((e) => e.type === "response.output_text.delta").map((e) => String(e.delta ?? "")).join("");
      if (!text) text = String(events.find((e) => e.type === "response.output_text.done")?.text ?? "");
      return { type: "responses-stream", text };
    }
    let text = "";
    const calls: ChatToolCall[] = [];
    let finishReason: string | null = null;
    let usage: Usage | undefined;
    for (const event of events) {
      if (event.usage) usage = chatUsage(event.usage) ?? usage;
      const choice = event.choices?.[0];
      if (!choice) continue;
      if (typeof choice.delta?.content === "string") text += choice.delta.content;
      for (const call of choice.delta?.tool_calls ?? []) {
        const index = typeof call.index === "number" ? call.index : calls.length;
        const slot = calls[index] ??= { id: "", name: "", arguments: "" };
        if (call.id) slot.id = call.id;
        if (call.function?.name) slot.name += call.function.name;
        if (call.function?.arguments) slot.arguments += call.function.arguments;
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
    return { type: "chat-stream", text, toolCalls: calls.filter(Boolean), finishReason, ...(usage ? { usage } : {}) };
  }
  let body: unknown = raw;
  try { body = JSON.parse(raw); } catch { /* keep text */ }
  const usage = chatUsage((body as { usage?: unknown })?.usage);
  return { type: "json", body, ...(usage ? { usage } : {}) };
}

/* ------------------------------------------------------------------ binary payloads */

type ImageItem = { b64_json?: string; b64_file?: string };
const imageItems = (cassette: Cassette): ImageItem[] => cassette.steps.flatMap((step) => step.streams.flatMap((stream) =>
  stream.exchanges.flatMap((exchange) => {
    const body = exchange.response.type === "json" ? exchange.response.body as { data?: unknown } : undefined;
    return Array.isArray(body?.data) ? body.data as ImageItem[] : [];
  })));

/**
 * Generated images are stored beside the cassette as files (<id>.<n>.png) rather
 * than as base64 inside it: smaller, and the JSON stays readable.
 */
export function externalizeImages(cassette: Cassette, write: (name: string, bytes: Buffer) => void): void {
  imageItems(cassette).forEach((item, n) => {
    if (typeof item.b64_json !== "string") return;
    const name = `${cassette.scenario.id}.${n}.png`;
    write(name, Buffer.from(item.b64_json, "base64"));
    delete item.b64_json;
    item.b64_file = name;
  });
}

export function inlineImages(cassette: Cassette, read: (name: string) => Buffer): void {
  for (const item of imageItems(cassette)) {
    if (typeof item.b64_file !== "string") continue;
    // Names come from our own cassette; never let one climb out of its folder.
    if (!/^[\w.-]+\.png$/.test(item.b64_file)) throw new Error("bad cassette image name");
    item.b64_json = read(item.b64_file).toString("base64");
    delete item.b64_file;
  }
}

/* ------------------------------------------------------------------ scrubbing */

const KEYLIKE = [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, /\b(?:sk|LLM)[-|_][A-Za-z0-9|_-]{16,}/g];

/** Remove a key (and anything key-shaped) from recorded text. */
export function scrub(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) if (secret && secret.length >= 6) out = out.split(secret).join("[redacted]");
  for (const pattern of KEYLIKE) out = out.replace(pattern, "[redacted]");
  return out;
}

/* ------------------------------------------------------------------ replay */

export class IdTranslator {
  private ids = new Map<string, string>();
  constructor(private cassette: Cassette) {}
  /** Seed pages: the demo notebook has the same titles. */
  mapSeed(demoPages: { id: string; title: string }[]) {
    for (const page of demoPages) {
      const recorded = this.cassette.seed[page.title];
      if (recorded) this.ids.set(recorded, page.id);
    }
  }
  /** The nth page created during replay is the nth page created during recording. */
  mapCreated(index: number, demoId: string) {
    const recorded = this.cassette.created[index];
    if (recorded) this.ids.set(recorded, demoId);
  }
  translate(text: string, versions: Map<string, string> = new Map()): string {
    let out = text.replace(ID, (id) => this.ids.get(id) ?? id);
    for (const [from, to] of versions) if (from !== to) out = out.split(from).join(to);
    return out;
  }
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (ms <= 0) return resolve();
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason ?? new Error("aborted")); }, { once: true });
});

export interface ReplayPace {
  /** Multiplies every replay delay; 0 replays instantly (tests). */
  scale: number;
}

/** How long a replayed exchange waits before answering: a fraction of the real time, bounded. */
export function replayDelay(exchange: Exchange, pace: ReplayPace): number {
  const bounds: Record<string, [number, number, number]> = {
    "/chat/completions": [0.8, 1200, 3500],
    "/responses": [0.5, 900, 2500],
    "/images/generations": [0.25, 1500, 3500],
    "/asr/transcribe": [0.5, 600, 1500],
  };
  const [fraction, min, max] = bounds[exchange.path] ?? [0.3, 400, 1500];
  return Math.round(Math.max(min, Math.min(max, exchange.ms * fraction)) * pace.scale);
}

/** Re-encode a recorded exchange as the HTTP response the client code expects. */
export function replayResponse(exchange: Exchange, translate: (text: string) => string, pace: ReplayPace, signal?: AbortSignal): Response {
  const r = exchange.response;
  if (r.type === "json") {
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(exchange.path === "/chat/completions" ? translate(text) : text,
      { status: exchange.status, headers: { "Content-Type": "application/json" } });
  }
  const encoder = new TextEncoder();
  const sse = (value: unknown) => encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
  if (r.type === "responses-stream") {
    const body = [
      sse({ type: "response.output_text.delta", delta: r.text }),
      sse({ type: "response.completed", response: { status: "completed" } }),
      encoder.encode("data: [DONE]\n\n"),
    ];
    return new Response(new Blob(body), { status: exchange.status, headers: { "Content-Type": "text/event-stream" } });
  }
  const id = `replay-${Math.random().toString(36).slice(2)}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta: object, finish: string | null = null, extra: object = {}) =>
    sse({ id, object: "chat.completion.chunk", created, model: "recorded", choices: [{ index: 0, delta, finish_reason: finish }], ...extra });
  const text = translate(r.text);
  // Text arrives a few words at a time, as it would live.
  const pieces = text.match(/\S+\s*|\s+/g) ?? [];
  const words: string[] = [];
  for (let i = 0; i < pieces.length; i += 3) words.push(pieces.slice(i, i + 3).join(""));
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(chunk({ role: "assistant", content: "" }));
        for (const word of words) {
          await sleep(60 * pace.scale, signal);
          controller.enqueue(chunk({ content: word }));
        }
        r.toolCalls.forEach((call, index) => controller.enqueue(chunk({ tool_calls: [{
          index, id: call.id || `call_${index}`, type: "function",
          function: { name: call.name, arguments: translate(call.arguments) },
        }] })));
        const usage = r.usage ? { usage: { prompt_tokens: r.usage.input, completion_tokens: r.usage.output, total_tokens: r.usage.input + r.usage.output } } : {};
        controller.enqueue(chunk({}, r.finishReason ?? (r.toolCalls.length ? "tool_calls" : "stop"), usage));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, { status: exchange.status, headers: { "Content-Type": "text/event-stream" } });
}

/** A body we can inspect, whatever form the client passed it in. */
export function bodyJson(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") return undefined;
  try { return JSON.parse(init.body); } catch { return undefined; }
}

export function endpointOf(url: string | URL | Request): string {
  const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
  const path = new URL(href).pathname;
  return path.replace(/^.*?\/v1(?=\/)/, "");
}

export { sleep };
