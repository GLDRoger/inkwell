/**
 * Record a demo cassette: play the scenario in a fresh notebook against whatever
 * META_BASE_URL points at (Meta, or the rehearsal fake), capturing every Meta HTTP
 * exchange in order. Used by scripts/demo/record.mjs and the tests.
 */
import type { DemoScenario } from "../../shared/types.ts";
import type { Services } from "../services.ts";
import { createWorkspaceSession, type SessionCtx } from "../session.ts";
import {
  bodyJson, decodeResponse, endpointOf, requestNote, requestVersions, scrub,
  type Cassette, type CassetteStep, type Exchange, type Stream, type Usage,
} from "./cassette.ts";
import { withFirstByteWatchdog } from "../agents/model.ts";
import { ensureDemoWorkspace } from "./notebook.ts";
import { playScenario, type Transport } from "./play.ts";
import { publicStep, type ScenarioDefinition } from "./scenario.ts";

export function recordingTransport(options: { fetch?: typeof globalThis.fetch; secrets: string[]; firstByteMs?: number }): Transport & { steps: CassetteStep[] } {
  // Meta sometimes stalls 30-90 s before its first byte; a silent call is asked again
  // (twice, waiting longer each time: a recording can afford patience, a live demo can't).
  // An abandoned attempt throws before it is captured, so the cassette only holds answers.
  const real = withFirstByteWatchdog(options.fetch ?? globalThis.fetch, { timeoutMs: options.firstByteMs ?? 60_000, retries: 2 });
  const steps: CassetteStep[] = [];
  let current: CassetteStep | undefined;
  const capture = (stream: Stream): typeof globalThis.fetch => async (url, init) => {
    const started = performance.now();
    const response = await real(url, init);
    const raw = await response.text();
    const path = endpointOf(url as string | URL | Request);
    const body = bodyJson(init) as { model?: string } | undefined;
    const exchange: Exchange = {
      path,
      ...(body?.model ? { model: body.model } : {}),
      note: requestNote(body) ?? (init?.body instanceof FormData ? "audio" : undefined),
      ...(requestVersions(body).length ? { versions: requestVersions(body) } : {}),
      status: response.status,
      ms: Math.round(performance.now() - started),
      response: decodeResponse(path, response.headers.get("content-type") ?? "", scrub(raw, options.secrets)),
    };
    stream.exchanges.push(exchange);
    const headers = new Headers(response.headers);
    // The body is already decoded text now.
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(raw, { status: response.status, statusText: response.statusText, headers });
  };
  return {
    steps,
    replaying: false,
    beginStep(_index, step) {
      current = { id: step.id, streams: [] };
      steps.push(current);
    },
    forRun() {
      const stream: Stream = { kind: "run", exchanges: [] };
      current!.streams.push(stream);
      return capture(stream);
    },
    media() {
      let stream = current!.streams.find((s) => s.kind === "media");
      if (!stream) current!.streams.push(stream = { kind: "media", exchanges: [] });
      return capture(stream);
    },
  };
}

export function totalUsage(steps: CassetteStep[]): Cassette["usage"] {
  const total: Usage & { exchanges: number } = { input: 0, output: 0, reasoning: 0, cached: 0, exchanges: 0 };
  for (const step of steps) for (const stream of step.streams) for (const exchange of stream.exchanges) {
    total.exchanges++;
    const usage = exchange.response.type === "chat-stream" || exchange.response.type === "json" ? exchange.response.usage : undefined;
    if (!usage) continue;
    total.input += usage.input;
    total.output += usage.output;
    total.reasoning! += usage.reasoning ?? 0;
    total.cached! += usage.cached ?? 0;
  }
  return total;
}

export interface RecordOptions {
  services: Services;
  scenario: ScenarioDefinition;
  apiKey: string;
  baseUrl: string;
  model: string;
  fetch?: typeof globalThis.fetch;
  /** Strings to scrub from recorded bodies. Default: the API key. */
  secrets?: string[];
  /** Called as each step starts, for progress output. */
  onStep?: (index: number, id: string) => void;
}

export async function recordScenario(o: RecordOptions): Promise<Cassette> {
  const { services: s } = o;
  const session = createWorkspaceSession(s);
  const demoWs = ensureDemoWorkspace(s, session);
  const ctx: SessionCtx = { ...session, workspaceId: demoWs, notebook: "demo", demoWorkspaceId: demoWs };
  const seed: Record<string, string> = {};
  for (const page of s.pages.listPages(demoWs)) seed[page.title] = page.id;
  const created: string[] = [];
  const unsubscribe = s.bus.subscribe(demoWs, (event) => { if (event.type === "page.created") created.push(event.page.id); });
  const transport = recordingTransport({ fetch: o.fetch, secrets: o.secrets ?? [o.apiKey] });
  const controller = new AbortController();
  const date = new Date();
  try {
    await playScenario({
      services: s, ctx, scenario: o.scenario, transport, apiKey: o.apiKey, baseUrl: o.baseUrl, model: o.model,
      signal: controller.signal, gapMs: 0, date,
      onStep: (index, focus) => { if (!focus.agentId && !focus.pageId) o.onStep?.(index, o.scenario.steps[index]!.id); },
    });
  } finally {
    unsubscribe();
  }
  const recordedFrom: DemoScenario["recordedFrom"] = new URL(o.baseUrl).hostname.endsWith("meta.ai") ? "meta" : "rehearsal";
  return {
    scenario: { id: o.scenario.id, title: o.scenario.title, steps: o.scenario.steps.map(publicStep), recordedFrom },
    recordedAt: date.toISOString(),
    model: o.model,
    seed,
    created,
    steps: transport.steps,
    usage: totalUsage(transport.steps),
  };
}
