// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { DiaryEntry, Run, ServerEvent } from "../../shared/types.ts";
import { createServices, type Services } from "../services.ts";
import { createWorkspaceSession } from "../session.ts";
import { createApp } from "../main.ts";
import {
  getDiaryEntry, getRun, insertAttachmentRow, insertDiaryEntry, insertDiaryThread,
  listAgents, listDiaryEntries, listRecentRuns,
} from "../db.ts";
import type { RuntimeOptions } from "./runtime.ts";
import * as helpers from "./testing.ts";

const fixtures: { services: Services; dir: string }[] = [];
afterEach(async () => {
  for (const { services, dir } of fixtures.splice(0)) {
    await services.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const answer = helpers.answer;
const call = helpers.call;
const output = helpers.output;
const versionOf = helpers.versionOf;
const fixture = (options: RuntimeOptions = {}) => helpers.createFixture(fixtures, options);

describe("agent runtime", () => {
  it("reads, writes live Yjs, streams repeated deltas, persists the reply and footprints", async () => {
    let pageId = "";
    let step = 0;
    let f: ReturnType<typeof fixture>;
    const model = new MockLanguageModelV4({ doStream: async () => {
      step++;
      if (step === 1) return call("read_page", { pageId });
      if (step === 2) return call("rewrite_page", { pageId, version: await versionOf(f.services, f.ws, pageId), markdown: "Revised billing notes.\n\nA second paragraph." });
      return output([{ type: "text-start", id: "reply" },
        { type: "text-delta", id: "reply", delta: "Done. " },
        { type: "text-delta", id: "reply", delta: "Done. " }, { type: "text-end", id: "reply" }]);
    } });
    f = fixture({ modelFactory: () => model });
    pageId = f.page.id;
    const live = await f.services.collab.openDirect(pageId, f.ws);
    const show = vi.spyOn(f.services.collab, "showAgent");
    const hide = vi.spyOn(f.services.collab, "hideAgentEverywhere");
    const started = f.start();
    const result = await started.done;
    expect(result.run.status).toBe("succeeded");
    expect(getRun(f.services.db, f.ws, result.run.id)?.pageId).toBe(pageId);
    expect(result.run.steps.map((s) => s.tool)).toEqual(["read_page", "rewrite_page"]);
    expect(result.run.steps.every((s) => s.ok)).toBe(true);
    expect(result.run.endedAt).toBeTruthy();
    expect(await f.services.collab.readPageMarkdown(pageId, f.ws)).toContain("Revised billing notes.");
    expect(f.services.pages.getPageWithBody(f.ws, pageId)?.markdown).toContain("Revised billing notes.");
    expect(getDiaryEntry(f.services.db, f.ws, started.entry!.id)).toMatchObject({ text: "Done. Done. ", pageIds: [pageId] });
    expect(f.events.filter((e) => e.type === "diary.delta")).toHaveLength(2);
    expect(f.events.filter((e) => e.type === "diary.entry").at(-1)).toMatchObject({ entry: { text: "Done. Done. " } });
    expect(f.events.filter((e) => e.type === "agent.moved").map((e) => e.action)).toEqual(["reading", "writing", "leaving"]);
    expect(f.events.filter((e) => e.type === "run.updated").map((e) => e.run.status)).toContain("running");
    expect(show).toHaveBeenCalled();
    expect(hide).toHaveBeenCalledWith(`${f.agent.id}:${started.run.id}`);
    expect(model.doStreamCalls[0]?.toolChoice).toEqual({ type: "auto" });
    await live.disconnect();
  });

  it("keeps its last visited page after notebook-wide thinking and on the next no-page run", async () => {
    let pageId = "";
    let step = 0;
    const f = fixture({ modelFactory: () => new MockLanguageModelV4({ doStream: async () => {
      if (++step === 1) return call("read_page", { pageId });
      if (step === 2) return call("list_pages", {});
      return answer("Ready.");
    } }) });
    // Visit a different page from the one the run started at.
    pageId = f.services.pages.createPage(f.ws, { kind: "agent", id: f.agent.id, name: f.agent.name }, { title: "Last stop" }).id;
    const first = await f.start().done;
    expect(first.run.pageId).toBe(pageId);
    expect(f.events.filter((e) => e.type === "agent.moved").at(-1)).toMatchObject({
      fromPageId: pageId, toPageId: null, action: "leaving",
    });
    const next = f.services.runtime.start({ workspaceId: f.ws, agentId: f.agent.id, prompt: "Hello" });
    expect(next.run.pageId).toBe(pageId);
    expect((await next.done).run.pageId).toBe(pageId);
    // The same persisted run is used to rebuild the map after a reload.
    expect(listRecentRuns(f.services.db, f.ws).find((r) => r.agentId === f.agent.id)?.pageId).toBe(pageId);
  });

  it("supports create, search, precise edits, rename, move and soft delete", async () => {
    let f: ReturnType<typeof fixture>;
    let step = 0;
    let createdId = "";
    const model = new MockLanguageModelV4({ doStream: async () => {
      step++;
      if (step === 1) return call("list_pages", {});
      if (step === 2) return call("create_page", { title: "Agent scratch", markdown: "One paragraph.", parentId: f.page.id });
      if (step === 3) {
        createdId = f.services.pages.listPages(f.ws).find((p) => p.title === "Agent scratch")!.id;
        expect(await f.services.collab.readPageMarkdown(createdId, f.ws)).toContain("One paragraph.");
        return call("edit_page", { pageId: createdId, version: await versionOf(f.services, f.ws, createdId), find: "One paragraph.", replace: "Changed paragraph." });
      }
      if (step === 4) return call("append_to_page", { pageId: createdId, markdown: "Appended paragraph." });
      if (step === 5) {
        expect(await f.services.collab.readPageMarkdown(createdId, f.ws)).toContain("Changed paragraph.");
        expect(await f.services.collab.readPageMarkdown(createdId, f.ws)).toContain("Appended paragraph.");
        return call("rename_page", { pageId: createdId, title: "New scratch" });
      }
      if (step === 6) return call("move_page", { pageId: createdId, parentId: null });
      if (step === 7) {
        expect(f.services.pages.getPage(f.ws, createdId)).toMatchObject({ title: "New scratch", parentId: null });
        return call("search_pages", { query: "New scratch" });
      }
      if (step === 8) return call("delete_page", { pageId: createdId });
      return answer("Finished the page lifecycle.");
    } });
    f = fixture({ modelFactory: () => model });
    const result = await f.start().done;
    expect(result.run.status).toBe("succeeded");
    expect(result.run.steps).toHaveLength(8);
    expect(result.run.steps.every((s) => s.ok)).toBe(true);
    expect(result.pageIds).toContain(createdId);
    expect(f.services.pages.getPage(f.ws, createdId)).toBeNull();
    expect(f.services.db.prepare("SELECT deleted_at FROM pages WHERE id = ?").get(createdId)).toMatchObject({ deleted_at: expect.any(String) });
  });

  it("serializes concurrent page writes and gives same-agent runs independent carets", async () => {
    let pageId = "";
    let factories = 0;
    const f = fixture({ modelFactory: () => {
      const n = ++factories;
      let step = 0;
      return new MockLanguageModelV4({ doStream: async () => ++step === 1 ?
        call("append_to_page", { pageId, markdown: `Run ${n} wrote this.` }) : answer(`Done ${n}`) });
    } });
    pageId = f.page.id;
    const show = vi.spyOn(f.services.collab, "showAgent");
    const a = f.start("First write");
    const b = f.start("Second write");
    expect((await Promise.all([a.done, b.done])).map((r) => r.run.status)).toEqual(["succeeded", "succeeded"]);
    const markdown = await f.services.collab.readPageMarkdown(pageId, f.ws);
    expect(markdown).toContain("Original billing notes.");
    expect(markdown).toContain("Run 1 wrote this.");
    expect(markdown).toContain("Run 2 wrote this.");
    expect(new Set(show.mock.calls.map((args) => args[2].id))).toEqual(new Set([`${f.agent.id}:${a.run.id}`, `${f.agent.id}:${b.run.id}`]));
  });

  it("timeout fails a stalled run without leaving it active", async () => {
    const f = fixture({ timeoutMs: 30, modelFactory: () => new MockLanguageModelV4({ doStream: () => new Promise(() => {}) }) });
    const result = await f.start().done;
    expect(result.run).toMatchObject({ status: "failed", error: expect.stringContaining("ran out of time"), pageId: f.page.id });
  });

  it("fails cleanly without META_API_KEY and never calls the network", async () => {
    vi.stubEnv("META_API_KEY", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const f = fixture();
    const started = f.start();
    const result = await started.done;
    expect(result.run.status).toBe("failed");
    expect(result.run.error).toContain("Meta API key isn't configured");
    expect(getDiaryEntry(f.services.db, f.ws, started.entry!.id)?.text).toBe(result.run.error);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("cancels a stalled stream after a write, hides carets and keeps partial text", async () => {
    let pageId = "";
    let step = 0;
    const model = new MockLanguageModelV4({ doStream: async () => {
      if (++step === 1) return call("append_to_page", { pageId, markdown: "Added before cancellation." });
      return { stream: new ReadableStream<LanguageModelV4StreamPart>({ start(c) {
        c.enqueue({ type: "text-start", id: "text" });
        c.enqueue({ type: "text-delta", id: "text", delta: "Working…" });
      } }) };
    } });
    const f = fixture({ modelFactory: () => model });
    pageId = f.services.pages.createPage(f.ws, { kind: "agent", id: f.agent.id, name: f.agent.name }, { title: "Written before cancellation" }).id;
    const hide = vi.spyOn(f.services.collab, "hideAgentEverywhere");
    const started = f.start();
    await vi.waitFor(() => expect(f.events.some((e) => e.type === "diary.delta")).toBe(true));
    const cancelled = await f.services.runtime.cancel(f.ws, started.run.id);
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.pageId).toBe(pageId);
    expect((await started.done).text).toContain("Working…\n\nRun cancelled.");
    expect(hide).toHaveBeenCalledWith(`${f.agent.id}:${started.run.id}`);
    expect(await f.services.runtime.cancel(f.ws, started.run.id)).toEqual(cancelled);
  });

  it("shutdown aborts even a model stalled before returning a stream", async () => {
    const model = new MockLanguageModelV4({ doStream: () => new Promise(() => {}) });
    const f = fixture({ modelFactory: () => model });
    const started = f.start();
    await vi.waitFor(() => expect(model.doStreamCalls).toHaveLength(1));
    await f.services.runtime.close();
    expect((await started.done).run).toMatchObject({ status: "failed", error: "Interrupted by a server restart." });
  });

  it("returns foreign page tool failures as results, without exposing or changing content", async () => {
    let foreignId = "";
    let step = 0;
    const model = new MockLanguageModelV4({ doStream: async () => {
      if (++step === 1) return call("read_page", { pageId: foreignId });
      if (step === 2) return call("rewrite_page", { pageId: foreignId, version: "guess", markdown: "Hacked" });
      return answer("That page was not found.");
    } });
    const f = fixture({ modelFactory: () => model });
    const other = createWorkspaceSession(f.services);
    const page = f.services.pages.createPage(other.workspaceId, other.person, { title: "Private", markdown: "Private secret" });
    foreignId = page.id;
    const result = await f.start().done;
    expect(result.run.steps).toHaveLength(2);
    expect(result.run.steps.every((s) => !s.ok && s.summary.includes("not found"))).toBe(true);
    expect(JSON.stringify(model.doStreamCalls)).not.toContain("Private secret");
    expect(JSON.stringify(model.doStreamCalls)).toContain("Page not found");
    expect(f.services.pages.getPageWithBody(other.workspaceId, foreignId)?.markdown).toBe("Private secret");
    expect(result.pageIds).toEqual([]);
  });

  it("ask_agent creates and waits for a child run with parentRunId", async () => {
    let rootStep = 0;
    const root = new MockLanguageModelV4({ doStream: async () => ++rootStep === 1 ?
      call("ask_agent", { agentName: "Wren", request: "Suggest a heading" }) : answer("Wren suggests Billing Guide.") });
    const child = new MockLanguageModelV4({ doStream: async () => answer("Billing Guide") });
    const f = fixture({ modelFactory: (agent) => agent.name === "Scout" ? root : child });
    const started = f.start();
    expect((await started.done).run.status).toBe("succeeded");
    const children = listRecentRuns(f.services.db, f.ws).filter((r) => r.parentRunId === started.run.id);
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ status: "succeeded", prompt: "Suggest a heading", threadId: null });
    expect(JSON.stringify(root.doStreamCalls[1]?.prompt)).toContain("Wren: Billing Guide");
    expect(listDiaryEntries(f.services.db, f.ws, started.entry!.threadId)).toHaveLength(2);
  });

  it("cancelling a parent cancels its child", async () => {
    const root = new MockLanguageModelV4({ doStream: async () => call("ask_agent", { agentName: "Wren", request: "Write" }) });
    const child = new MockLanguageModelV4({ doStream: () => new Promise(() => {}) });
    const f = fixture({ modelFactory: (a) => a.name === "Scout" ? root : child });
    const started = f.start();
    await vi.waitFor(() => expect(child.doStreamCalls).toHaveLength(1));
    await f.services.runtime.cancel(f.ws, started.run.id);
    expect(listRecentRuns(f.services.db, f.ws).filter((r) => r.id === started.run.id || r.parentRunId === started.run.id).map((r) => r.status)).toEqual(["cancelled", "cancelled"]);
  });

  it("reports step limits as incomplete rather than success", async () => {
    const f = fixture({ maxSteps: 1, modelFactory: () => new MockLanguageModelV4({ doStream: async () => call("list_pages", {}) }) });
    const result = await f.start().done;
    expect(result.run.status).toBe("failed");
    expect(result.text).toContain("step limit");
  });

  it("does not leak upstream errors or API keys into the diary or console", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fixture({ modelFactory: () => new MockLanguageModelV4({ doStream: async () => { throw new Error("Authorization: Bearer TOPSECRET"); } }) });
    const result = await f.start().done;
    expect(result.run.status).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("TOPSECRET");
    expect(log).not.toHaveBeenCalled();
  });

  it("supports long-page continuation and rejects ambiguous edits without losing content", async () => {
    let pageId = "";
    let step = 0;
    const model = new MockLanguageModelV4({ doStream: async () => {
      step++;
      if (step === 1) return call("read_page", { pageId });
      if (step === 2) return call("read_page", { pageId, offset: 16_000 });
      if (step === 3) return call("edit_page", { pageId, version: await versionOf(f.services, f.ws, pageId), find: "repeat", replace: "oops" });
      return answer("Read the entire page.");
    } });
    const f: ReturnType<typeof fixture> = fixture({ modelFactory: () => model });
    pageId = f.page.id;
    const original = `${"x".repeat(17_000)} repeat repeat`;
    await f.services.collab.replaceMarkdown(pageId, f.ws, original);
    const before = await f.services.collab.readPageMarkdown(pageId, f.ws);
    const result = await f.start().done;
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain('nextOffset');
    expect(JSON.stringify(model.doStreamCalls[2]?.prompt)).toContain('repeat repeat');
    expect(result.run.steps[2]).toMatchObject({ ok: false });
    expect(await f.services.collab.readPageMarkdown(pageId, f.ws)).toBe(before);
  });
});

describe("diary HTTP routes", () => {
  it("POST returns the person entry immediately, handles images and serves the completed run", async () => {
    const model = new MockLanguageModelV4({ doStream: async () => answer("I see your image.") });
    const f = fixture({ modelFactory: () => model });
    const app = createApp(f.services);
    const me = await app.request("/api/me");
    const cookie = me.headers.get("set-cookie")!.split(";")[0]!;
    const { workspaceId } = await me.json() as { workspaceId: string };
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    fs.writeFileSync(path.join(f.services.uploadsDir, "image.png"), image);
    const attachment = insertAttachmentRow(f.services.db, workspaceId, { id: "image", kind: "image", name: "image.png", mime: "image/png", size: image.length, path: "image.png" });
    const request = (url: string, body?: object) => app.request(url, { method: body ? "POST" : "GET", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const res = await request("/api/diary", { text: "Read this", attachmentIds: [attachment.id] });
    expect(res.status).toBe(201);
    const result = await res.json() as { entry: DiaryEntry; runId: string; threadId: string };
    expect(result.entry).toMatchObject({ role: "person", text: "Read this", attachments: [attachment] });
    await f.services.runtime.wait(workspaceId, result.runId);
    const run = await (await request(`/api/runs/${result.runId}`)).json() as Run;
    expect(run.status).toBe("succeeded");
    expect(run.agentId).toBe(listAgents(f.services.db, workspaceId)[0]!.id);
    expect(model.doStreamCalls[0]?.prompt.at(-1)?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "file", data: { type: "data", data: image }, mediaType: "image/png" }),
    ]));
    const entries = await (await request(`/api/diary/${result.threadId}`)).json() as DiaryEntry[];
    expect(entries).toHaveLength(2);
    expect(entries[1]?.text).toBe("I see your image.");
    expect((await request("/api/diary")).status).toBe(200);
    const followup = await request("/api/diary", { text: "Thank you", threadId: result.threadId });
    expect((await followup.json() as { threadId: string }).threadId).toBe(result.threadId);
  });

  it("returns from POST before generation finishes and cancels through HTTP", async () => {
    const f = fixture({ modelFactory: () => new MockLanguageModelV4({ doStream: () => new Promise(() => {}) }) });
    const app = createApp(f.services);
    const me = await app.request("/api/me");
    const cookie = me.headers.get("set-cookie")!.split(";")[0]!;
    const headers = { Cookie: cookie, "Content-Type": "application/json" };
    const response = await app.request("/api/diary", { method: "POST", headers, body: JSON.stringify({ text: "Work until cancelled" }) });
    expect(response.status).toBe(201);
    const { runId } = await response.json() as { runId: string };
    const active = await (await app.request(`/api/runs/${runId}`, { headers })).json() as Run;
    expect(["queued", "running"]).toContain(active.status);
    const cancelled = await app.request(`/api/runs/${runId}/cancel`, { method: "POST", headers });
    expect(cancelled.status).toBe(200);
    expect(active.pageId).toEqual(expect.any(String));
    expect(await cancelled.json()).toMatchObject({ status: "cancelled", pageId: active.pageId });
  });

  it("rejects cross-workspace pages, threads, agents, attachments and run cancellation", async () => {
    const f = fixture({ modelFactory: () => new MockLanguageModelV4({ doStream: async () => answer("OK") }) });
    const started = f.start();
    await started.done;
    const app = createApp(f.services);
    const me = await app.request("/api/me");
    const cookie = me.headers.get("set-cookie")!.split(";")[0]!;
    const request = (url: string, body?: object) => app.request(url, { method: body ? "POST" : "GET", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    insertAttachmentRow(f.services.db, f.ws, { id: "foreign-file", kind: "image", name: "secret.png", mime: "image/png", size: 1, path: "unused.png" });
    for (const body of [{ pageId: f.page.id }, { threadId: started.entry!.threadId }, { agentId: f.agent.id }, { attachmentIds: ["foreign-file"] }]) {
      expect((await request("/api/diary", { text: "Try", ...body })).status).toBe(404);
    }
    expect((await request(`/api/runs/${started.run.id}`)).status).toBe(404);
    expect((await request(`/api/runs/${started.run.id}/cancel`, {})).status).toBe(404);
    expect(getRun(f.services.db, f.ws, started.run.id)?.status).toBe("succeeded");
    expect((await request("/api/diary", { text: " " })).status).toBe(400);
  });
});
