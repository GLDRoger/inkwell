// @vitest-environment node
/**
 * Demo mode (docs/DEMO-MODE.md): recording against the rehearsal fake, replay in the
 * session's demo notebook, read-only and isolation rules, and the shipped cassette.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import * as Y from "yjs";
import type { DemoState, Me, Page, Run, ServerEvent } from "../../shared/types.ts";
import { yDocToMarkdown } from "../editor-schema.ts";
import { createApp, startServer } from "../main.ts";
import { createServices, type Services } from "../services.ts";
// @ts-expect-error plain .mjs rehearsal helper, no types
import { startFakeMeta } from "../../../scripts/rehearsal/fake-meta.mjs";
import type { Cassette } from "./cassette.ts";
import { IdTranslator } from "./cassette.ts";
import { CASSETTES_DIR, loadCassette, replayTransport } from "./player.ts";
import { recordScenario, recordingTransport } from "./record.ts";
import { LISBON_TOUR } from "./scenario.ts";

const tmp = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `inkwell-demo-${name}-`));
const dirs: string[] = [];
let fake: { url: string; close: () => Promise<void> };
let cassettesDir: string;
let cassette: Cassette;
/** Titles of the pages the recording created, in order. */
let recordedTitles: string[];

beforeAll(async () => {
  fake = await startFakeMeta({ port: 0, fast: true, quiet: true });
  const dir = tmp("record");
  dirs.push(dir);
  const recorder = createServices(dir);
  try {
    cassette = await recordScenario({ services: recorder, scenario: LISBON_TOUR, apiKey: "rehearsal", baseUrl: fake.url,
      model: "muse-wonder-1.0", secrets: [] });
    recordedTitles = cassette.created.map((id) => recorder.db.prepare("SELECT title FROM pages WHERE id = ?").get(id) as { title: string })
      .map((row) => row.title);
  } finally {
    await recorder.close();
  }
  cassettesDir = tmp("cassettes");
  dirs.push(cassettesDir);
  fs.writeFileSync(path.join(cassettesDir, `${LISBON_TOUR.id}.json`), JSON.stringify(cassette));
}, 60_000);

afterAll(async () => {
  await fake?.close();
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe("recording", () => {
  it("captures every step, in order, with runs and media split into streams", () => {
    expect(cassette.scenario.recordedFrom).toBe("rehearsal");
    expect(cassette.steps.map((s) => s.id)).toEqual(LISBON_TOUR.steps.map((s) => s.id));
    const kinds = (id: string) => cassette.steps.find((s) => s.id === id)!.streams.map((s) => s.kind);
    expect(kinds("plan")).toEqual(["run"]);
    expect(kinds("voice")[0]).toBe("media");
    expect(kinds("voice")).toContain("run");
    expect(kinds("photo")).toEqual(["media"]);
    expect(cassette.steps.find((s) => s.id === "photo")!.streams[0]!.exchanges.map((e) => e.path)).toEqual(["/responses", "/chat/completions"]);
    expect(Object.keys(cassette.seed)).toContain("Hiring plan");
    expect(cassette.created.length).toBeGreaterThan(5);
    expect(cassette.usage.exchanges).toBeGreaterThan(10);
  });
});

/** An app on a real port, with replay at full speed. */
async function startApp(options: { pace?: number } = {}) {
  const dir = tmp("app");
  dirs.push(dir);
  const services = createServices(dir, {}, { cassettesDir, pace: options.pace ?? 0 });
  const app = createApp(services, { heartbeatMs: 100 });
  const started = await startServer(services, app, 0);
  const base = `http://127.0.0.1:${started.port}`;
  return {
    services, base,
    async close() { await started.close(); await services.close(); },
    async client() {
      const res = await fetch(`${base}/api/me`);
      const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
      const me = await res.json() as Me;
      const call = (url: string, init: RequestInit & { demo?: boolean } = {}) => fetch(`${base}${url}`, {
        ...init, headers: { Cookie: cookie, ...(init.demo ? { "X-Inkwell-Notebook": "demo" } : {}), ...(init.headers ?? {}) },
      });
      return { cookie, me, call };
    },
  };
}

function waitForEvent(services: Services, ws: string, match: (e: ServerEvent) => boolean, timeoutMs = 30_000): Promise<ServerEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error("timed out waiting for event")); }, timeoutMs);
    const off = services.bus.subscribe(ws, (e) => { if (match(e)) { clearTimeout(timer); off(); resolve(e); } });
  });
}

