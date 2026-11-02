// @vitest-environment node
import fs from "node:fs";
import { afterEach, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { createFixture, call, answer } from "./testing.ts";
import type { Services } from "../services.ts";
import { createAgentTools } from "./tools.ts";
import { getLens, listWidgets } from "../widgets.ts";
import { getRun, insertRun, listDiaryEntries } from "../db.ts";
import { createApp } from "../main.ts";
import { createWorkspaceSession } from "../session.ts";

const fixtures: { services: Services; dir: string }[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) { await f.services.close(); fs.rmSync(f.dir, { recursive: true, force: true }); } });
function fixture() {
  const f = createFixture(fixtures);
  const run = insertRun(f.services.db, f.ws, { agentId: f.agent.id, prompt: "Test" });
  const { tools } = createAgentTools({ services: f.services, workspaceId: f.ws, run, agent: f.agent,
    presenceId: run.id, signal: new AbortController().signal, touched: new Set(), budget: { remaining: 100 },
    withPageLock: async (_id, fn) => fn(), askAgent: async () => "Done" });
  // Exercise the helper's execution boundary; schema validation is done by AI SDK.
  const invoke = (name: keyof typeof tools, input: object) => (tools[name].execute as (input: object, options: object) => Promise<string>)(input, {});
  return { ...f, run, invoke };
}
it("validates lens page ids and duplicate membership without replacing valid state", async () => {
  const f = fixture();
  expect(await f.invoke("show_lens", { title: "State", kind: "columns", groups: [{ label: "Doing", pageIds: [f.page.id] }] })).toContain("Showed");
  const lens = getLens(f.services.db, f.ws);
  expect(await f.invoke("show_lens", { title: "Bad", kind: "columns", groups: [{ label: "A", pageIds: [f.page.id] }, { label: "B", pageIds: [f.page.id] }] })).toContain("only one");
  expect(await f.invoke("show_lens", { title: "Bad", kind: "timeline", groups: [{ label: "A", pageIds: ["unknown"] }] })).toContain("list_pages");
  expect(getLens(f.services.db, f.ws)).toEqual(lens);
  expect(getRun(f.services.db, f.ws, f.run.id)?.steps.map(s => s.ok)).toEqual([true, false, false]);
});
it("validates per-kind widget inputs, replaces in place, lists and removes widgets", async () => {
  const f = fixture();
  for (const kind of ["progress", "total", "countdown", "facts"]) {
    expect(await f.invoke("create_widget", { kind, title: "Bad", pageIds: [], currency: "€" })).toContain("Error:");
  }
  expect(await f.invoke("create_widget", { kind: "countdown", title: "Bad", pageIds: [], date: "tomorrowish", currency: "€" })).toContain("parseable date");
  expect(await f.invoke("create_widget", { kind: "progress", title: "Bad", pageIds: ["unknown"], currency: "€" })).toContain("list_pages");
  f.services.pages.setPageMarkdown(f.ws, f.session.person, f.page.id, "- [x] Done\n- [ ] Open");
  const input = { kind: "progress", title: "Launch", pageIds: [f.page.id], currency: "€" };
  expect(await f.invoke("create_widget", input)).toContain("1 of 2 tasks done");
  const first = listWidgets(f.services.db, f.ws)[0]!;
  f.services.db.prepare("UPDATE widgets SET x=123, y=456 WHERE id=?").run(first.id);
  await f.invoke("create_widget", input);
  expect(listWidgets(f.services.db, f.ws)).toHaveLength(1);
  expect(listWidgets(f.services.db, f.ws)[0]).toMatchObject({ id: first.id, x: 123, y: 456 });
  expect(await f.invoke("list_pages", {})).toContain(`"kind":"progress","title":"Launch"`);
  expect(await f.invoke("remove_widget", { widgetId: first.id })).toContain("Removed");
  expect(await f.invoke("remove_widget", { widgetId: first.id })).toContain("not found");
});
it("patches/deletes widgets only in their notebook and demo clear is a silent no-op", async () => {
  const f = fixture();
  await f.invoke("create_widget", { kind: "facts", title: "Facts", pageIds: [], currency: "€", items: [{ label: "Status", value: "Ready" }] });
  const widget = listWidgets(f.services.db, f.ws)[0]!;
  const app = createApp(f.services);
  const req = (url: string, method: string, body?: object, demo = false, sid = f.session.sessionId) => app.request(url, { method,
    headers: { cookie: `inkwell_sid=${sid}`, ...(demo ? { "X-Inkwell-Notebook": "demo" } : {}), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const stranger = createWorkspaceSession(f.services);
  expect((await req(`/api/widgets/${widget.id}`, "PATCH", { x: 5 }, false, stranger.sessionId)).status).toBe(404);
  expect((await req(`/api/widgets/${widget.id}`, "PATCH", { x: 5 }, true)).status).toBe(403);
  expect((await req(`/api/widgets/${widget.id}`, "PATCH", { x: 5, title: "Moved" })).status).toBe(200);
  const before = f.events.length;
  expect((await req("/api/lens", "DELETE", undefined, true)).status).toBe(204);
  expect(f.events.length).toBe(before);
  expect((await req(`/api/widgets/${widget.id}`, "DELETE")).status).toBe(204);
  expect(listWidgets(f.services.db, f.ws)).toEqual([]);
});
it("accepts max-50 scope, drops unknown ids, stores scope and limits the root prompt only", async () => {
  const prompts: string[] = [];
  let step = 0;
  const f = createFixture(fixtures, { modelFactory: agent => new MockLanguageModelV4({ doStream: async o => {
    prompts.push(JSON.stringify(o.prompt));
    if (agent.name === "Scout" && step++ === 0) return call("ask_agent", { agentName: "Wren", request: "Say hello" });
    return answer("Done");
  } }) });
  const app = createApp(f.services);
  const headers = { cookie: `inkwell_sid=${f.session.sessionId}`, "Content-Type": "application/json" };
  const response = await app.request("/api/diary", { method: "POST", headers, body: JSON.stringify({ text: "Read circled pages", agentId: f.agent.id, scopePageIds: ["unknown", f.page.id, f.page.id] }) });
  expect(response.status).toBe(201);
  const result = await response.json() as { entry: { pageIds: string[] }; runId: string; threadId: string };
  expect(result.entry.pageIds).toEqual([f.page.id]);
  await expect.poll(() => getRun(f.services.db, f.ws, result.runId)?.status).toBe("succeeded");
  expect(prompts[0]).toContain(`work on exactly these: [Billing](/p/${f.page.id})`);
  expect(prompts.find(p => p.includes("asked you for help on the person's behalf"))).not.toContain("The person circled");
  expect(listDiaryEntries(f.services.db, f.ws, result.threadId)[0]?.pageIds).toEqual([f.page.id]);
  const tooMany = await app.request("/api/diary", { method: "POST", headers, body: JSON.stringify({ text: "Read", scopePageIds: Array(51).fill(f.page.id) }) });
  expect(tooMany.status).toBe(400);
});
