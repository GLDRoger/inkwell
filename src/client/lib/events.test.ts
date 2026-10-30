import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { Actor, DiaryEntry, MapGraph, Page, Run } from "@shared/types";
import { applyDelta, applyServerEvent, emit, mergeThread, subscribe } from "./events";
import { keys } from "./queries";

const actor: Actor = { kind: "person", id: "u1", name: "Ada" };
const page = (id: string, extra: Partial<Page> = {}): Page => ({
  id, parentId: null, title: id, icon: null, position: "a0", excerpt: "", x: null, y: null, coverUrl: null,
  createdAt: "2026-10-29T10:00:00Z", updatedAt: "2026-10-29T10:00:00Z", updatedBy: actor, ...extra,
});
const run = (id: string, extra: Partial<Run> = {}): Run => ({
  id, agentId: "a1", threadId: "t1", parentRunId: null, prompt: "do it", status: "running", pageId: null, error: null,
  steps: [], createdAt: "2026-10-29T10:00:00Z", endedAt: null, ...extra,
});
const entry = (id: string, extra: Partial<DiaryEntry> = {}): DiaryEntry => ({
  id, threadId: "t1", role: "agent", agentId: "a1", text: "", pageIds: [], attachments: [], runId: "r1",
  createdAt: "2026-10-29T10:00:01Z", ...extra,
});

function seeded() {
  const client = new QueryClient();
  const graph: MapGraph = { pages: [page("p1"), page("p2")], links: [{ from: "p1", to: "p2" }], agents: [], runs: [run("r0")] };
  client.setQueryData(keys.map, graph);
  client.setQueryData(keys.pages, [page("p1"), page("p2")]);
  client.setQueryData(keys.page("p1"), { ...page("p1"), markdown: "# Hi" });
  return client;
}

