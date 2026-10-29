import type { Agent, Id, Link, MapGraph, Page, Run, ServerEvent } from "@shared/types";

/**
 * The map's live state: the graph from GET /api/map, patched in place by
 * server events, plus what only the map cares about: who is standing where,
 * who just walked, and which pages have fresh ink.
 */

export type WalkerAction = "reading" | "writing" | "thinking" | "idle";

export interface Move {
  /** Increases with every move on the map, so a walk starts exactly once. */
  seq: number;
  from: Id | null;
  to: Id;
  at: number;
}

export interface Walker {
  /** "agent:<id>" or "person:<id>". */
  key: string;
  kind: "agent" | "person";
  id: Id;
  name: string;
  /** Agents: their ink. People: null, the map picks a person's ink. */
  color: string | null;
  pageId: Id | null;
  action: WalkerAction;
  runId: Id | null;
  move: Move | null;
}

export interface MapState {
  pages: Map<Id, Page>;
  links: Link[];
  agents: Map<Id, Agent>;
  runs: Map<Id, Run>;
  walkers: Map<string, Walker>;
  /** Page id -> when it last changed while we watched (ms). */
  fresh: Map<Id, number>;
  seq: number;
}

/** Pages changed this recently show fresh ink. */
export const FRESH_MS = 90_000;

const ACTIVE: Run["status"][] = ["queued", "running"];
export const isActive = (run: Run | undefined | null) => !!run && ACTIVE.includes(run.status);

const agentKey = (id: Id) => `agent:${id}`;
const personKey = (id: Id) => `person:${id}`;

function actionFromRun(run: Run): WalkerAction {
  if (!isActive(run)) return "idle";
  const last = run.steps[run.steps.length - 1];
  if (!last) return "thinking";
  return /write|edit|create|append|insert|update|move|rename/i.test(last.tool) ? "writing" : "reading";
}

/**
 * Build state from a graph. When `prev` is given (the graph was refetched or
 * patched elsewhere), who stands where and what's fresh carry over.
 */
export function fromGraph(graph: MapGraph, now: number, prev?: MapState | null): MapState {
  const pages = new Map(graph.pages.map((p) => [p.id, p]));
  const agents = new Map(graph.agents.map((a) => [a.id, a]));
  const runs = new Map(graph.runs.map((r) => [r.id, r]));
  const walkers = new Map<string, Walker>();
  const fresh = new Map<Id, number>();

  if (prev) {
    for (const [k, w] of prev.walkers) {
      if (w.kind === "agent") {
        const a = agents.get(w.id);
        if (a) walkers.set(k, { ...w, name: a.name, color: a.color });
      } else walkers.set(k, w);
    }
    for (const [id, at] of prev.fresh) if (pages.has(id)) fresh.set(id, at);
  }

  // Each agent stands where its newest run left it. Runs come newest first.
  for (const run of graph.runs) {
    const a = agents.get(run.agentId);
    if (!a || !run.pageId) continue;
    const k = agentKey(a.id);
    const existing = walkers.get(k);
    if (existing && existing.pageId) {
      // Known position; only refresh whether it's still busy with this run.
      if (existing.runId === run.id && !isActive(run)) walkers.set(k, { ...existing, action: "idle" });
      continue;
    }
    if (existing && !existing.pageId) {
      walkers.set(k, { ...existing, pageId: run.pageId, runId: run.id, action: actionFromRun(run) });
      continue;
    }
    walkers.set(k, {
      key: k,
      kind: "agent",
      id: a.id,
      name: a.name,
      color: a.color,
      pageId: run.pageId,
      action: actionFromRun(run),
      runId: run.id,
      move: null,
    });
  }

  if (!prev) {
    for (const p of graph.pages) {
      const t = Date.parse(p.updatedAt);
      if (Number.isFinite(t) && now - t < FRESH_MS) fresh.set(p.id, t);
    }
  }

  return {
    pages,
    links: graph.links.filter((l) => pages.has(l.from) && pages.has(l.to)),
    agents,
    runs,
    walkers,
    fresh,
    seq: prev?.seq ?? 0,
  };
}

function withWalker(state: MapState, w: Walker): MapState {
  const walkers = new Map(state.walkers);
  walkers.set(w.key, w);
  return { ...state, walkers };
}

/** Move a walker, recording a walk when it actually changes page. */
function moveWalker(state: MapState, w: Walker, to: Id | null, now: number, from?: Id | null): MapState {
  const start = w.pageId ?? from ?? null;
  if (!to || to === start) return withWalker(state, { ...w, pageId: to ?? w.pageId });
  const seq = state.seq + 1;
  return { ...withWalker(state, { ...w, pageId: to, move: { seq, from: start, to, at: now } }), seq };
}

