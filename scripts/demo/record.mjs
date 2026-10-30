#!/usr/bin/env node
// Record the demo cassette (docs/DEMO-MODE.md, "Recording").
//
//   node --env-file=.env scripts/demo/record.mjs            # real Meta API (META_API_KEY, META_BASE_URL)
//   node scripts/demo/record.mjs --fake                     # the rehearsal fake, no key needed
//   options: --scenario lisbon-tour  --out <file>  --model muse-wonder-1.0
//
// Plays the scenario in a scratch notebook (a temp data dir, deleted afterwards),
// captures every Meta exchange in order and writes src/server/demo/cassettes/<id>.json.
// Prints token usage per exchange. The key is never written: the cassette holds no
// request headers, key-like strings are scrubbed, and the file is checked before it is kept.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

register();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const useFake = process.argv.includes("--fake");

let fake;
if (useFake) {
  const { startFakeMeta } = await import("../rehearsal/fake-meta.mjs");
  fake = await startFakeMeta({ port: 0, fast: true, quiet: true });
  process.env.META_BASE_URL = fake.url;
  process.env.META_API_KEY = "rehearsal";
}
const key = process.env.META_API_KEY?.trim();
if (!key) {
  console.error("META_API_KEY not set (or pass --fake to record from the rehearsal fake)");
  process.exit(2);
}
const say = (message) => console.log(useFake ? String(message) : String(message).split(key).join("[redacted]"));
const baseUrl = (process.env.META_BASE_URL || "https://api.meta.ai/v1").replace(/\/+$/, "");
const scenarioId = arg("scenario") ?? "lisbon-tour";
const { SCENARIOS } = await import("../../src/server/demo/scenario.ts");
const { recordScenario } = await import("../../src/server/demo/record.ts");
const { createServices } = await import("../../src/server/services.ts");
const { defaultTextModel } = await import("../../src/server/meta-access.ts");
const scenario = SCENARIOS[scenarioId];
if (!scenario) { console.error(`Unknown scenario ${scenarioId}`); process.exit(2); }
const model = arg("model") ?? defaultTextModel();
const out = path.resolve(arg("out") ?? path.join(root, "src/server/demo/cassettes", `${scenarioId}.json`));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inkwell-record-"));
const services = createServices(dir);
let failed = false;
try {
  say(`[record] ${scenarioId} with ${model} via ${new URL(baseUrl).host}`);
  const started = Date.now();
  const cassette = await recordScenario({
    services, scenario, apiKey: key, baseUrl, model,
    // The fake's placeholder key is a plain word; only a real key is secret.
    secrets: useFake ? [] : [key],
    onStep: (index, id) => say(`[record] step ${index + 1}/${scenario.steps.length}: ${id}`),
  });
  for (const step of cassette.steps) {
    for (const [n, stream] of step.streams.entries()) {
      for (const exchange of stream.exchanges) {
        const r = exchange.response;
        const usage = r.type === "chat-stream" || r.type === "json" ? r.usage : undefined;
        const what = r.type === "chat-stream"
          ? (r.toolCalls.length ? r.toolCalls.map((c) => c.name).join(",") : `reply ${r.text.length} chars`)
          : r.type;
        say(`  ${step.id} ${stream.kind}${n} ${exchange.path} ${exchange.status} ${exchange.ms}ms ${what}` +
          (usage ? ` in=${usage.input} out=${usage.output}${usage.reasoning ? ` (reasoning ${usage.reasoning})` : ""}` : ""));
      }
    }
  }
  // Report what the runs did, so a weak recording is visible before it is committed.
  const ws = services.db.prepare("SELECT demo_workspace_id AS id FROM sessions LIMIT 1").get().id;
  const runs = services.db.prepare("SELECT status, error, steps FROM runs WHERE workspace_id = ? ORDER BY rowid").all(ws);
  for (const run of runs) {
    if (run.status !== "succeeded") { failed = true; say(`[record] a run ${run.status}: ${run.error}`); }
  }
  const { externalizeImages } = await import("../../src/server/demo/cassette.ts");
  const images = new Map();
  externalizeImages(cassette, (name, bytes) => images.set(name, bytes));
  const json = `${JSON.stringify(cassette, null, 1)}\n`;
  if ((!useFake && json.includes(key)) || /Bearer\s+\S{8,}/i.test(json)) throw new Error("refusing to write: the cassette contains key material");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, json);
  for (const [name, bytes] of images) fs.writeFileSync(path.join(path.dirname(out), name), bytes);
  const u = cassette.usage;
  say(`[record] ${u.exchanges} exchanges; tokens in=${u.input} (cached ${u.cached}) out=${u.output} (reasoning ${u.reasoning}); ${Math.round((Date.now() - started) / 1000)} s`);
  say(`[record] wrote ${path.relative(root, out)} (${Math.round(json.length / 1024)} KB + ${images.size} image(s) ${Math.round([...images.values()].reduce((n, b) => n + b.length, 0) / 1024)} KB, recordedFrom ${cassette.scenario.recordedFrom})`);
  if (process.argv.includes("--dump")) {
    for (const page of services.pages.listPages(ws)) {
      if (Object.values(cassette.seed).includes(page.id)) continue;
      say(`\n===== ${page.title}\n${await services.collab.readPageMarkdown(page.id, ws)}`);
    }
    for (const row of services.db.prepare("SELECT role, text FROM diary_entries WHERE workspace_id = ? ORDER BY rowid").all(ws)) {
      say(`\n----- ${row.role}: ${row.text}`);
    }
  }
} catch (error) {
  failed = true;
  say(`[record] failed: ${error instanceof Error ? error.message : "unknown error"}`);
} finally {
  await services.close();
  fs.rmSync(dir, { recursive: true, force: true });
  await fake?.close();
}
process.exit(failed ? 1 : 0);