describe("applyServerEvent", () => {
  it("adds created pages to the list and the map", () => {
    const c = seeded();
    applyServerEvent(c, { type: "page.created", page: page("p3") });
    expect(c.getQueryData<Page[]>(keys.pages)!.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(c.getQueryData<MapGraph>(keys.map)!.pages).toHaveLength(3);
  });

  it("updates a page everywhere and keeps the body", () => {
    const c = seeded();
    applyServerEvent(c, { type: "page.updated", page: page("p1", { title: "Billing" }) });
    expect(c.getQueryData<Page[]>(keys.pages)![0].title).toBe("Billing");
    expect(c.getQueryData<MapGraph>(keys.map)!.pages[0].title).toBe("Billing");
    expect(c.getQueryData<{ title: string; markdown: string }>(keys.page("p1"))).toMatchObject({ title: "Billing", markdown: "# Hi" });
  });

  it("removes deleted pages and their links", () => {
    const c = seeded();
    applyServerEvent(c, { type: "page.deleted", pageId: "p2" });
    expect(c.getQueryData<Page[]>(keys.pages)!.map((p) => p.id)).toEqual(["p1"]);
    expect(c.getQueryData<MapGraph>(keys.map)!.links).toEqual([]);
  });

  it("upserts runs newest first and mirrors them into the run key", () => {
    const c = seeded();
    applyServerEvent(c, { type: "run.updated", run: run("r1") });
    expect(c.getQueryData<MapGraph>(keys.map)!.runs.map((r) => r.id)).toEqual(["r1", "r0"]);
    expect(c.getQueryData<Run>(keys.run("r1"))!.status).toBe("running");
    applyServerEvent(c, { type: "run.updated", run: run("r1", { status: "succeeded" }) });
    expect(c.getQueryData<MapGraph>(keys.map)!.runs).toHaveLength(2);
    expect(c.getQueryData<Run>(keys.run("r1"))!.status).toBe("succeeded");
  });

  it("moves a run's page when its agent walks", () => {
    const c = seeded();
    applyServerEvent(c, { type: "agent.moved", runId: "r0", agentId: "a1", fromPageId: null, toPageId: "p2", action: "writing" });
    expect(c.getQueryData<MapGraph>(keys.map)!.runs[0].pageId).toBe("p2");
  });

  it("keeps a run's page when its agent does something notebook-wide (toPageId null)", () => {
    const c = seeded();
    applyServerEvent(c, { type: "agent.moved", runId: "r0", agentId: "a1", fromPageId: null, toPageId: "p2", action: "reading" });
    applyServerEvent(c, { type: "agent.moved", runId: "r0", agentId: "a1", fromPageId: "p2", toPageId: null, action: "thinking" });
    applyServerEvent(c, { type: "agent.moved", runId: "r0", agentId: "a1", fromPageId: "p2", toPageId: null, action: "leaving" });
    expect(c.getQueryData<MapGraph>(keys.map)!.runs[0].pageId).toBe("p2");
  });

  it("replaces a page's outgoing links when they change, leaving other pages' links alone", () => {
    const c = seeded();
    c.setQueryData<MapGraph>(keys.map, (old) => ({ ...old!, pages: [...old!.pages, page("p3")], links: [...old!.links, { from: "p2", to: "p1" }] }));
    applyServerEvent(c, { type: "page.links", pageId: "p1", links: [{ from: "p1", to: "p3" }] });
    expect(c.getQueryData<MapGraph>(keys.map)!.links).toEqual([{ from: "p2", to: "p1" }, { from: "p1", to: "p3" }]);
    applyServerEvent(c, { type: "page.links", pageId: "p1", links: [] });
    expect(c.getQueryData<MapGraph>(keys.map)!.links).toEqual([{ from: "p2", to: "p1" }]);
  });

  it("streams diary deltas into the entry, even before the entry event arrives", () => {
    const c = seeded();
    applyServerEvent(c, { type: "diary.delta", entryId: "e1", threadId: "t1", text: "Hello" });
    applyServerEvent(c, { type: "diary.delta", entryId: "e1", threadId: "t1", text: ", Ada" });
    expect(c.getQueryData<DiaryEntry[]>(keys.thread("t1"))![0].text).toBe("Hello, Ada");
    // A late "started" entry with empty text must not wipe what streamed.
    applyServerEvent(c, { type: "diary.entry", entry: entry("e1", { text: "" }) });
    const list = c.getQueryData<DiaryEntry[]>(keys.thread("t1"))!;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ text: "Hello, Ada", runId: "r1", agentId: "a1" });
  });

  it("keeps diary entries in time order and takes the final text", () => {
    const c = seeded();
    c.setQueryData(keys.thread("t1"), [entry("e0", { role: "person", text: "Hi", createdAt: "2026-10-29T10:00:00Z" })]);
    applyServerEvent(c, { type: "diary.entry", entry: entry("e1", { text: "Hello there." }) });
    applyServerEvent(c, { type: "diary.entry", entry: entry("e1", { text: "Hello there. Done." }) });
    const list = c.getQueryData<DiaryEntry[]>(keys.thread("t1"))!;
    expect(list.map((e) => e.id)).toEqual(["e0", "e1"]);
    expect(list[1].text).toBe("Hello there. Done.");
  });
});

describe("applyDelta", () => {
  it("appends chunks", () => expect(applyDelta("Hel", "lo")).toBe("Hello"));
  it("accepts a server that sends the whole text so far", () => expect(applyDelta("Hello", "Hello, Ada")).toBe("Hello, Ada"));
  it("starts from empty", () => expect(applyDelta("", "Hi")).toBe("Hi"));
});

describe("the bus", () => {
  it("delivers events to subscribers until they unsubscribe", () => {
    const fn = vi.fn();
    const off = subscribe(fn);
    emit({ type: "page.deleted", pageId: "x" });
    off();
    emit({ type: "page.deleted", pageId: "y" });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toEqual({ type: "page.deleted", pageId: "x" });
  });
});

describe("mergeThread", () => {
  it("keeps streamed text a refetch hasn't caught up with, and entries only we know", () => {
    const cached = [entry("e0", { role: "person", text: "Hi", createdAt: "2026-10-29T10:00:00Z" }), entry("e1", { text: "Hello, Ada. I read" }), entry("e2", { text: "x", createdAt: "2026-10-29T10:00:05Z" })];
    const fresh = [entry("e0", { role: "person", text: "Hi", createdAt: "2026-10-29T10:00:00Z" }), entry("e1", { text: "" })];
    expect(mergeThread(cached, fresh).map((e) => [e.id, e.text])).toEqual([["e0", "Hi"], ["e1", "Hello, Ada. I read"], ["e2", "x"]]);
  });
  it("takes the server's list when nothing is cached", () => {
    const fresh = [entry("e1", { text: "Done." })];
    expect(mergeThread(undefined, fresh)).toBe(fresh);
  });
});
