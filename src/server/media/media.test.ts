// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment, Page, ServerEvent } from "../../shared/types.ts";
import { getAttachmentRow } from "../db.ts";
import { createUploadRoutes } from "../routes/uploads.ts";
import { createServices, type Services } from "../services.ts";
import { createSessionMiddleware, type AppEnv, type SessionCtx } from "../session.ts";
import { createMediaRoutes } from "./index.ts";
import { createMetaClient, type MetaOptions } from "./meta.ts";
import { parseSamBoxes } from "./boxes.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1cAAAAASUVORK5CYII=", "base64");
const json = (body: unknown, status = 200) => Response.json(body, { status });
const vision = (notes: unknown) => json({ choices: [{ message: { content: JSON.stringify(notes) }, finish_reason: "stop" }] });
const NOTE_A = { title: "Plan", markdown: "Launch the notebook.", box: [0.1, 0.2, 0.3, 0.4] };
const NOTE_B = { title: "Build", markdown: "Ship the map.", box: [0.6, 0.5, 0.9, 0.8] };
function wav(rate = 16_000, seconds = 0.01) {
  const length = Math.round(rate * 2 * seconds);
  const bytes = Buffer.alloc(44 + length);
  bytes.write("RIFF"); bytes.writeUInt32LE(36 + length, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(length, 40);
  return bytes;
}
function audioForm(bytes = wav(), mime = "audio/wav") {
  const form = new FormData();
  form.set("audio", new Blob([new Uint8Array(bytes)], { type: mime }), mime === "audio/webm" ? "audio.webm" : "audio.wav");
  return form;
}

let services: Services;
let dir: string;
let app: Hono<AppEnv>;
let ctx: SessionCtx;
let cookie: string;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
function makeApp(options: MetaOptions = {}) {
  const app = new Hono<AppEnv>();
  app.use("/api/*", createSessionMiddleware(services));
  app.get("/api/me", (c) => c.json(c.get("ctx")));
  app.route("/", createUploadRoutes(services));
  app.route("/", createMediaRoutes(services, { fetch: fetcher, apiKey: "test-secret", ...options }));
  return app;
}
async function request(url: string, body?: object | FormData, sessionCookie = cookie) {
  return app.request(url, { method: "POST", headers: {
    Cookie: sessionCookie, ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
  }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
}
async function upload() {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(PNG)], { type: "image/png" }), "notes.png");
  const result = await request("/api/uploads", form);
  expect(result.status).toBe(201);
  return await result.json() as Attachment;
}
function outgoing(index: number) {
  const [url, init] = fetcher.mock.calls[index]!;
  const body = JSON.parse(init!.body as string) as Record<string, any>;
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-secret");
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  for (const key of ["stop", "n", "logprobs", "max_tokens", "top_logprobs"]) expect(body).not.toHaveProperty(key);
  if (body.tool_choice) expect(body.tool_choice).toBe("auto");
  return { url, body };
}

