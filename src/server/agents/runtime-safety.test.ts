// @vitest-environment node
/** Client-readiness fixes: concurrent edits, restarts, limits, handoffs and agent-facing replies. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { JSONContent } from "@tiptap/core";
import {
  getDiaryEntry, getRun, insertDiaryEntry, insertDiaryThread, insertRun, listAgents, listDiaryEntries,
  listDiaryThreads, listRecentRuns,
} from "../db.ts";
import { appendJSONToYDoc, markdownToTiptapJSON } from "../editor-schema.ts";
import { cleanIdleWorkspaces } from "../janitor.ts";
import { createApp } from "../main.ts";
import { createServices, type Services } from "../services.ts";
import { createWorkspaceSession } from "../session.ts";
import { SEED_AGENTS } from "../seed.ts";
import { INTERRUPTED, type RuntimeOptions } from "./runtime.ts";
import { answer, call, createFixture, output, textParts, toolCall, versionOf } from "./testing.ts";

const fixtures: { services: Services; dir: string }[] = [];
afterEach(async () => {
  for (const { services, dir } of fixtures.splice(0)) {
    await services.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});
const fixture = (options: RuntimeOptions = {}) => createFixture(fixtures, options);
/** Results the model saw from its tool calls, as one string. */
const toolResults = (model: MockLanguageModelV4) => JSON.stringify(model.doStreamCalls.at(-1)?.prompt);

describe("concurrent human edits", () => {
  it("rewrite_page refuses when a person typed after the agent read, and keeps their text", async () => {
    let f!: ReturnType<typeof fixture>;
    let step = 0;
    let readVersion = "";
    const model = new MockLanguageModelV4({ doStream: async () => {
      step++;
      if (step === 1) return call("read_page", { pageId: f.page.id });
      if (step === 2) {
        readVersion = await versionOf(f.services, f.ws, f.page.id);
        // The person types while the model is thinking.
        await f.services.collab.transact(f.page.id, f.ws, (doc) => appendJSONToYDoc(doc, markdownToTiptapJSON("HUMAN TYPED THIS")), f.session.person);
        return call("rewrite_page", { pageId: f.page.id, version: readVersion, markdown: "Original billing notes, polished." });
      }
      return answer("Couldn't write.");
    } });
    f = fixture({ modelFactory: () => model });
    const result = await f.start().done;
    expect(await f.services.collab.readPageMarkdown(f.page.id, f.ws)).toContain("HUMAN TYPED THIS");
    expect(result.run.steps.map((s) => s.ok)).toEqual([true, false]);
    expect(toolResults(model)).toContain("The page changed since you read it. Read it again, then retry.");
  });

  it("read_page hands out the version and every write returns a page link and the next version", async () => {
    let f!: ReturnType<typeof fixture>;
    let step = 0;
    const model = new MockLanguageModelV4({ doStream: async () => {
      step++;
      const v = step > 1 ? await versionOf(f.services, f.ws, f.page.id) : "";
      if (step === 1) return call("read_page", { pageId: f.page.id });
      if (step === 2) return call("edit_page", { pageId: f.page.id, version: v, find: "Original", replace: "Edited" });
      if (step === 3) return call("append_to_page", { pageId: f.page.id, markdown: "More." });
      if (step === 4) return call("rewrite_page", { pageId: f.page.id, version: v, markdown: "Fresh." });
      return answer("Done.");
    } });
    f = fixture({ modelFactory: () => model });
    await f.start().done;
    const prompt = JSON.stringify(model.doStreamCalls.at(-1)?.prompt);
    expect(prompt).toContain(`version`);
    const link = `[Billing](/p/${f.page.id})`;
    for (const verb of ["Edited", "Added to", "Rewrote"]) expect(prompt).toContain(`${verb} ${link} (version: `);
    expect(await f.services.collab.readPageMarkdown(f.page.id, f.ws)).toBe("Fresh.\n");
  });

  it("edit_page leaves a table with multi-paragraph cells untouched when editing elsewhere", async () => {
    let f!: ReturnType<typeof fixture>;
    const p = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
    const table: JSONContent = { type: "table", content: [
      { type: "tableRow", content: [{ type: "tableHeader", content: [p("Plan")] }] },
      { type: "tableRow", content: [{ type: "tableCell", content: [p("Pro"), p("billed yearly")] }] },
    ] };
    let step = 0;
    const model = new MockLanguageModelV4({ doStream: async () => ++step === 1
      ? call("edit_page", { pageId: f.page.id, version: await versionOf(f.services, f.ws, f.page.id), find: "Original billing notes.", replace: "Updated notes." })
      : answer("Done.") });
    f = fixture({ modelFactory: () => model });
    await f.services.collab.editPage(f.page.id, f.ws, () => ({ type: "doc", content: [p("Original billing notes."), table] }));
    await f.start().done;
    const json = (await f.services.collab.getPageJSON(f.page.id, f.ws))!;
    expect(json.content![0]).toEqual(p("Updated notes."));
    expect(JSON.stringify(json.content![1])).toContain("billed yearly");
    expect(json.content![1]!.content![1]!.content![0]!.content).toHaveLength(2);
  });
});

