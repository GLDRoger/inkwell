// Run: npx tsx --test scripts/rehearsal/fake-meta.test.mjs
// Boots the rehearsal Meta API and drives the real agent runtime and media parsers against it.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFakeMeta, parchmentPng } from "./fake-meta.mjs";

let fake, services, dir, ctx, mods;

before(async () => {
  fake = await startFakeMeta({ port: 0, fast: true, quiet: true });
  process.env.META_BASE_URL = fake.url;
  process.env.META_API_KEY = "rehearsal";
  mods = {
    ...await import("../../src/server/services.ts"),
    ...await import("../../src/server/session.ts"),
    ...await import("../../src/server/db.ts"),
    ...await import("../../src/server/media/meta.ts"),
    ...await import("../../src/server/media/transcribe.ts"),
    ...await import("../../src/server/media/boxes.ts"),
    ...await import("../../src/server/media/illustrate.ts"),
    ...await import("../../src/server/media/photo.ts"),
  };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "inkwell-rehearsal-"));
  services = mods.createServices(dir);
  ctx = mods.createWorkspaceSession(services);
});
after(async () => {
  await services?.close();
  await fake?.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

const agent = (name) => mods.listAgents(services.db, ctx.workspaceId).find((a) => a.name === name);
const titles = () => services.pages.listPages(ctx.workspaceId).map((p) => p.title);
async function ask(name, prompt) {
  const thread = mods.insertDiaryThread(services.db, ctx.workspaceId, prompt);
  mods.insertDiaryEntry(services.db, ctx.workspaceId, { threadId: thread.id, role: "person", text: prompt });
  const started = services.runtime.start({ workspaceId: ctx.workspaceId, agentId: agent(name).id, threadId: thread.id, prompt });
  const result = await started.done;
  const entry = mods.getDiaryEntry(services.db, ctx.workspaceId, started.entry.id);
  return { ...result, entry, tools: result.run.steps.map((s) => s.tool) };
}

test("summarise: search -> read x2 -> create_page, reply links real titles", async () => {
  const before = titles().length;
  const r = await ask("Scout", "Summarise the Lisbon trip for me");
  assert.equal(r.run.status, "succeeded", r.run.error ?? "");
  assert.deepEqual(r.tools, ["search_pages", "read_page", "read_page", "create_page"]);
  assert.ok(r.run.steps.every((s) => s.ok));
  assert.equal(titles().length, before + 1);
  const summary = services.pages.listPages(ctx.workspaceId).find((p) => p.title.startsWith("Summary: "));
  assert.ok(summary);
  const body = await services.collab.readPageMarkdown(summary.id, ctx.workspaceId);
  assert.match(body, /## Key points/);
  assert.match(r.entry.text, /Lisbon/);
  assert.match(r.entry.text, /\]\(\/p\//);
});

test("handoff: ask_agent runs a child Wren run that creates a checklist", async () => {
  const r = await ask("Scout", "Ask Wren to draft a packing checklist for the Lisbon trip.");
  assert.equal(r.run.status, "succeeded", r.run.error ?? "");
  assert.deepEqual(r.tools, ["search_pages", "read_page", "ask_agent"]);
  const child = mods.listRecentRuns(services.db, ctx.workspaceId).find((run) => run.parentRunId === r.run.id);
  assert.equal(child?.status, "succeeded");
  assert.deepEqual(child.steps.map((s) => s.tool), ["read_page", "create_page"]);
  assert.ok(titles().some((t) => /^Packing checklist: /.test(t)), titles().join(", "));
  assert.match(r.entry.text, /handed it to Wren/);
});

test("edit: Wren makes one exact edit_page change", async () => {
  const r = await ask("Wren", "Polish the sourdough journal");
  assert.equal(r.run.status, "succeeded", r.run.error ?? "");
  assert.deepEqual(r.tools, ["search_pages", "read_page", "edit_page"]);
  assert.ok(r.run.steps.every((s) => s.ok), JSON.stringify(r.run.steps));
  const page = services.pages.listPages(ctx.workspaceId).find((p) => p.title === "Sourdough journal");
  assert.match(await services.collab.readPageMarkdown(page.id, ctx.workspaceId), /\*\*In short:\*\*/);
});

test("organise and append both use real tools", async () => {
  const tidy = await ask("Atlas", "Tidy up the reading notes");
  assert.equal(tidy.run.status, "succeeded", tidy.run.error ?? "");
  assert.equal(tidy.tools[0], "list_pages");
  const add = await ask("Wren", "Add a shopping list to the weeknight dinners page");
  assert.equal(add.run.status, "succeeded", add.run.error ?? "");
  assert.equal(add.tools.at(-1), "append_to_page");
  const page = services.pages.listPages(ctx.workspaceId).find((p) => p.title === "Weeknight dinners");
  assert.match(await services.collab.readPageMarkdown(page.id, ctx.workspaceId), /## Shopping list/);
});

test("delete everything is refused without delete calls", async () => {
  const before = titles().length;
  const r = await ask("Atlas", "Delete everything in my notebook");
  assert.equal(r.run.status, "succeeded");
  assert.ok(!r.tools.includes("delete_page"));
  assert.equal(titles().length, before);
  assert.match(r.entry.text, /won't delete everything/);
});

test("media: transcript, PNG cover, SAM boxes and photo notes parse with the real code", async () => {
  const meta = mods.createMetaClient();
  const rate = 16_000, bytes = Buffer.alloc(44 + rate);
  bytes.write("RIFF"); bytes.writeUInt32LE(36 + rate, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(rate, 40);
  const { text } = await mods.transcribe(new File([bytes], "a.wav", { type: "audio/wav" }), meta);
  assert.match(text, /packing checklist/);

  const page = services.pages.listPages(ctx.workspaceId)[0];
  const updated = await mods.illustratePage(services, ctx, page.id, meta);
  assert.match(updated.coverUrl, /^\/api\//);

  const png = parchmentPng("notes", 800, 600);
  const boxes = mods.parseSamBoxes(await meta.post("/responses", { model: "sam-3.1", stream: true, input: [{ type: "message", role: "user",
    content: [{ type: "input_text", text: "notes" }, { type: "input_image", image_url: `data:image/png;base64,${png.toString("base64")}` }] }] }, true));
  assert.equal(boxes.length, 5);
  assert.ok(boxes.every((b) => b.every((v) => v >= 0 && v <= 1)));

  const id = mods.newId();
  fs.writeFileSync(path.join(services.uploadsDir, `${id}.png`), png);
  mods.insertAttachmentRow(services.db, ctx.workspaceId, { id, kind: "image", name: "board.png", mime: "image/png", size: png.length, path: `${id}.png` });
  const { pages } = await mods.importPhoto(services, ctx, id, meta);
  assert.equal(pages.length, 6);
  assert.match(pages[0].title, /^Photo notes, /);
  assert.deepEqual(pages.slice(1).map((p) => p.title), ["Launch checklist", "Ask Wren", "Reading", "Bread", "Open question"]);
});

test("rejects request fields the real API rejects", async () => {
  const post = (body) => fetch(`${fake.url}/chat/completions`, { method: "POST",
    headers: { Authorization: "Bearer x", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post({ model: "m", messages: [], max_tokens: 5 })).status, 400);
  assert.equal((await post({ model: "m", messages: [], tool_choice: "required" })).status, 400);
  assert.equal((await fetch(`${fake.url}/chat/completions`, { method: "POST", body: "{}" })).status, 401);
});

test("key check, visitor keys and the demo work against the fake", async () => {
  const { createApp } = await import("../../src/server/main.ts");
  const { recordScenario } = await import("../../src/server/demo/record.ts");
  const { LISBON_TOUR } = await import("../../src/server/demo/scenario.ts");
  // Record the demo from the fake, then replay it in a fresh app's demo notebook.
  const recordDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkwell-rehearsal-record-"));
  const recorder = mods.createServices(recordDir);
  const cassette = await recordScenario({ services: recorder, scenario: LISBON_TOUR, apiKey: "rehearsal", baseUrl: fake.url, model: "muse-wonder-1.0", secrets: [] });
  await recorder.close();
  fs.writeFileSync(path.join(recordDir, "lisbon-tour.json"), JSON.stringify(cassette));
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkwell-rehearsal-app-"));
  const s = mods.createServices(appDir, {}, { cassettesDir: recordDir, pace: 0 });
  try {
    const app = createApp(s);
    const me = await app.request("/api/me");
    const cookie = me.headers.get("set-cookie").split(";")[0];
    const call = (url, init = {}) => app.request(url, { ...init, headers: { Cookie: cookie, ...init.headers } });
    assert.deepEqual(await (await call("/api/key/check", { method: "POST", headers: { "X-Meta-Key": "visitor-key" } })).json(), { ok: true });
    assert.equal((await (await call("/api/key/check", { method: "POST", headers: { "X-Meta-Key": "invalid-key" } })).json()).ok, false);
    const demoWs = (await (await call("/api/me", { headers: { "X-Inkwell-Notebook": "demo" } })).json()).demoWorkspaceId;
    const ended = new Promise((resolve) => s.bus.subscribe(demoWs, (e) => { if (e.type === "demo.ended") resolve(e.reason); }));
    assert.equal((await call("/api/demo/start", { method: "POST" })).status, 200);
    assert.equal(await ended, "finished");
    const runs = s.db.prepare("SELECT status FROM runs WHERE workspace_id = ? AND recorded = 1").all(demoWs);
    assert.ok(runs.length >= 4 && runs.every((r) => r.status === "succeeded"), JSON.stringify(runs));
  } finally {
    await s.close();
    fs.rmSync(recordDir, { recursive: true, force: true });
    fs.rmSync(appDir, { recursive: true, force: true });
  }
});

test("organise: \"don't move or rename them\" renames nothing", async () => {
  const before = titles().sort();
  const r = await ask("Atlas", "Tidy up the recipes: link them, don't move or rename them.");
  assert.equal(r.run.status, "succeeded", r.run.error ?? "");
  assert.ok(!r.tools.includes("rename_page"));
  assert.deepEqual(titles().sort(), before);
});
