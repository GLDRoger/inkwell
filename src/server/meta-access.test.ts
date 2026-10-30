// @vitest-environment node
/**
 * Visitor keys (docs/DEMO-MODE.md, "The visitor's key"): X-Meta-Key is used for the
 * request and the runs it starts, and never reaches the database, logs, errors or events.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Me, Run, ServerEvent } from "../shared/types.ts";
import { createApp } from "./main.ts";
import { pickTextModel, visitorKey } from "./meta-access.ts";
import { createServices, type Services } from "./services.ts";

const VISITOR_KEY = "LLM_visitor_TESTKEY_0123456789abcdefghijklmnop";
const SERVER_KEY = "LLM_server_TESTKEY_9876543210zyxwvutsrqponmlkj";

let services: Services;
let dir: string;
let app: ReturnType<typeof createApp>;
let cookie: string;
let workspaceId: string;
let events: ServerEvent[];
let logged: string[];
let seen: { url: string; auth: string | null; body: Record<string, any> }[];

/** OpenAI-style SSE for one reply or one tool call. */
function sse(delta: Record<string, unknown>, finish: string) {
  const chunk = (d: object, f: string | null) => `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: d, finish_reason: f }] })}\n\n`;
  return new Response(chunk({ role: "assistant", ...delta }, null) + chunk({}, finish) + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
}

/** A stand-in Meta: the first agent asks Wren for help; Wren and the follow-up just answer. */
function fakeMeta(behaviour: "work" | "reject" = "work") {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    seen.push({ url, auth: headers.get("authorization"), body });
    if (behaviour === "reject") {
      // A provider error that echoes the key back must not leak it anywhere.
      return Response.json({ error: { message: `Invalid key ${headers.get("authorization")}` } }, { status: 401 });
    }
    const system = String(body.messages?.find((m: { role: string }) => m.role === "system")?.content ?? "");
    const toolResults = body.messages?.some((m: { role: string }) => m.role === "tool");
    if (!system.includes("asked you for help") && !toolResults) {
      return sse({ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "ask_agent", arguments: JSON.stringify({ agentName: "Wren", request: "Say hi" }) } }] }, "tool_calls");
    }
    return sse({ content: "Done." }, "stop");
  });
}

const scoutId = () => (services.db.prepare("SELECT id FROM agents WHERE workspace_id = ? AND name = 'Scout'").get(workspaceId) as { id: string }).id;

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(url, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}

async function waitForRuns(count: number) {
  for (let i = 0; i < 120; i++) {
    const runs = services.db.prepare("SELECT status FROM runs WHERE workspace_id = ? AND status IN ('succeeded', 'failed', 'cancelled') AND prompt NOT LIKE '%demo%'").all(workspaceId);
    if (runs.length >= count) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`runs didn't finish: ${JSON.stringify(services.db.prepare("SELECT status, error, prompt FROM runs WHERE workspace_id = ?").all(workspaceId))} ${seen.length}`);
}

/** Everything the server persisted, as text. */
function databaseText(): string {
  const tables = services.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  return tables.map(({ name }) => JSON.stringify(services.db.prepare(`SELECT * FROM "${name}"`).all())).join("\n");
}