describe("restarts", () => {
  it("fails runs a crash left running, finishes their empty replies, and lets the janitor clean up", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inkwell-restart-"));
    let s = createServices(dir);
    const ctx = createWorkspaceSession(s);
    const agent = listAgents(s.db, ctx.workspaceId)[0]!;
    const thread = insertDiaryThread(s.db, ctx.workspaceId, "hi");
    const run = insertRun(s.db, ctx.workspaceId, { agentId: agent.id, prompt: "x", status: "running", threadId: thread.id });
    const entry = insertDiaryEntry(s.db, ctx.workspaceId, { threadId: thread.id, role: "agent", agentId: agent.id, text: "", runId: run.id });
    s.handle.close(); // a crash: no orderly runtime shutdown
    s = createServices(dir);
    fixtures.push({ services: s, dir });
    expect(getRun(s.db, ctx.workspaceId, run.id)).toMatchObject({ status: "failed", error: INTERRUPTED, endedAt: expect.any(String) });
    expect(getDiaryEntry(s.db, ctx.workspaceId, entry.id)?.text).toBe(INTERRUPTED);
    // An idle workspace is no longer pinned by a run that can never end.
    s.db.prepare("UPDATE workspaces SET created_at = '2000-01-01T00:00:00.000Z'").run();
    s.db.prepare("UPDATE sessions SET created_at = '2000-01-01T00:00:00.000Z', last_seen_at = NULL").run();
    expect(await cleanIdleWorkspaces(s, { maxIdleDays: 90 })).toBe(1);
  });

  it("cancel ends a run that isn't live in this process", async () => {
    const f = fixture();
    const thread = insertDiaryThread(f.services.db, f.ws, "hi");
    const run = insertRun(f.services.db, f.ws, { agentId: f.agent.id, prompt: "x", status: "running", threadId: thread.id });
    const entry = insertDiaryEntry(f.services.db, f.ws, { threadId: thread.id, role: "agent", agentId: f.agent.id, text: "", runId: run.id });
    const cancelled = await f.services.runtime.cancel(f.ws, run.id);
    expect(cancelled).toMatchObject({ status: "cancelled", endedAt: expect.any(String) });
    expect(getDiaryEntry(f.services.db, f.ws, entry.id)?.text).toBe("Run cancelled.");
    expect(f.events.some((e) => e.type === "run.updated" && e.run.status === "cancelled")).toBe(true);
  });
});

