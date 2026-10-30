/**
 * Demo playback per session (docs/DEMO-MODE.md): reset the session's demo notebook,
 * then replay a cassette through the real runtime, announcing each step on the
 * demo notebook's event stream.
 */
import fs from "node:fs";
import path from "node:path";
import type { DemoScenario, DemoState } from "../../shared/types.ts";
import type { Services } from "../services.ts";
import type { SessionCtx } from "../session.ts";
import {
  bodyJson, IdTranslator, inlineImages, pacedDelay, replayResponse, requestVersions, sleep,
  type Cassette, type Exchange, type ReplayPace, type Stream,
} from "./cassette.ts";
import { ensureDemoWorkspace, resetDemoWorkspace } from "./notebook.ts";
import { playScenario, resolveDemoDir, type Transport } from "./play.ts";
import { LISBON_TOUR, publicStep, SCENARIOS, type ScenarioDefinition } from "./scenario.ts";

export const CASSETTES_DIR = resolveDemoDir("cassettes");

export class DemoUnavailable extends Error {}

/** Load a cassette and check it still covers every step of its scenario. */
export function loadCassette(id: string, dir = CASSETTES_DIR): { cassette: Cassette; def: ScenarioDefinition } {
  const def = SCENARIOS[id];
  if (!def) throw new DemoUnavailable(`No demo called ${id}.`);
  let cassette: Cassette;
  try {
    cassette = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8")) as Cassette;
    inlineImages(cassette, (name) => fs.readFileSync(path.join(dir, name)));
  } catch { throw new DemoUnavailable("The demo recording is missing."); }
  for (const step of def.steps) {
    if (!cassette.steps.some((s) => s.id === step.id)) throw new DemoUnavailable(`The demo recording has no step ${step.id}; record it again.`);
  }
  return { cassette, def };
}

/**
 * Serve a cassette's exchanges in order: per step, one stream per run (by start order) plus media.
 * `stop` ends every replay delay at once, including media calls (photo, cover, voice) that
 * carry no abort signal of their own.
 */
export function replayTransport(cassette: Cassette, translator: IdTranslator, pace: ReplayPace, stop?: AbortSignal): Transport {
  let runs: Stream[] = [];
  let media: Stream | undefined;
  let nextRun = 0;
  let mediaAt = 0;
  let stepStarted = Date.now();
  const serve = (next: () => Exchange | undefined): typeof globalThis.fetch => async (_url, init) => {
    const exchange = next();
    if (!exchange) {
      // The replay drifted from the recording; fail this call like an upstream error would.
      return Response.json({ error: { message: "The recording has no further reply here." } }, { status: 500 });
    }
    const recorded = exchange.versions ?? [];
    const actual = requestVersions(bodyJson(init));
    const versions = new Map<string, string>();
    recorded.forEach((v, i) => { if (actual[i]) versions.set(v, actual[i]!); });
    const signals = [init?.signal, stop].filter((x): x is AbortSignal => Boolean(x));
    const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
    await sleep(pacedDelay(exchange, pace, { elapsed: Date.now() - stepStarted }), signal);
    return replayResponse(exchange, (text) => translator.translate(text, versions), pace, signal);
  };
  return {
    replaying: true,
    beginStep(_index, step) {
      const recorded = cassette.steps.find((s) => s.id === step.id);
      runs = recorded?.streams.filter((s) => s.kind === "run") ?? [];
      media = recorded?.streams.find((s) => s.kind === "media");
      nextRun = 0;
      mediaAt = 0;
      stepStarted = Date.now();
    },
    forRun() {
      const stream = runs[nextRun++];
      let at = 0;
      return serve(() => stream?.exchanges[at++]);
    },
    media() {
      const stream = media;
      return serve(() => stream?.exchanges[mediaAt++]);
    },
  };
}

interface Playback {
  scenario: DemoScenario;
  index: number;
  playing: boolean;
  controller: AbortController;
  done: Promise<void>;
}

export interface DemoPlayerOptions {
  cassettesDir?: string;
  /** Multiplies replay delays and the pause between steps; 0 for tests. Env INKWELL_DEMO_PACE. */
  pace?: number;
}

export class DemoPlayer {
  private plays = new Map<string, Playback>();
  private queues = new Map<string, Promise<unknown>>();
  private closing = false;
  constructor(private services: Services, private options: DemoPlayerOptions = {}) {}