describe("replay in the demo notebook", () => {
  it("replays the recording through the real runtime without calling Meta", async () => {
    const harness = await startApp();
    try {
      const { call, me } = await harness.client();
      expect(me.demoWorkspaceId).toBeNull();
      const ownBefore = harness.services.pages.listPages(me.workspaceId).map((p) => p.id);
      // Open the demo notebook first, as the client does, so its stream is subscribed before start.
      const map = await (await call("/api/map", { demo: true })).json() as { pages: Page[] };
      const demoWs = (await (await call("/api/me")).json() as Me).demoWorkspaceId!;
      expect(demoWs).toBeTruthy();
      expect(demoWs).not.toBe(me.workspaceId);
      expect(map.pages.map((p) => p.title).sort()).toEqual(harness.services.pages.listPages(me.workspaceId).map((p) => p.title).sort());

      const events: ServerEvent[] = [];
      const ownEvents: ServerEvent[] = [];
      harness.services.bus.subscribe(demoWs, (e) => events.push(e));
      harness.services.bus.subscribe(me.workspaceId, (e) => ownEvents.push(e));
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const ended = waitForEvent(harness.services, demoWs, (e) => e.type === "demo.ended");
      const started = await call("/api/demo/start", { method: "POST", demo: true });
      expect(started.status).toBe(200);
      const state = await started.json() as DemoState;
      expect(state).toMatchObject({ playing: true, stepIndex: 0, scenario: { id: "lisbon-tour", recordedFrom: "rehearsal" } });
      expect(await ended).toEqual({ type: "demo.ended", reason: "finished" });
      // Replay served the cassette; nothing went to the network.
      expect(fetchSpy.mock.calls.filter(([url]) => !String(url).startsWith(harness.base))).toEqual([]);
      fetchSpy.mockRestore();

      const steps = events.filter((e): e is Extract<ServerEvent, { type: "demo.step" }> => e.type === "demo.step");
      expect([...new Set(steps.map((e) => e.index))]).toEqual([0, 1, 2, 3, 4, 5]);
      expect(steps.some((e) => e.focus.pageId && e.focus.runId)).toBe(true);
      expect(steps.find((e) => e.index === 0)!.step).toEqual({ id: "plan", caption: LISBON_TOUR.steps[0]!.caption, model: "muse-wonder" });

      // The same pages were made, in the same order, as in the recording.
      const created = events.filter((e): e is Extract<ServerEvent, { type: "page.created" }> => e.type === "page.created")
        .map((e) => e.page).filter((p) => harness.services.pages.getPage(demoWs, p.id));
      const seedCount = Object.keys(cassette.seed).length;
      expect(created.slice(seedCount).map((p) => p.title)).toEqual(recordedTitles);
      // Every replayed run succeeded, is marked recorded, and names its model.
      const runs = harness.services.db.prepare("SELECT id FROM runs WHERE workspace_id = ? AND recorded = 1").all(demoWs) as { id: string }[];
      expect(runs.length).toBe(cassette.steps.flatMap((s) => s.streams).filter((s) => s.kind === "run").length);
      const replayed = (await (await call("/api/map", { demo: true })).json() as { runs: Run[] }).runs.filter((r) => r.recorded);
      for (const run of replayed) expect(run).toMatchObject({ status: "succeeded", recorded: true, model: "muse-wonder-1.0" });
      expect(events.some((e) => e.type === "agent.moved" && e.action === "writing")).toBe(true);
      // The cover landed on the new Lisbon plan, and its file is served to this session.
      const covered = harness.services.pages.listPages(demoWs).find((p) => p.coverUrl);
      expect(covered?.title).toMatch(/lisbon/i);
      const cover = await call(covered!.coverUrl!);
      expect(cover.status).toBe(200);
      expect(cover.headers.get("content-type")).toBe("image/png");

      // The visitor's own notebook didn't change and heard nothing.
      expect(harness.services.pages.listPages(me.workspaceId).map((p) => p.id)).toEqual(ownBefore);
      expect(ownEvents.filter((e) => e.type !== "presence")).toEqual([]);
      expect(await (await call("/api/demo")).json()).toMatchObject({ playing: false, stepIndex: 5 });

      // Restarting resets the notebook to a fresh seed and plays again from the top.
      const again = waitForEvent(harness.services, demoWs, (e) => e.type === "demo.ended");
      expect((await call("/api/demo/start", { method: "POST", demo: true })).status).toBe(200);
      await again;
      expect(harness.services.pages.listPages(demoWs)).toHaveLength(seedCount + recordedTitles.length);
    } finally {
      await harness.close();
    }
  }, 60_000);

  it("stops on request, keeps the notebook, and says so", async () => {
    const harness = await startApp({ pace: 1 });
    try {
      const { call } = await harness.client();
      await call("/api/map", { demo: true });
      const demoWs = (await (await call("/api/me")).json() as Me).demoWorkspaceId!;
      const ended = waitForEvent(harness.services, demoWs, (e) => e.type === "demo.ended");
      await call("/api/demo/start", { method: "POST" });
      await waitForEvent(harness.services, demoWs, (e) => e.type === "agent.moved");
      expect((await call("/api/demo/stop", { method: "POST", demo: true })).status).toBe(204);
      expect(await ended).toEqual({ type: "demo.ended", reason: "stopped" });
      expect(await (await call("/api/demo")).json()).toMatchObject({ playing: false, stepIndex: 0 });
      const runs = harness.services.db.prepare("SELECT status FROM runs WHERE workspace_id = ? AND recorded = 1").all(demoWs) as { status: string }[];
      expect(runs.map((r) => r.status)).toEqual(["cancelled"]);
    } finally {
      await harness.close();
    }
  }, 30_000);
});

