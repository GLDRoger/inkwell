import { describe, expect, it } from "vitest";
import type { Agent, MapGraph, Page, Run } from "@shared/types";
import { agentStatuses, applyEvent, fromGraph, writingPages } from "./model";

const T0 = Date.parse("2026-10-29T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const page = (id: string, extra: Partial<Page> = {}): Page => ({
  id,
  parentId: null,
  title: id,
  icon: null,
  position: "a0",
  excerpt: "",
  x: null,
  y: null,
  coverUrl: null,
  createdAt: iso(T0 - 86_400_000),
  updatedAt: iso(T0 - 86_400_000),
  updatedBy: { kind: "person", id: "p1", name: "Ada" },
  ...extra,
});
const agent = (id: string, name: string): Agent => ({ id, name, description: "", instructions: "", color: "#7a2e1d", model: "m" });
const run = (id: string, agentId: string, extra: Partial<Run> = {}): Run => ({
  id,
  agentId,
  threadId: null,
  parentRunId: null,
  prompt: "",
  status: "running",
  pageId: null,
  error: null,
  steps: [],
  createdAt: iso(T0),
  endedAt: null,
  ...extra,
});
const graph = (extra: Partial<MapGraph> = {}): MapGraph => ({
  pages: [page("a"), page("b"), page("c", { updatedAt: iso(T0 - 10_000) })],
  links: [{ from: "a", to: "b" }, { from: "a", to: "gone" }],
  agents: [agent("ar", "Archivist"), agent("sc", "Scribe")],
  runs: [run("r2", "ar", { pageId: "b", steps: [{ at: iso(T0), tool: "write_page", summary: "", pageId: "b", ok: true }] }), run("r1", "ar", { pageId: "a", status: "succeeded" })],
  ...extra,
});

describe("fromGraph", () => {
  it("stands agents where their newest run is and drops dangling links", () => {
    const s = fromGraph(graph(), T0);
    const w = s.walkers.get("agent:ar")!;
    expect(w.pageId).toBe("b");
    expect(w.action).toBe("writing");
    expect(s.links).toEqual([{ from: "a", to: "b" }]);
    expect(s.walkers.has("agent:sc")).toBe(false);
  });

  it("marks recently changed pages as fresh", () => {
    const s = fromGraph(graph(), T0);
    expect(s.fresh.has("c")).toBe(true);
    expect(s.fresh.has("a")).toBe(false);
  });

  it("keeps walkers when rebased on a newer graph", () => {
    let s = fromGraph(graph(), T0);
    s = applyEvent(s, { type: "agent.moved", runId: "r2", agentId: "ar", fromPageId: "b", toPageId: "c", action: "reading" }, T0 + 1);
    const again = fromGraph(graph(), T0 + 2, s);
    expect(again.walkers.get("agent:ar")!.pageId).toBe("c");
    expect(again.seq).toBe(s.seq);
  });
});