beforeEach(async () => {
  for (const key of ["META_TEXT_MODEL", "META_IMAGE_MODEL", "META_TRANSCRIBE_MODEL", "META_SEGMENT_MODEL", "META_BASE_URL"]) vi.stubEnv(key, undefined);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "inkwell-media-"));
  services = createServices(dir);
  fetcher = vi.fn<typeof fetch>();
  app = makeApp();
  const response = await app.request("/api/me");
  ctx = await response.json() as SessionCtx;
  cookie = response.headers.get("set-cookie")!.split(";")[0]!;
});
afterEach(async () => {
  await services.close();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("transcription", () => {
  it("sends the documented JSON request/audio parts and returns transcript text", async () => {
    fetcher.mockResolvedValueOnce(json({ transcript: "Write a note.", turns: [] }));
    const response = await request("/api/transcribe", audioForm());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "Write a note." });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.meta.ai/v1/asr/transcribe");
    const form = init!.body as FormData;
    expect([...form.keys()]).toEqual(["request", "audio"]);
    const settings = form.get("request") as File;
    expect(settings.type).toBe("application/json");
    expect(JSON.parse(await settings.text())).toEqual({ model: "muse-voice-transcribe-1.0", mode: "PUSH_TO_TALK", audioEncoding: "WAV" });
    expect(Buffer.from(await (form.get("audio") as File).arrayBuffer())).toEqual(wav());
    expect(new Headers(init!.headers).has("content-type")).toBe(false);
  });
  it("accepts a compatible text response and 24 kHz audio", async () => {
    fetcher.mockResolvedValueOnce(json({ text: "Hello" }));
    expect(await (await request("/api/transcribe", audioForm(wav(24_000)))).json()).toEqual({ text: "Hello" });
  });
  it("rejects webm with an actionable 415 before calling Meta", async () => {
    const response = await request("/api/transcribe", audioForm(Buffer.from("webm"), "audio/webm"));
    expect(response.status).toBe(415);
    expect(await response.text()).toContain("WebM is not supported");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects unsupported sample rates and over-ten-minute recordings", async () => {
    expect((await request("/api/transcribe", audioForm(wav(44_100)))).status).toBe(415);
    const response = await request("/api/transcribe", audioForm(wav(16_000, 601)));
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("10-minute");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects missing audio and truncated RIFF data", async () => {
    expect((await request("/api/transcribe", new FormData())).status).toBe(400);
    expect((await request("/api/transcribe", audioForm(wav().subarray(0, 45)))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("page illustration", () => {
  it("persists a PNG through the attachment helper and publishes one update", async () => {
    const page = services.pages.createPage(ctx.workspaceId, ctx.person, { title: "Lisbon", markdown: "Walk the harbour." });
    const events: ServerEvent[] = [];
    services.bus.subscribe(ctx.workspaceId, (event) => events.push(event));
    fetcher.mockResolvedValueOnce(json({ data: [{ b64_json: PNG.toString("base64") }] }));
    const response = await request(`/api/pages/${page.id}/illustrate`);
    expect(response.status).toBe(200);
    const updated = await response.json() as Page;
    expect(updated.coverUrl).toMatch(/^\/api\/files\//);
    expect(services.pages.getPage(ctx.workspaceId, page.id)?.coverUrl).toBe(updated.coverUrl);
    const row = getAttachmentRow(services.db, ctx.workspaceId, updated.coverUrl!.split("/").at(-1)!);
    expect(row?.mime).toBe("image/png");
    expect(fs.readFileSync(path.join(services.uploadsDir, row!.path))).toEqual(PNG);
    expect(events).toEqual([{ type: "page.updated", page: updated }]);
    const served = await app.request(updated.coverUrl!, { headers: { Cookie: cookie } });
    expect(served.status).toBe(200);
    expect(Buffer.from(await served.arrayBuffer())).toEqual(PNG);
    const outsider = await app.request("/api/me");
    const outsiderCookie = outsider.headers.get("set-cookie")!.split(";")[0]!;
    expect((await app.request(updated.coverUrl!, { headers: { Cookie: outsiderCookie } })).status).toBe(404);
    const { body, url } = outgoing(0);
    expect(url).toBe("https://api.meta.ai/v1/images/generations");
    expect(body).toMatchObject({ model: "muse-image-1.0", output_format: "png", response_format: "b64_json" });
    expect(body.prompt).toContain("Lisbon"); expect(body.prompt).toContain("Walk the harbour");
    expect(body.prompt).toContain("antique parchment map vignette, iron-gall ink and watercolour, no text");
  });
  it("downloads URL responses without forwarding the API credential", async () => {
    const page = services.pages.listPages(ctx.workspaceId)[0]!;
    fetcher.mockResolvedValueOnce(json({ data: [{ url: "https://cdn.example.com/image.png?signed=1" }] }))
      .mockResolvedValueOnce(new Response(new Uint8Array(PNG)));
    expect((await request(`/api/pages/${page.id}/illustrate`)).status).toBe(200);
    const [url, init] = fetcher.mock.calls[1]!;
    expect(url).toBe("https://cdn.example.com/image.png?signed=1");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(init?.redirect).toBe("error");
  });
  it("rejects non-PNG bytes and unsafe download URLs without creating attachments", async () => {
    const page = services.pages.listPages(ctx.workspaceId)[0]!;
    fetcher.mockResolvedValueOnce(json({ data: [{ b64_json: Buffer.from("not png").toString("base64") }] }))
      .mockResolvedValueOnce(json({ data: [{ url: "http://127.0.0.1/private" }] }));
    expect((await request(`/api/pages/${page.id}/illustrate`)).status).toBe(502);
    expect((await request(`/api/pages/${page.id}/illustrate`)).status).toBe(502);
    expect(fs.readdirSync(services.uploadsDir)).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("cleans up the image file if attachment persistence fails", async () => {
    const page = services.pages.listPages(ctx.workspaceId)[0]!;
    services.db.exec("CREATE TRIGGER fail_attachment BEFORE INSERT ON attachments BEGIN SELECT RAISE(ABORT, 'test write failure'); END");
    fetcher.mockResolvedValueOnce(json({ data: [{ b64_json: PNG.toString("base64") }] }));
    expect((await request(`/api/pages/${page.id}/illustrate`)).status).toBe(500);
    expect(services.pages.getPage(ctx.workspaceId, page.id)?.coverUrl).toBe(page.coverUrl);
    expect(fs.readdirSync(services.uploadsDir)).toEqual([]);
  });
  it("handles a page deleted during generation without leaving orphan files", async () => {
    const page = services.pages.listPages(ctx.workspaceId)[0]!;
    fetcher.mockImplementationOnce(async () => {
      services.pages.deletePage(ctx.workspaceId, page.id);
      return json({ data: [{ b64_json: PNG.toString("base64") }] });
    });
    expect((await request(`/api/pages/${page.id}/illustrate`)).status).toBe(404);
    expect(fs.readdirSync(services.uploadsDir)).toEqual([]);
  });
});

describe("photo import", () => {
  it("uses native SAM SSE boxes, creates parent plus N positioned cards and emits scoped events", async () => {
    const attachment = await upload();
    const oldPages = services.pages.listPages(ctx.workspaceId);
    const maxX = Math.max(...oldPages.map((page) => page.x ?? 0));
    const events: ServerEvent[] = [];
    services.bus.subscribe(ctx.workspaceId, (event) => events.push(event));
    const text = "<0f>0<|box;x1=10;y1=20;x2=30;y2=40;w=100;h=100|><|mask;x=0;y=0;data=20,20,~...|>,2<|box;x1=60;y1=50;x2=90;y2=80;w=100;h=100;c=0.9|><|mask;x=0;y=0;data=30,30,~...|>";
    const sse = `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\ndata: {"type":"response.completed","response":{}}\n\n`;
    fetcher.mockResolvedValueOnce(new Response(sse, { headers: { "Content-Type": "text/event-stream" } }))
      .mockResolvedValueOnce(vision([{ ...NOTE_A, box: null }, { ...NOTE_B, box: null }]));
    const response = await request("/api/import/photo", { attachmentId: attachment.id });
    expect(response.status).toBe(200);
    const { pages } = await response.json() as { pages: Page[] };
    expect(pages).toHaveLength(3);
    const [parent, first, second] = pages as [Page, Page, Page];
    expect(parent.title).toMatch(/^From photo — \d{4}-\d{2}-\d{2}$/);
    expect(first.parentId).toBe(parent.id); expect(second.parentId).toBe(parent.id);
    expect(first.x).toBe(maxX + 600 + 160); expect(first.y).toBe(320);
    expect(second.x).toBe(maxX + 600 + 960); expect(second.y).toBe(800);
    expect(services.pages.getPageWithBody(ctx.workspaceId, first.id)?.markdown).toBe(NOTE_A.markdown);
    expect(events).toEqual(pages.map((page) => ({ type: "page.created", page })));
    expect(services.pages.listPages(ctx.workspaceId)).toHaveLength(oldPages.length + 3);
    const sam = outgoing(0);
    expect(sam.url).toBe("https://api.meta.ai/v1/responses");
    expect(sam.body).toMatchObject({ model: "sam-3.1", stream: true });
    expect(sam.body.input[0].content).toEqual([
      { type: "input_text", text: "each sticky note or distinct block of handwriting" },
      { type: "input_image", image_url: `data:image/png;base64,${PNG.toString("base64")}` },
    ]);
    const chat = outgoing(1);
    expect(chat.url).toBe("https://api.meta.ai/v1/chat/completions");
    expect(chat.body.model).toBe("muse-spark-1.3");
    expect(chat.body.max_completion_tokens).toBe(8192);
    expect(chat.body.messages[1].content[0].text).toContain(JSON.stringify([NOTE_A.box, NOTE_B.box]));
    expect(chat.body.messages[1].content[1]).toEqual({ type: "image_url", image_url: { url: `data:image/png;base64,${PNG.toString("base64")}` } });
  });
  it.each(["failure", "empty"])("falls back to vision alone when SAM returns %s", async (mode) => {
    const attachment = await upload();
    fetcher.mockResolvedValueOnce(mode === "failure" ? json({ error: { message: "SAM unavailable" } }, 503) : json({ output: [] }))
      .mockResolvedValueOnce(vision([NOTE_A, NOTE_B]));
    const response = await request("/api/import/photo", { attachmentId: attachment.id });
    expect(response.status).toBe(200);
    const { pages } = await response.json() as { pages: Page[] };
    expect(pages).toHaveLength(3);
    expect(pages[1]!.y).toBe(320);
    expect(pages[2]!.y).toBe(800);
    expect(outgoing(1).body.messages[1].content[0].text).toContain("Segmentation boxes (normalized 0..1): []");
  });
  it("rejects malformed or empty notes before creating any pages", async () => {
    const attachment = await upload();
    const oldCount = services.pages.countPages(ctx.workspaceId);
    fetcher.mockResolvedValueOnce(json({ boxes: [] })).mockResolvedValueOnce(vision([NOTE_A, { title: 7 }]))
      .mockResolvedValueOnce(json({ boxes: [] })).mockResolvedValueOnce(vision([]));
    expect((await request("/api/import/photo", { attachmentId: attachment.id })).status).toBe(502);
    expect((await request("/api/import/photo", { attachmentId: attachment.id })).status).toBe(422);
    expect(services.pages.countPages(ctx.workspaceId)).toBe(oldCount);
  });
  it("rolls back all pages and emits no events if storing a note fails", async () => {
    const attachment = await upload();
    const oldCount = services.pages.countPages(ctx.workspaceId);
    const events: ServerEvent[] = [];
    services.bus.subscribe(ctx.workspaceId, (event) => events.push(event));
    services.db.exec("CREATE TRIGGER fail_note BEFORE INSERT ON pages WHEN NEW.title = 'Build' BEGIN SELECT RAISE(ABORT, 'test write failure'); END");
    fetcher.mockResolvedValueOnce(json({ boxes: [] })).mockResolvedValueOnce(vision([NOTE_A, NOTE_B]));
    expect((await request("/api/import/photo", { attachmentId: attachment.id })).status).toBe(500);
    expect(services.pages.countPages(ctx.workspaceId)).toBe(oldCount);
    expect(events).toEqual([]);
  });
  it("validates the attachment ID and kind", async () => {
    expect((await request("/api/import/photo", {})).status).toBe(400);
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(wav())], { type: "audio/wav" }), "voice.wav");
    const attachment = await (await request("/api/uploads", form)).json() as Attachment;
    expect((await request("/api/import/photo", { attachmentId: attachment.id })).status).toBe(415);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("isolation and provider failures", () => {
  it("returns 404 for another workspace's attachment or page before any provider call", async () => {
    const attachment = await upload();
    const page = services.pages.listPages(ctx.workspaceId)[0]!;
    const other = await app.request("/api/me");
    const otherCookie = other.headers.get("set-cookie")!.split(";")[0]!;
    expect((await request("/api/import/photo", { attachmentId: attachment.id }, otherCookie)).status).toBe(404);
    expect((await request(`/api/pages/${page.id}/illustrate`, undefined, otherCookie)).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("returns 503 for every endpoint when no API key is configured", async () => {
    const attachment = await upload();
    const page = services.pages.listPages(ctx.workspaceId)[0]!;
    app = makeApp({ apiKey: "" });
    const responses = [
      await request("/api/transcribe", audioForm()),
      await request(`/api/pages/${page.id}/illustrate`),
      await request("/api/import/photo", { attachmentId: attachment.id }),
    ];
    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "Meta API key isn't configured" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("exposes upstream status and message, but redacts keys", async () => {
    fetcher.mockResolvedValueOnce(json({ error: { message: "Quota exhausted test-secret" } }, 429));
    const response = await request("/api/transcribe", audioForm());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Meta API 429: Quota exhausted [redacted]" });
  });
  it("returns a useful timeout error without leaking raw fetch errors", async () => {
    fetcher.mockRejectedValueOnce(new DOMException("secret URL", "TimeoutError"));
    const response = await request("/api/transcribe", audioForm());
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: "Meta request timed out" });
  });
  it("honors configured base URL and model overrides", async () => {
    vi.stubEnv("META_BASE_URL", "https://meta.example.test/v1/");
    vi.stubEnv("META_TRANSCRIBE_MODEL", "voice-custom");
    vi.stubEnv("META_IMAGE_MODEL", "image-custom");
    vi.stubEnv("META_SEGMENT_MODEL", "sam-custom");
    vi.stubEnv("META_TEXT_MODEL", "text-custom");
    app = makeApp();
    const attachment = await upload();
    const page = services.pages.listPages(ctx.workspaceId)[0]!;
    fetcher.mockResolvedValueOnce(json({ text: "hello" }))
      .mockResolvedValueOnce(json({ data: [{ b64_json: PNG.toString("base64") }] }))
      .mockResolvedValueOnce(json({ boxes: [] })).mockResolvedValueOnce(vision([NOTE_A]));
    await request("/api/transcribe", audioForm());
    await request(`/api/pages/${page.id}/illustrate`);
    await request("/api/import/photo", { attachmentId: attachment.id });
    expect(fetcher.mock.calls.every(([url]) => String(url).startsWith("https://meta.example.test/v1/"))).toBe(true);
    const form = fetcher.mock.calls[0]![1]!.body as FormData;
    expect(JSON.parse(await (form.get("request") as File).text()).model).toBe("voice-custom");
    expect(outgoing(1).body.model).toBe("image-custom");
    expect(outgoing(2).body.model).toBe("sam-custom");
    expect(outgoing(3).body.model).toBe("text-custom");
  });
});

describe("tolerant SAM adapters", () => {
  it("parses nested JSON text, normalized arrays, and named boxes without duplicates", () => {
    expect(parseSamBoxes({ output: [{ content: [{ text: JSON.stringify({ boxes: [
      [100, 200, 300, 400], { x: 0.6, y: 0.5, width: 0.3, height: 0.3 },
      [100, 200, 300, 400], [0.5, 0.5, 0.2, 0.1],
    ] }) }] }] })).toEqual([NOTE_A.box, [0.6, 0.5, 0.8999999999999999, 0.8]]);
  });
  it("bounds streamed response bodies", async () => {
    const client = createMetaClient({ apiKey: "test-secret", fetch: fetcher });
    fetcher.mockResolvedValueOnce(new Response("", { headers: { "Content-Length": String(40 * 1024 * 1024) } }));
    await expect(client.post("/responses", {})).rejects.toThrow("size limit");
  });
});