  private get pace() {
    const env = Number(process.env.INKWELL_DEMO_PACE);
    return this.options.pace ?? (Number.isFinite(env) && env >= 0 ? env : 1);
  }

  state(demoWorkspaceId: string | null | undefined): DemoState {
    const play = demoWorkspaceId ? this.plays.get(demoWorkspaceId) : undefined;
    return play ? { playing: play.playing, scenario: play.scenario, stepIndex: play.index } : { playing: false, scenario: null, stepIndex: -1 };
  }

  /** One start/stop at a time per demo notebook. */
  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
    this.queues.set(key, next);
    return next.finally(() => { if (this.queues.get(key) === next) this.queues.delete(key); });
  }

  /** Reset the session's demo notebook and play the scenario from the top. */
  start(ctx: SessionCtx, scenarioId = LISBON_TOUR.id): Promise<DemoState> {
    if (this.closing) return Promise.reject(new DemoUnavailable("Inkwell is restarting."));
    const { cassette, def } = loadCassette(scenarioId, this.options.cassettesDir);
    const s = this.services;
    const demoWs = ensureDemoWorkspace(s, ctx);
    return this.serial(demoWs, async () => {
      await this.halt(demoWs, false);
      const demoCtx: SessionCtx = { ...ctx, workspaceId: demoWs, notebook: "demo", demoWorkspaceId: demoWs };
      await resetDemoWorkspace(s, demoCtx, demoWs);
      const translator = new IdTranslator(cassette);
      translator.mapSeed(s.pages.listPages(demoWs));
      let createdCount = 0;
      const unsubscribe = s.bus.subscribe(demoWs, (event) => {
        if (event.type === "page.created") translator.mapCreated(createdCount++, event.page.id);
      });
      const scenario: DemoScenario = { id: def.id, title: def.title, steps: def.steps.map(publicStep), recordedFrom: cassette.scenario.recordedFrom };
      const controller = new AbortController();
      const play: Playback = { scenario, index: 0, playing: true, controller, done: Promise.resolve() };
      const pace = this.pace;
      play.done = playScenario({
        services: s, ctx: demoCtx, scenario: def, signal: controller.signal,
        transport: replayTransport(cassette, translator, { scale: pace }, controller.signal),
        // Replay never calls Meta, so it needs no key; the model is the recording's.
        apiKey: "recorded-demo", baseUrl: "https://api.meta.ai/v1", model: cassette.model,
        date: new Date(cassette.recordedAt),
        gapMs: 3500 * pace,
        holdScale: pace,
        onStep: (index, focus) => {
          if (index < 0 || !play.playing) return;
          play.index = index;
          s.bus.publish(demoWs, { type: "demo.step", index, step: scenario.steps[index]!, focus });
        },
      }).then(() => "finished" as const, (error) => {
        if (!controller.signal.aborted) console.error("[inkwell] demo playback failed", error instanceof Error ? error.message : "unknown error");
        return controller.signal.aborted ? "stopped" as const : "finished" as const;
      }).then((reason) => {
        unsubscribe();
        if (!play.playing) return;
        play.playing = false;
        s.bus.publish(demoWs, { type: "demo.ended", reason });
      });
      this.plays.set(demoWs, play);
      // Step 0 is announced synchronously by playScenario's first setFocus.
      return this.state(demoWs);
    });
  }

  /** Stop playback; runs are cancelled and the notebook is kept as it is. */
  stop(demoWorkspaceId: string | null | undefined): Promise<void> {
    if (!demoWorkspaceId) return Promise.resolve();
    return this.serial(demoWorkspaceId, () => this.halt(demoWorkspaceId, true));
  }

  private async halt(demoWs: string, announce: boolean) {
    const play = this.plays.get(demoWs);
    if (!play) return;
    if (play.playing) {
      // A restart doesn't announce an end: the next step 0 follows straight away.
      if (!announce) play.playing = false;
      play.controller.abort(new Error("Demo stopped."));
    }
    // The playback's own ending publishes demo.ended "stopped" while it still counts as playing.
    await play.done;
  }

  async close() {
    this.closing = true;
    await Promise.all([...this.plays.keys()].map((id) => this.halt(id, false)));
  }
}