beforeEach(async () => {
  vi.stubEnv("META_API_KEY", "");
  vi.stubEnv("META_BASE_URL", "https://meta.test/v1");
  vi.stubEnv("META_TEXT_MODEL", "");
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "inkwell-keys-"));
  services = createServices(dir);
  app = createApp(services);
  const me = await app.request("/api/me");
  cookie = me.headers.get("set-cookie")!.split(";")[0]!;
  workspaceId = (await me.json() as Me).workspaceId;
  events = [];
  services.bus.subscribe(workspaceId, (e) => events.push(e));
  seen = [];
  logged = [];
  for (const level of ["log", "error", "warn", "info", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logged.push(args.map((a) => a instanceof Error ? `${a.message} ${a.stack}` : typeof a === "string" ? a : JSON.stringify(a)).join(" ")); });
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  await services.close();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("visitor keys", () => {
  it("uses X-Meta-Key for the run and its child runs, and stores it nowhere", async () => {
    fakeMeta();
    const res = await post("/api/diary", { text: "Ask Wren to say hi", agentId: scoutId() }, { "X-Meta-Key": VISITOR_KEY, "X-Meta-Model": "muse-spark-1.3-contributor" });
    expect(res.status).toBe(201);
    const { runId } = await res.json() as { runId: string };
    await waitForRuns(2);
    // Parent and child both called Meta with the visitor's key and chosen model.
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const call of seen) {
      expect(call.url).toBe("https://meta.test/v1/chat/completions");
      expect(call.auth).toBe(`Bearer ${VISITOR_KEY}`);
      expect(call.body.model).toBe("muse-spark-1.3-contributor");
    }
    const run = await (await app.request(`/api/runs/${runId}`, { headers: { Cookie: cookie } })).json() as Run;
    expect(run).toMatchObject({ status: "succeeded", model: "muse-spark-1.3-contributor" });
    expect(databaseText()).not.toContain(VISITOR_KEY);
    expect(JSON.stringify(events)).not.toContain(VISITOR_KEY);
    expect(logged.join("\n")).not.toContain(VISITOR_KEY);
  });

  it("keeps a key that Meta echoes back in an error out of the run, diary, events and logs", async () => {
    fakeMeta("reject");
    const res = await post("/api/diary", { text: "Hello" }, { "X-Meta-Key": VISITOR_KEY });
    expect(res.status).toBe(201);
    await waitForRuns(1);
    const failed = services.db.prepare("SELECT error FROM runs WHERE workspace_id = ? AND status = 'failed'").get(workspaceId) as { error: string };
    expect(failed.error).toMatch(/couldn't complete/);
    expect(databaseText()).not.toContain(VISITOR_KEY);
    expect(JSON.stringify(events)).not.toContain(VISITOR_KEY);
    expect(logged.join("\n")).not.toContain(VISITOR_KEY);
  });

  it("falls back to the server key, and the visitor's key wins when both are present", async () => {
    vi.stubEnv("META_API_KEY", SERVER_KEY);
    fakeMeta();
    expect((await post("/api/diary", { text: "Ask Wren to say hi", agentId: scoutId() })).status).toBe(201);
    await waitForRuns(2);
    expect(seen.every((c) => c.auth === `Bearer ${SERVER_KEY}` && c.body.model === "muse-wonder-1.0")).toBe(true);
    seen = [];
    expect((await post("/api/diary", { text: "Ask Wren to say hi", agentId: scoutId() }, { "X-Meta-Key": VISITOR_KEY })).status).toBe(201);
    await waitForRuns(4);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((c) => c.auth === `Bearer ${VISITOR_KEY}`)).toBe(true);
  });

  it("uses the visitor's key for media too", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      seen.push({ url: "", auth: new Headers(init?.headers).get("authorization"), body: {} });
      return Response.json({ error: { message: `bad ${new Headers(init?.headers).get("authorization")}` } }, { status: 429 });
    });
    const page = services.pages.listPages(workspaceId)[0]!;
    const res = await post(`/api/pages/${page.id}/illustrate`, {}, { "X-Meta-Key": VISITOR_KEY });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(seen[0]!.auth).toBe(`Bearer ${VISITOR_KEY}`);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain(VISITOR_KEY);
  });

  it("answers 503 meta_not_connected when there is no key at all, and saves nothing", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const page = services.pages.listPages(workspaceId)[0]!;
    const threads = services.db.prepare("SELECT COUNT(*) AS n FROM diary_threads").get() as { n: number };
    for (const res of [
      await post("/api/diary", { text: "Hello" }),
      await post(`/api/pages/${page.id}/illustrate`, {}),
      await post("/api/import/photo", { attachmentId: "missing" }),
      await app.request("/api/transcribe", { method: "POST", headers: { Cookie: cookie } }),
    ]) {
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: "meta_not_connected" });
    }
    expect(services.db.prepare("SELECT COUNT(*) AS n FROM diary_threads").get()).toEqual(threads);
    expect(spy).not.toHaveBeenCalled();
    // A blank or malformed header counts as no key.
    expect((await post("/api/diary", { text: "Hello" }, { "X-Meta-Key": "  " })).status).toBe(503);
  });

  it("reports whether the server itself is connected", async () => {
    const me = async () => await (await app.request("/api/me", { headers: { Cookie: cookie } })).json() as Me;
    expect(await me()).toMatchObject({ workspaceId, metaConnected: false, demoWorkspaceId: null });
    vi.stubEnv("META_API_KEY", SERVER_KEY);
    expect((await me()).metaConnected).toBe(true);
    expect(JSON.stringify(await me())).not.toContain(SERVER_KEY);
  });
});

describe("POST /api/key/check", () => {
  it("checks the key with one authenticated call and never echoes it", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) =>
      new Headers(init?.headers).get("authorization") === `Bearer ${VISITOR_KEY}` ? Response.json({ data: [] })
        : Response.json({ error: { message: `bad key ${new Headers(init?.headers).get("authorization")}` } }, { status: 401 }));
    const check = (key?: string) => app.request("/api/key/check", { method: "POST", headers: { Cookie: cookie, ...(key ? { "X-Meta-Key": key } : {}) } });
    expect(await (await check(VISITOR_KEY)).json()).toEqual({ ok: true });
    expect(String(spy.mock.calls[0]![0])).toBe("https://meta.test/v1/models");
    const bad = await (await check("LLM_wrong_key_000000000000000000")).text();
    expect(JSON.parse(bad)).toMatchObject({ ok: false });
    expect(bad).not.toContain("LLM_wrong_key");
    expect(await (await check()).json()).toMatchObject({ ok: false });
    spy.mockRejectedValueOnce(new Error(`network down for ${VISITOR_KEY}`));
    const offline = await (await check(VISITOR_KEY)).text();
    expect(offline).not.toContain(VISITOR_KEY);
    expect(databaseText()).not.toContain(VISITOR_KEY);
    expect(logged.join("\n")).not.toContain(VISITOR_KEY);
  });
});

describe("helpers", () => {
  it("allow-lists the text model", () => {
    expect(pickTextModel("muse-spark-1.3-contributor")).toBe("muse-spark-1.3-contributor");
    expect(pickTextModel("muse-wonder-1.0")).toBe("muse-wonder-1.0");
    for (const other of ["gpt-5", "muse-spark-1.3", "", undefined, "muse-wonder-1.0-contributor"]) expect(pickTextModel(other)).toBe("muse-wonder-1.0");
  });
  it("only accepts plausible keys", () => {
    expect(visitorKey(` ${VISITOR_KEY} `)).toBe(VISITOR_KEY);
    for (const bad of [undefined, "", "   ", "has space", "x".repeat(600), "naïve"]) expect(visitorKey(bad)).toBeNull();
  });
});