describe("applyEvent", () => {
  const base = () => fromGraph(graph(), T0);

  it("walks an agent from page to page, once per move", () => {
    const s0 = base();
    const s1 = applyEvent(s0, { type: "agent.moved", runId: "r2", agentId: "ar", fromPageId: "b", toPageId: "a", action: "reading" }, T0 + 5);
    const w = s1.walkers.get("agent:ar")!;
    expect(w.pageId).toBe("a");
    expect(w.action).toBe("reading");
    expect(w.move).toEqual({ seq: 1, from: "b", to: "a", at: T0 + 5 });
    // Same page again: action changes, no new walk.
    const s2 = applyEvent(s1, { type: "agent.moved", runId: "r2", agentId: "ar", fromPageId: "a", toPageId: "a", action: "writing" }, T0 + 6);
    expect(s2.walkers.get("agent:ar")!.move!.seq).toBe(1);
    expect(s2.walkers.get("agent:ar")!.action).toBe("writing");
    expect(writingPages(s2).get("a")).toBe("#7a2e1d");
  });

  it("leaving for nowhere leaves the agent idle beside its last page", () => {
    const s = applyEvent(base(), { type: "agent.moved", runId: "r2", agentId: "ar", fromPageId: "b", toPageId: null, action: "leaving" }, T0 + 5);
    const w = s.walkers.get("agent:ar")!;
    expect(w.pageId).toBe("b");
    expect(w.action).toBe("idle");
    expect(writingPages(s).size).toBe(0);
  });

  it("places an agent seen for the first time without a walk", () => {
    const s = applyEvent(base(), { type: "agent.moved", runId: "r9", agentId: "sc", fromPageId: null, toPageId: "c", action: "thinking" }, T0);
    const w = s.walkers.get("agent:sc")!;
    expect(w.pageId).toBe("c");
    expect(w.move).toEqual({ seq: 1, from: null, to: "c", at: T0 });
    expect(w.name).toBe("Scribe");
  });

  it("finishing a run makes its agent idle and drops the glow", () => {
    const s0 = base();
    expect(writingPages(s0).has("b")).toBe(true);
    const s1 = applyEvent(s0, { type: "run.updated", run: run("r2", "ar", { pageId: "b", status: "succeeded" }) }, T0 + 9);
    expect(s1.walkers.get("agent:ar")!.action).toBe("idle");
    expect(writingPages(s1).size).toBe(0);
    expect(agentStatuses(s1).find((a) => a.agent.id === "ar")!.working).toBe(false);
  });

  it("a different, older run finishing doesn't idle a busy agent", () => {
    const s = applyEvent(base(), { type: "run.updated", run: run("r1", "ar", { pageId: "a", status: "failed" }) }, T0);
    expect(s.walkers.get("agent:ar")!.action).toBe("writing");
  });

  it("patches pages: created, updated with fresh ink, moved without, deleted", () => {
    let s = base();
    s = applyEvent(s, { type: "page.created", page: page("d", { parentId: "a" }) }, T0 + 1);
    expect(s.pages.get("d")!.parentId).toBe("a");
    expect(s.fresh.get("d")).toBe(T0 + 1);

    s = applyEvent(s, { type: "page.updated", page: page("a", { excerpt: "New words", updatedAt: iso(T0 + 2) }) }, T0 + 2);
    expect(s.pages.get("a")!.excerpt).toBe("New words");
    expect(s.fresh.get("a")).toBe(T0 + 2);

    s = applyEvent(s, { type: "page.updated", page: page("b", { x: 10, y: 20, updatedAt: iso(T0 + 3) }) }, T0 + 3);
    expect(s.pages.get("b")!.x).toBe(10);
    expect(s.fresh.has("b")).toBe(false);

    s = applyEvent(s, { type: "page.deleted", pageId: "a" }, T0 + 4);
    expect(s.pages.has("a")).toBe(false);
    expect(s.links).toEqual([]);
  });

  it("returns the same state for a no-op update, so nothing re-renders", () => {
    const s = base();
    expect(applyEvent(s, { type: "page.updated", page: s.pages.get("a")! }, T0)).toBe(s);
    expect(applyEvent(s, { type: "diary.delta", entryId: "e", threadId: "t", text: "x" }, T0)).toBe(s);
  });

  it("tracks people's presence, walking them between pages", () => {
    let s = base();
    s = applyEvent(s, { type: "presence", people: [{ id: "p1", name: "Ada", pageId: "a" }] }, T0);
    expect(s.walkers.get("person:p1")).toMatchObject({ kind: "person", pageId: "a", name: "Ada" });
    s = applyEvent(s, { type: "presence", people: [{ id: "p1", name: "Ada", pageId: "c" }] }, T0 + 1);
    expect(s.walkers.get("person:p1")!.move).toMatchObject({ from: "a", to: "c" });
    s = applyEvent(s, { type: "presence", people: [] }, T0 + 2);
    expect(s.walkers.has("person:p1")).toBe(false);
  });
});
