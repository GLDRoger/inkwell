// @vitest-environment node
// Fixes from the real Muse Wonder evaluation (docs/PLAN.md, "Real Muse Wonder eval").
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { getDiaryEntry, getRun, listAgents } from "../db.ts";
import { SEED_AGENTS, upgradeSeedAgents } from "../seed.ts";
import type { Services } from "../services.ts";
import { repairPageLinks, stripTitleHeading } from "./links.ts";
import { createMetaModel, NO_FIRST_BYTE, withFirstByteWatchdog } from "./model.ts";
import { PRIMER } from "./runtime.ts";
import * as helpers from "./testing.ts";

const fixtures: { services: Services; dir: string }[] = [];
afterEach(async () => {
  for (const { services, dir } of fixtures.splice(0)) {
    await services.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
});

describe("primer", () => {
  it.each([
    ["copies links from tool results instead of typing ids", /Copy each link exactly from a tool result.*never type or retype a page id/],
    ["treats the diary as the reply", /final reply appears in the person's diary\. "Tell me in the diary".*means your reply, not a new page/],
    ["trusts a write's success", /write tool's success message is authoritative: don't read the page again/],
    ["lists named pages once instead of searching", /names pages, call list_pages once and use the ids it gives\. Use search_pages only to find content/],
    ["respects requested lengths", /Respect any length the person asks for/],
    ["doesn't repeat the title as a heading", /don't repeat it as a heading at the top/],
  ])("%s", (_name, line) => expect(PRIMER).toMatch(line));
});

describe("Scout's instructions", () => {
  it("record facts without commentary on gaps, mentioned once in the reply", () => {
    const scout = SEED_AGENTS.find((a) => a.name === "Scout")!;
    expect(scout.instructions).toMatch(/without commentary on what's missing/);
    expect(scout.instructions).toMatch(/say so once, in your reply/);
  });
  it("are upgraded in existing notebooks that kept the old ones", () => {
    const f = helpers.createFixture(fixtures);
    const old = "You are Scout, a research agent. Search and read the user's pages before answering. Summarise with links to the pages you used, quote sparingly, and say plainly when the notebook doesn't contain an answer. Prefer facts already in the notebook over general knowledge.";
    f.services.db.prepare("UPDATE agents SET instructions = ? WHERE name = 'Scout'").run(old);
    upgradeSeedAgents(f.services.db);
    expect(listAgents(f.services.db, f.ws).find((a) => a.name === "Scout")?.instructions).toBe(SEED_AGENTS[0].instructions);
  });
});

describe("page link safety net", () => {
  const pages = [
    { id: "AAAAAAAAAAAAAAAAAAAAA", title: "Trip to Lisbon" },
    { id: "BBBBBBBBBBBBBBBBBBBBB", title: "Lisbon itinerary" },
    { id: "CCCCCCCCCCCCCCCCCCCCC", title: "Startup: launch plan" },
  ];
  it("points a link whose id was mis-copied at the page its label names", () => {
    expect(repairPageLinks("See [Lisbon itinerary](/p/BBBBBBBBBBBBBBBBBBBBb).", pages))
      .toBe("See [Lisbon itinerary](/p/BBBBBBBBBBBBBBBBBBBBB).");
  });
  it("points a link at the right page when its id is another page's", () => {
    expect(repairPageLinks("[**Trip to Lisbon**](/p/BBBBBBBBBBBBBBBBBBBBB)", pages))
      .toBe("[**Trip to Lisbon**](/p/AAAAAAAAAAAAAAAAAAAAA)");
  });
  it("unlinks a dead id with no named page, and leaves good or free-text links alone", () => {
    const text = "[the plan](/p/ZZZZZZZZZZZZZZZZZZZZZ), [the launch plan](/p/CCCCCCCCCCCCCCCCCCCCC), [Startup: launch plan](/p/CCCCCCCCCCCCCCCCCCCCC)";
    expect(repairPageLinks(text, pages)).toBe("the plan, [the launch plan](/p/CCCCCCCCCCCCCCCCCCCCC), [Startup: launch plan](/p/CCCCCCCCCCCCCCCCCCCCC)");
  });

  it("repairs the final diary reply", async () => {
    let f!: ReturnType<typeof helpers.createFixture>;
    const model = new MockLanguageModelV4({ doStream: async () =>
      helpers.answer(`Updated [Billing](/p/${f.page.id.slice(0, -1)}X) and [Billing](/p/${f.page.id}).`) });
    f = helpers.createFixture(fixtures, { modelFactory: () => model });
    const started = f.start("Improve billing");
    const result = await started.done;
    const link = `[Billing](/p/${f.page.id})`;
    expect(result.text).toBe(`Updated ${link} and ${link}.`);
    expect(getDiaryEntry(f.services.db, f.ws, started.entry!.id)?.text).toBe(`Updated ${link} and ${link}.`);
  });

  it("list_pages and search_pages hand the model a link to copy", async () => {
    let step = 0;
    const model = new MockLanguageModelV4({ doStream: async () => {
      step++;
      if (step === 1) return helpers.call("list_pages", {});
      if (step === 2) return helpers.call("search_pages", { query: "billing" });
      return helpers.answer("Done.");
    } });
    const f = helpers.createFixture(fixtures, { modelFactory: () => model });
    await f.start("List my pages").done;
    const link = JSON.stringify(`[Billing](/p/${f.page.id})`);
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(JSON.stringify(`"link":${link}`).slice(1, -1));
    expect(JSON.stringify(model.doStreamCalls[2]?.prompt).split(JSON.stringify(`"link":${link}`).slice(1, -1)).length).toBe(3);
  });
});

describe("the page title isn't repeated as a heading", () => {
  it.each([
    ["# Plan: 5 days in Lisbon\n\n## Day 1\n\nTram 28.", "## Day 1\n\nTram 28."],
    ["## 🧳 **Plan: 5 days in Lisbon**\nDay 1", "Day 1"],
    ["# Plan: 5 days in Lisbon #\n", ""],
    ["# Day 1\n\nPlan: 5 days in Lisbon", "# Day 1\n\nPlan: 5 days in Lisbon"],
    ["Intro\n\n# Plan: 5 days in Lisbon", "Intro\n\n# Plan: 5 days in Lisbon"],
  ])("%j", (markdown, expected) => expect(stripTitleHeading(markdown, "Plan: 5 days in Lisbon")).toBe(expected));

  it("create_page and rewrite_page drop it", async () => {
    let step = 0;
    let f!: ReturnType<typeof helpers.createFixture>;
    let created = "";
    const model = new MockLanguageModelV4({ doStream: async () => {
      step++;
      if (step === 1) return helpers.call("create_page", { title: "Packing list", markdown: "# Packing list\n\n- Adapter" });
      if (step === 2) {
        created = f.services.pages.listPages(f.ws).find((p) => p.title === "Packing list")!.id;
        return helpers.call("rewrite_page", { pageId: f.page.id, version: await helpers.versionOf(f.services, f.ws, f.page.id), markdown: "# Billing\n\nNew notes." });
      }
      return helpers.answer("Done.");
    } });
    f = helpers.createFixture(fixtures, { modelFactory: () => model });
    expect((await f.start().done).run.status).toBe("succeeded");
    expect((await f.services.collab.readPageMarkdown(created, f.ws))!.trim()).toBe("- Adapter");
    expect((await f.services.collab.readPageMarkdown(f.page.id, f.ws))!.trim()).toBe("New notes.");
  });
});

describe("run usage", () => {
  it("records input and output tokens on the run", async () => {
    let step = 0;
    const model = new MockLanguageModelV4({ doStream: async () => (++step === 1 ? helpers.call("list_pages", {}) : helpers.answer("Done.")) });
    const f = helpers.createFixture(fixtures, { modelFactory: () => model });
    const result = await f.start().done;
    // testing.ts reports 5 input and 5 output tokens per step.
    expect(result.run.usage).toEqual({ inputTokens: 10, outputTokens: 10, totalTokens: 20 });
    expect(getRun(f.services.db, f.ws, result.run.id)?.usage).toEqual({ inputTokens: 10, outputTokens: 10, totalTokens: 20 });
  });
});

describe("first-byte watchdog", () => {
  /** A fetch that never answers until aborted. */
  const silent: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  });
  const sse = (text: string) => new Response(
    `data: ${JSON.stringify({ id: "t", created: 0, model: "m", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n` +
    `data: ${JSON.stringify({ id: "t", created: 0, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } });

  it("abandons a silent call and asks once more", async () => {
    let calls = 0;
    const fetch = withFirstByteWatchdog(async (url, init) => (++calls === 1 ? silent(url, init) : sse("OK")), { timeoutMs: 20 });
    const model = createMetaModel({ apiKey: "k", fetch });
    expect(await streamText({ model, prompt: "hi", maxRetries: 0 }).text).toBe("OK");
    expect(calls).toBe(2);
  });

  it("gives the retry twice as long", async () => {
    let calls = 0;
    const fetch = withFirstByteWatchdog(async (url, init) => {
      if (++calls === 1) return silent(url, init);
      await new Promise((resolve) => setTimeout(resolve, 60)); // slower than the first wait, within the second
      return sse("OK");
    }, { timeoutMs: 40 });
    expect(await (await fetch("http://x")).text()).toContain("OK");
    expect(calls).toBe(2);
  });

  it("also watches the body: headers alone aren't a first byte", async () => {
    let calls = 0;
    const fetch = withFirstByteWatchdog(async (url, init) => {
      if (++calls > 1) return sse("OK");
      return new Response(new ReadableStream({ start(c) {
        init?.signal?.addEventListener("abort", () => c.error(init.signal!.reason), { once: true });
      } }), { headers: { "Content-Type": "text/event-stream" } });
    }, { timeoutMs: 20 });
    expect(await (await fetch("http://x")).text()).toContain("OK");
    expect(calls).toBe(2);
  });

  it("gives up after the retry with a plain message the SDK doesn't retry again", async () => {
    let calls = 0;
    const fetch = withFirstByteWatchdog((url, init) => { calls++; return silent(url, init); }, { timeoutMs: 20 });
    const model = createMetaModel({ apiKey: "k", fetch });
    const errors: unknown[] = [];
    const result = streamText({ model, prompt: "hi", maxRetries: 1, onError: ({ error }) => { errors.push(error); } });
    await result.consumeStream();
    expect(calls).toBe(2);
    expect((errors[0] as Error).message).toBe(NO_FIRST_BYTE);
  });

  it("a live run that never hears back says so", async () => {
    const server = http.createServer(() => { /* never answers */ });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      vi.stubEnv("META_API_KEY", "test-key");
      vi.stubEnv("META_BASE_URL", `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`);
      const f = helpers.createFixture(fixtures, { firstByteMs: 30 });
      const result = await f.start().done;
      expect(result.run.status).toBe("failed");
      expect(result.run.error).toBe(NO_FIRST_BYTE);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it("stops at once when the caller aborts", async () => {
    const fetch = withFirstByteWatchdog(silent, { timeoutMs: 10_000 });
    const controller = new AbortController();
    const pending = fetch("http://x", { signal: controller.signal });
    controller.abort(new Error("Run stopped."));
    await expect(pending).rejects.toThrow("Run stopped.");
  });
});