describe("diary replies", () => {
  it("separates text from separate model steps with a blank line", async () => {
    let step = 0;
    const f = fixture({ modelFactory: () => new MockLanguageModelV4({ doStream: async () => ++step === 1
      ? output([...textParts("I'll read the Billing page first."), toolCall("list_pages", {})], "tool-calls")
      : answer("Done, it looks fine.") }) });
    const started = f.start();
    await started.done;
    const text = "I'll read the Billing page first.\n\nDone, it looks fine.";
    expect(getDiaryEntry(f.services.db, f.ws, started.entry!.id)?.text).toBe(text);
    // Clients that only append deltas end up with the same text.
    expect(f.events.flatMap((e) => (e.type === "diary.delta" ? [e.text] : [])).join("")).toBe(text);
  });

  it("tells the model the open page, today's date, the reply format and long-page strategy", async () => {
    const model = new MockLanguageModelV4({ doStream: async () => answer("Hi") });
    const f = fixture({ modelFactory: () => model });
    await f.start().done;
    const system = JSON.stringify(model.doStreamCalls[0]?.prompt[0]);
    expect(system).toContain(`[Billing](/p/${f.page.id}) open (id: ${f.page.id})`);
    expect(system).toContain(`Today is ${new Date().toISOString().slice(0, 10)}`);
    expect(system).toContain("Don't write any text before or between tool calls");
    expect(system).toContain("outline first, then add each section with append_to_page");
  });

  it("includes the pages each earlier reply touched, so 'rename that page' resolves", async () => {
    const model = new MockLanguageModelV4({ doStream: async () => answer("Renamed.") });
    const f = fixture({ modelFactory: () => model });
    const thread = insertDiaryThread(f.services.db, f.ws, "make a page");
    insertDiaryEntry(f.services.db, f.ws, { threadId: thread.id, role: "person", text: "Make a billing page" });
    insertDiaryEntry(f.services.db, f.ws, { threadId: thread.id, role: "agent", agentId: f.agent.id, text: "Made it.", pageIds: [f.page.id] });
    insertDiaryEntry(f.services.db, f.ws, { threadId: thread.id, role: "person", text: "Rename that page" });
    await f.services.runtime.start({ workspaceId: f.ws, agentId: f.agent.id, threadId: thread.id, prompt: "Rename that page" }).done;
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain(`Pages touched in this reply: [Billing](/p/${f.page.id}) (id: ${f.page.id})`);
  });

  it("tells a retry what an interrupted reply had already done, so it continues instead of redoing it", async () => {
    const model = new MockLanguageModelV4({ doStream: async () => answer("Picked up where I left off.") });
    const f = fixture({ modelFactory: () => model });
    const thread = insertDiaryThread(f.services.db, f.ws, "summarise");
    insertDiaryEntry(f.services.db, f.ws, { threadId: thread.id, role: "person", text: "Summarise billing" });
    const failed = insertRun(f.services.db, f.ws, { agentId: f.agent.id, prompt: "Summarise billing", status: "failed", threadId: thread.id });
    insertDiaryEntry(f.services.db, f.ws, { threadId: thread.id, role: "agent", agentId: f.agent.id, text: "Muse Spark couldn't finish this one.", pageIds: [f.page.id], runId: failed.id });
    insertDiaryEntry(f.services.db, f.ws, { threadId: thread.id, role: "person", text: "Summarise billing" });
    await f.services.runtime.start({ workspaceId: f.ws, agentId: f.agent.id, threadId: thread.id, prompt: "Summarise billing" }).done;
    const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(prompt).toContain(`This reply was interrupted before it finished. It had already made or changed: [Billing](/p/${f.page.id})`);
    expect(prompt).toContain("update those pages instead of creating them again");
  });

  it("list_pages includes excerpts; search falls back to any word; a bad edit shows the nearest text", async () => {
    let f!: ReturnType<typeof fixture>;
    let step = 0;
    const model = new MockLanguageModelV4({ doStream: async () => {
      step++;
      if (step === 1) return call("list_pages", {});
      if (step === 2) return call("search_pages", { query: "billing zeppelin" });
      if (step === 3) return call("edit_page", { pageId: f.page.id, version: await versionOf(f.services, f.ws, f.page.id), find: "Original billing nots", replace: "x" });
      if (step === 4) return call("read_page", { pageId: "missing" });
      return answer("Done.");
    } });
    f = fixture({ modelFactory: () => model });
    await f.start().done;
    const results = toolResults(model);
    expect(results).toContain("excerpt");
    expect(results).toContain(`\\"title\\":\\"Billing\\"`);
    expect(results).toContain("Nearest text on the page");
    expect(results).toContain("Page not found. Get the id from search_pages or list_pages.");
    expect(f.services.pages.searchPages(f.ws, "billing zeppelin").map((r) => r.page.id)).toContain(f.page.id);
  });

  it("Atlas organises directly, without stalling to propose or promising excerpt fixes", () => {
    const atlas = SEED_AGENTS.find((a) => a.name === "Atlas")!.instructions;
    expect(atlas).not.toMatch(/propose|excerpt/i);
  });
});