describe("recording transport", () => {
  it("asks a silent Meta call again and keeps only the answer", async () => {
    let calls = 0;
    const transport = recordingTransport({ secrets: [], firstByteMs: 20, fetch: (_url, init) => {
      if (++calls === 1) return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
      return Promise.resolve(Response.json({ ok: true }));
    } });
    transport.beginStep(0, LISBON_TOUR.steps[0]!);
    const fetch = transport.forRun("run");
    expect(await (await fetch("https://api.meta.ai/v1/chat/completions", { method: "POST", body: "{}" })).json()).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(transport.steps[0]!.streams[0]!.exchanges).toHaveLength(1);
  });
});

describe("replay transport", () => {
  it("answers no further media call once the demo has stopped", async () => {
    const recorded: Cassette = { ...cassette, steps: [{ id: "photo", streams: [{ kind: "media", exchanges: [
      { path: "/chat/completions", status: 200, ms: 20_000, response: { type: "json", body: {} } },
    ] }] }] };
    const stop = new AbortController();
    stop.abort(new Error("Demo stopped."));
    const transport = replayTransport(recorded, new IdTranslator(recorded), { scale: 1 }, stop.signal);
    transport.beginStep(0, LISBON_TOUR.steps.find((s) => s.id === "photo")!);
    const started = Date.now();
    await expect(transport.media()("https://api.meta.ai/v1/chat/completions", { method: "POST", body: "{}" })).rejects.toThrow("Demo stopped.");
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("ends a media call's replay delay as soon as the demo stops", async () => {
    const recorded: Cassette = { ...cassette, steps: [{ id: "cover", streams: [{ kind: "media", exchanges: [
      { path: "/images/generations", status: 200, ms: 20_000, response: { type: "json", body: { data: [] } } },
    ] }] }] };
    const stop = new AbortController();
    const transport = replayTransport(recorded, new IdTranslator(recorded), { scale: 1 }, stop.signal);
    transport.beginStep(0, LISBON_TOUR.steps.find((s) => s.id === "cover")!);
    const started = Date.now();
    // Media clients pass no abort signal of their own.
    const pending = transport.media()("https://api.meta.ai/v1/images/generations", { method: "POST", body: "{}" });
    setTimeout(() => stop.abort(new Error("Demo stopped.")), 30);
    await expect(pending).rejects.toThrow("Demo stopped.");
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("demo notebook isolation", () => {
  let harness: Awaited<ReturnType<typeof startApp>>;
  beforeAll(async () => { harness = await startApp(); });
  afterAll(async () => { await harness.close(); });

  it("is read-only for people over HTTP", async () => {
    const { call } = await harness.client();
    const page = ((await (await call("/api/pages", { demo: true })).json()) as Page[])[0]!;
    const json = { "Content-Type": "application/json" };
    const writes: [string, RequestInit][] = [
      ["/api/pages", { method: "POST", headers: json, body: "{}" }],
      [`/api/pages/${page.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ title: "Mine now" }) }],
      [`/api/pages/${page.id}`, { method: "DELETE" }],
      ["/api/diary", { method: "POST", headers: json, body: JSON.stringify({ text: "Hello" }) }],
      ["/api/agents", { method: "POST", headers: json, body: JSON.stringify({ name: "Mole" }) }],
      [`/api/pages/${page.id}/illustrate`, { method: "POST" }],
      ["/api/import/photo", { method: "POST", headers: json, body: "{}" }],
      ["/api/transcribe", { method: "POST" }],
      ["/api/uploads", { method: "POST" }],
      ["/api/runs/x/cancel", { method: "POST" }],
    ];
    for (const [url, init] of writes) {
      const res = await call(url, { ...init, demo: true });
      expect(res.status, url).toBe(403);
      expect(await res.json()).toMatchObject({ code: "demo_read_only" });
    }
    // ?notebook=demo selects it too.
    expect((await call(`/api/pages/${page.id}?notebook=demo`, { method: "DELETE" })).status).toBe(403);
    expect(harness.services.pages.getPage((await (await call("/api/me")).json() as Me).demoWorkspaceId!, page.id)?.title).toBe(page.title);
  });

  it("never mixes up notebooks or sessions", async () => {
    const a = await harness.client();
    const b = await harness.client();
    const ownA = (await (await a.call("/api/pages")).json()) as Page[];
    const demoA = (await (await a.call("/api/pages", { demo: true })).json()) as Page[];
    const demoB = (await (await b.call("/api/pages?notebook=demo")).json()) as Page[];
    const ids = (pages: Page[]) => new Set(pages.map((p) => p.id));
    for (const [x, y] of [[ownA, demoA], [demoA, demoB], [ownA, demoB]] as const) {
      expect([...ids(x)].filter((id) => ids(y).has(id))).toEqual([]);
    }
    // A demo page is invisible from the own notebook, and from another session's either notebook.
    const demoPage = demoA[0]!;
    expect((await a.call(`/api/pages/${demoPage.id}`)).status).toBe(404);
    expect((await b.call(`/api/pages/${demoPage.id}`)).status).toBe(404);
    expect((await b.call(`/api/pages/${demoPage.id}`, { demo: true })).status).toBe(404);
    expect((await a.call(`/api/pages/${demoPage.id}`, { demo: true })).status).toBe(200);
    // Own writes don't reach the demo notebook.
    const created = await (await a.call("/api/pages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Zanzibarquux" }) })).json() as Page;
    expect((await a.call(`/api/pages/${created.id}`, { demo: true })).status).toBe(404);
    // Search stays inside the selected notebook.
    const found = await (await a.call("/api/search?q=Zanzibarquux", { demo: true })).json() as unknown[];
    expect(found).toEqual([]);
    // /api/me always names the own notebook, and both sessions have distinct demo notebooks.
    const meA = await (await a.call("/api/me", { demo: true })).json() as Me;
    const meB = await (await b.call("/api/me")).json() as Me;
    expect(meA.workspaceId).toBe(a.me.workspaceId);
    expect(meA.demoWorkspaceId).not.toBe(meB.demoWorkspaceId);
    // Starting or stopping a demo only ever touches the caller's demo notebook.
    expect((await b.call("/api/demo/stop", { method: "POST" })).status).toBe(204);
    expect(await (await b.call("/api/demo")).json()).toEqual({ playing: false, scenario: null, stepIndex: -1 });
  });

  it("keeps event streams apart", async () => {
    const a = await harness.client();
    const demoWs = (await (await a.call("/api/me", { demo: true })).json() as Me).demoWorkspaceId!;
    const read = async (url: string) => {
      const controller = new AbortController();
      const res = await a.call(url, { signal: controller.signal });
      const reader = res.body!.getReader();
      let text = "";
      const done = (async () => {
        try { for (;;) { const { value, done } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); } }
        catch { /* aborted */ }
      })();
      return { stop: async () => { controller.abort(); await done; return text; } };
    };
    const own = await read("/api/events");
    const demo = await read("/api/events?notebook=demo");
    await new Promise((r) => setTimeout(r, 100));
    harness.services.bus.publish(demoWs, { type: "page.deleted", pageId: "demo-marker" });
    harness.services.bus.publish(a.me.workspaceId, { type: "page.deleted", pageId: "own-marker" });
    await new Promise((r) => setTimeout(r, 150));
    const ownText = await own.stop();
    const demoText = await demo.stop();
    expect(demoText).toContain("demo-marker");
    expect(demoText).not.toContain("own-marker");
    expect(ownText).toContain("own-marker");
    expect(ownText).not.toContain("demo-marker");
  });

  it("opens demo pages read-only over collab, and only for their session", async () => {
    const a = await harness.client();
    const b = await harness.client();
    const page = ((await (await a.call("/api/pages", { demo: true })).json()) as Page[])[0]!;
    const demoWs = (await (await a.call("/api/me")).json() as Me).demoWorkspaceId!;
    const socket = (cookie: string) => class extends WebSocket {
      constructor(address: string, protocols?: string | string[]) { super(address, protocols, { headers: { Cookie: cookie } }); }
    };
    const open = (cookie: string, query: string) => {
      const doc = new Y.Doc();
      const provider = new HocuspocusProvider({
        url: `${harness.base.replace("http", "ws")}/collab${query}`, name: page.id, document: doc,
        // @ts-expect-error ws polyfill typing differs from lib.dom WebSocket
        WebSocketPolyfill: socket(cookie),
      });
      return { doc, provider };
    };
    const outcome = (provider: HocuspocusProvider) => new Promise<"synced" | "denied">((resolve) => {
      provider.on("synced", () => resolve("synced"));
      provider.on("authenticationFailed", () => resolve("denied"));
    });
    // Without ?notebook=demo the page isn't in the own notebook; another session can't open it at all.
    const own = open(a.cookie, "");
    const other = open(b.cookie, "?notebook=demo");
    const watch = open(a.cookie, "?notebook=demo");
    try {
      expect(await outcome(own.provider)).toBe("denied");
      expect(await outcome(other.provider)).toBe("denied");
      expect(await outcome(watch.provider)).toBe("synced");
      await new Promise((r) => setTimeout(r, 100));
      const before = harness.services.pages.getPageWithBody(demoWs, page.id)!.markdown;
      expect(yDocToMarkdown(watch.doc).length).toBeGreaterThan(0);
      // A person's edit is ignored by the server.
      watch.doc.transact(() => {
        const fragment = watch.doc.getXmlFragment("default");
        const paragraph = new Y.XmlElement("paragraph");
        paragraph.insert(0, [new Y.XmlText("vandalised by a watcher")]);
        fragment.insert(0, [paragraph]);
      });
      await new Promise((r) => setTimeout(r, 1500));
      expect(await harness.services.collab.readPageMarkdown(page.id, demoWs)).not.toContain("vandalised");
      expect(harness.services.pages.getPageWithBody(demoWs, page.id)!.markdown).toBe(before);
    } finally {
      for (const c of [own, other, watch]) { c.provider.destroy(); c.doc.destroy(); }
    }
  }, 20_000);
});

describe("the shipped cassette", () => {
  const file = path.join(CASSETTES_DIR, `${LISBON_TOUR.id}.json`);
  it.runIf(fs.existsSync(file))("covers the scenario and holds no key material", () => {
    const text = fs.readFileSync(file, "utf8");
    const { cassette: shipped } = loadCassette(LISBON_TOUR.id);
    expect(shipped.steps.map((s) => s.id)).toEqual(LISBON_TOUR.steps.map((s) => s.id));
    expect(text).not.toMatch(/Bearer\s/i);
    expect(text).not.toMatch(/authorization/i);
    expect(text).not.toMatch(/x-meta-key/i);
    expect(text).not.toMatch(/\bLLM[-_|][A-Za-z0-9_|-]{16,}/);
    expect(text).not.toMatch(/\bsk-[A-Za-z0-9_-]{16,}/);
    const key = process.env.META_API_KEY?.trim();
    if (key && key !== "rehearsal") expect(text.includes(key)).toBe(false);
  });
});