/** Apply one server event. Returns the same object when nothing on the map changed. */
export function applyEvent(state: MapState, e: ServerEvent, now: number): MapState {
  switch (e.type) {
    case "page.created":
    case "page.updated": {
      const old = state.pages.get(e.page.id);
      if (old && old.updatedAt === e.page.updatedAt && old.excerpt === e.page.excerpt && old.title === e.page.title && old.x === e.page.x && old.y === e.page.y && old.parentId === e.page.parentId && old.position === e.page.position && old.coverUrl === e.page.coverUrl && old.icon === e.page.icon)
        return state;
      const pages = new Map(state.pages);
      pages.set(e.page.id, e.page);
      const fresh = new Map(state.fresh);
      // A move on the map isn't new ink; new words or a new page are.
      const inked = !old || old.excerpt !== e.page.excerpt || old.title !== e.page.title;
      if (inked) fresh.set(e.page.id, now);
      return { ...state, pages, fresh };
    }
    case "page.deleted": {
      if (!state.pages.has(e.pageId)) return state;
      const pages = new Map(state.pages);
      pages.delete(e.pageId);
      const fresh = new Map(state.fresh);
      fresh.delete(e.pageId);
      return { ...state, pages, fresh, links: state.links.filter((l) => l.from !== e.pageId && l.to !== e.pageId) };
    }
    case "run.updated": {
      const runs = new Map(state.runs);
      runs.set(e.run.id, e.run);
      let next: MapState = { ...state, runs };
      const a = state.agents.get(e.run.agentId);
      if (!a) return next;
      const k = agentKey(a.id);
      const w = state.walkers.get(k);
      if (!w) {
        if (!e.run.pageId) return next;
        return withWalker(next, {
          key: k,
          kind: "agent",
          id: a.id,
          name: a.name,
          color: a.color,
          pageId: e.run.pageId,
          action: actionFromRun(e.run),
          runId: e.run.id,
          move: null,
        });
      }
      if (w.runId === e.run.id || !w.runId || isActive(e.run)) {
        const action = isActive(e.run) ? (w.runId === e.run.id && w.action !== "idle" ? w.action : actionFromRun(e.run)) : "idle";
        next = withWalker(next, { ...w, runId: e.run.id, action });
        // A run that names a page the walker isn't on: walk there (agent.moved usually says so first).
        if (isActive(e.run) && e.run.pageId && e.run.pageId !== w.pageId) next = moveWalker(next, next.walkers.get(k)!, e.run.pageId, now);
      }
      return next;
    }
    case "agent.moved": {
      const a = state.agents.get(e.agentId);
      const k = agentKey(e.agentId);
      const w: Walker = state.walkers.get(k) ?? {
        key: k,
        kind: "agent",
        id: e.agentId,
        name: a?.name ?? "Agent",
        color: a?.color ?? null,
        pageId: null,
        action: "idle",
        runId: e.runId,
        move: null,
      };
      const action: WalkerAction = e.action === "leaving" ? "idle" : e.action;
      const updated = { ...w, action, runId: e.runId };
      // Leaving for nowhere: the agent stays beside its last page, idle.
      return moveWalker(state, updated, e.toPageId ?? null, now, e.fromPageId);
    }
    case "presence": {
      let next = state;
      const here = new Set<string>();
      for (const p of e.people) {
        const k = personKey(p.id);
        here.add(k);
        const w: Walker = next.walkers.get(k) ?? {
          key: k,
          kind: "person",
          id: p.id,
          name: p.name,
          color: null,
          pageId: null,
          action: "reading",
          runId: null,
          move: null,
        };
        const named = w.name === p.name ? w : { ...w, name: p.name };
        if (p.pageId === w.pageId) {
          if (named !== w) next = withWalker(next, named);
          continue;
        }
        if (!p.pageId) {
          next = withWalker(next, { ...named, pageId: null, move: null });
          continue;
        }
        next = moveWalker(next, named, p.pageId, now);
      }
      for (const [k, w] of next.walkers) {
        if (w.kind === "person" && !here.has(k)) {
          const walkers = new Map(next.walkers);
          walkers.delete(k);
          next = { ...next, walkers };
        }
      }
      return next;
    }
    default:
      return state;
  }
}

export interface AgentStatus {
  agent: Agent;
  walker: Walker | null;
  working: boolean;
  /** The active run, when there is one. */
  run: Run | null;
}

/** Everyone in the roster: working agents first, then idle, by name. */
export function agentStatuses(state: MapState): AgentStatus[] {
  const active = new Map<Id, Run>();
  for (const r of state.runs.values()) {
    if (!isActive(r)) continue;
    const cur = active.get(r.agentId);
    if (!cur || cur.createdAt < r.createdAt) active.set(r.agentId, r);
  }
  return [...state.agents.values()]
    .map((agent) => {
      const walker = state.walkers.get(agentKey(agent.id)) ?? null;
      const run = active.get(agent.id) ?? null;
      return { agent, walker, run, working: !!run };
    })
    .sort((a, b) => Number(b.working) - Number(a.working) || a.agent.name.localeCompare(b.agent.name));
}

/** Pages an agent is writing on right now, with the writer's ink. */
export function writingPages(state: MapState): Map<Id, string> {
  const out = new Map<Id, string>();
  for (const w of state.walkers.values()) {
    if (w.kind !== "agent" || w.action !== "writing" || !w.pageId) continue;
    const run = w.runId ? state.runs.get(w.runId) : null;
    if (run && !isActive(run)) continue;
    out.set(w.pageId, w.color ?? "var(--wax)");
  }
  return out;
}