describe("run limits and handoffs", () => {
  it("caps output tokens across steps and reports the budget, not success", async () => {
    const model = new MockLanguageModelV4({ doStream: async () => output([toolCall("list_pages", {})], "tool-calls", 400) });
    const f = fixture({ maxOutputTokens: 1000, modelFactory: () => model });
    const result = await f.start().done;
    expect(model.doStreamCalls.map((c) => c.maxOutputTokens)).toEqual([1000, 600, 256]);
    expect(result.run.status).toBe("failed");
    expect(result.text).toContain("writing budget");
  });

  it("defaults to an 8-minute, 16k-token request budget with 4k-token steps", async () => {
    const model = new MockLanguageModelV4({ doStream: async () => answer("Hi") });
    const f = fixture({ modelFactory: () => model });
    const timer = vi.spyOn(globalThis, "setTimeout");
    await f.start().done;
    expect(model.doStreamCalls[0]?.maxOutputTokens).toBe(4096);
    expect(timer.mock.calls.some(([, ms]) => typeof ms === "number" && ms > 470_000 && ms <= 480_000)).toBe(true);
  });

  it("gives a child a fair share of time, so the parent can still answer after it times out", async () => {
    let rootStep = 0;
    const root = new MockLanguageModelV4({ doStream: async () => ++rootStep === 1
      ? call("ask_agent", { agentName: "Wren", request: "Write" }) : answer("Wren ran out of time; here is what I have.") });
    const child = new MockLanguageModelV4({ doStream: () => new Promise(() => {}) });
    const f = fixture({ timeoutMs: 400, modelFactory: (a) => (a.name === "Scout" ? root : child) });
    const started = f.start();
    const result = await started.done;
    expect(result.run.status).toBe("succeeded");
    const kid = listRecentRuns(f.services.db, f.ws).find((r) => r.parentRunId === started.run.id)!;
    expect(kid).toMatchObject({ status: "failed", error: expect.stringContaining("ran out of time") });
  });

  it("ask_agent after deleting the current page hands the child no deleted page", async () => {
    let f!: ReturnType<typeof fixture>;
    let victim = "";
    let step = 0;
    const root = new MockLanguageModelV4({ doStream: async () => {
      step++;
      if (step === 1) return call("read_page", { pageId: victim });
      if (step === 2) return call("delete_page", { pageId: victim });
      if (step === 3) return call("ask_agent", { agentName: "Wren", request: "Write a summary page" });
      return answer("ok");
    } });
    f = fixture({ modelFactory: (a) => (a.name === "Scout" ? root : new MockLanguageModelV4({ doStream: async () => answer("Summary written.") })) });
    victim = f.services.pages.createPage(f.ws, f.session.person, { title: "Old", markdown: "x", parentId: f.page.id }).id;
    const started = f.start("delete old and ask wren", undefined);
    const result = await started.done;
    expect(result.run.steps.map((s) => s.ok)).toEqual([true, true, true]);
    expect(getRun(f.services.db, f.ws, started.run.id)?.pageId).toBe(f.page.id); // back on the parent, not the deleted page
    const kid = listRecentRuns(f.services.db, f.ws).find((r) => r.parentRunId === started.run.id)!;
    expect(kid.pageId).not.toBe(victim);
    expect(f.events.some((e) => e.type === "agent.moved" && e.toPageId === victim && e.action === "writing")).toBe(false);
  });

  it("runs parallel ask_agent calls at the same time", async () => {
    let started = 0;
    let release!: () => void;
    const both = new Promise<void>((resolve) => { release = resolve; });
    let rootStep = 0;
    const root = new MockLanguageModelV4({ doStream: async () => ++rootStep === 1
      ? output([toolCall("ask_agent", { agentName: "Wren", request: "A" }, "a"), toolCall("ask_agent", { agentName: "Atlas", request: "B" }, "b")], "tool-calls")
      : answer("Both done.") });
    const helper = () => new MockLanguageModelV4({ doStream: async () => {
      if (++started === 2) release();
      // Serialized calls would never get the second child started: fail fast instead of hanging.
      await Promise.race([both, new Promise((_, reject) => setTimeout(() => reject(new Error("serialized")), 1000))]);
      return answer("ok");
    } });
    const f = fixture({ modelFactory: (a) => (a.name === "Scout" ? root : helper()) });
    const result = await f.start().done;
    expect(result.run.status).toBe("succeeded");
    expect(result.run.steps.filter((s) => s.tool === "ask_agent" && s.ok)).toHaveLength(2);
  });
});

describe("page links", () => {
  it("publishes a page's outgoing links when they change, and not otherwise", () => {
    const f = fixture();
    const other = f.services.pages.createPage(f.ws, f.session.person, { title: "Other" });
    const links = () => f.events.filter((e) => e.type === "page.links");
    f.services.pages.setPageMarkdown(f.ws, f.session.person, f.page.id, `See [Other](/p/${other.id}).`);
    expect(links().at(-1)).toEqual({ type: "page.links", pageId: f.page.id, links: [{ from: f.page.id, to: other.id }] });
    const count = links().length;
    f.services.pages.setPageMarkdown(f.ws, f.session.person, f.page.id, `See [Other](/p/${other.id}) again.`);
    expect(links()).toHaveLength(count);
    f.services.pages.setPageMarkdown(f.ws, f.session.person, f.page.id, "No links now.");
    expect(links().at(-1)).toEqual({ type: "page.links", pageId: f.page.id, links: [] });
  });
});

describe("diary route", () => {
  it("saves nothing and answers in plain English when the agent can't start", async () => {
    const f = fixture();
    const app = createApp(f.services);
    const cookie = `inkwell_sid=${f.session.sessionId}`;
    const threads = listDiaryThreads(f.services.db, f.ws).length;
    await f.services.runtime.close();
    const res = await app.request("/api/diary", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ text: "Hello" }) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Inkwell is restarting. Try again in a moment.", code: "restarting" });
    expect(listDiaryThreads(f.services.db, f.ws)).toHaveLength(threads);
    expect(f.events.some((e) => e.type === "diary.entry" && e.entry.text === "Hello")).toBe(false);
    const thread = listDiaryThreads(f.services.db, f.ws)[0]!;
    const before = listDiaryEntries(f.services.db, f.ws, thread.id).length;
    const again = await app.request("/api/diary", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ text: "Hello", threadId: thread.id }) });
    expect(again.status).toBe(503);
    expect(listDiaryEntries(f.services.db, f.ws, thread.id)).toHaveLength(before);
  });
});
