import type { Agent, Id, Link, MapGraph, Page, Run, ServerEvent } from "@shared/types";
import { CARD_W } from "./layout";

/**
 * A made-up notebook for working on the map without the server: open any
 * page with ?fixture=1 (and &pages=400 for the performance check, &script=0
 * to keep everyone still). A scripted sequence of events walks the agents
 * around and has them write.
 */

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REGIONS = [
  "Product",
  "Billing",
  "Search",
  "Research",
  "Onboarding",
  "Field Notes",
  "Roadmap",
  "Hiring",
  "Design System",
  "Support",
  "Garden",
  "Reading List",
  "Infrastructure",
  "Travel",
  "Interviews",
  "Recipes",
];

const TOPICS = [
  "Pricing",
  "Invoices",
  "Refunds",
  "Ranking",
  "Synonyms",
  "Index rebuild",
  "Welcome tour",
  "First week",
  "Q3 bets",
  "Launch checklist",
  "Retro",
  "Interview loop",
  "Colour tokens",
  "Type scale",
  "Escalations",
  "Macros",
  "Tomatoes",
  "Seed list",
  "Essays",
  "On writing",
  "Postgres",
  "Backups",
  "Lisbon",
  "Kyoto",
  "Customer calls",
  "Sourdough",
  "Dashboards",
  "Metrics",
  "Open questions",
  "Decisions",
  "Glossary",
  "Weekly notes",
];
const KINDS = ["notes", "plan", "draft", "summary", "ideas", "log", "brief", "spec", "FAQ", "outline"];

const SENTENCES = [
  "We agreed to keep the free tier and make the paid plan obviously better rather than making free worse.",
  "Three customers asked for annual invoices in the same week, which is a pattern, not a coincidence.",
  "The ranking change helped long queries and hurt short ones; we need a better test set before shipping.",
  "Open question: who owns the welcome email once the tour is done?",
  "The index rebuild takes forty minutes on the big workspace, so it has to run in the background.",
  "Notes from the call: they love the map, they want exports, and they don't trust the search yet.",
  "Draft the launch post around one story, not a feature list.",
  "Tomatoes went in on the 12th; the basil is sulking.",
  "Every decision here links back to the doc that made it, so nobody has to ask twice.",
  "If we only fix one thing this month it should be the empty states.",
  "Interview loop: one take-home, one pairing session, one conversation about how they learn.",
  "Postgres backups run nightly and are restored weekly into a scratch database to prove they work.",
  "Kyoto in November: book the ryokan early, everything else can wait.",
  "The glossary is the single source for what words mean in this notebook.",
  "Summary for the team: shipped two fixes, learned one hard lesson about caching, and started the search rework.",
];

const AGENTS: Agent[] = [
  { id: "ag-archivist", name: "Archivist", description: "Keeps the notebook tidy and cross-linked.", instructions: "", color: "#7a2e1d", model: "muse-spark-1.3" },
  { id: "ag-scribe", name: "Scribe", description: "Writes and rewrites pages on request.", instructions: "", color: "#2c4f7c", model: "muse-spark-1.3" },
  { id: "ag-cartographer", name: "Cartographer", description: "Arranges the map and finds what's related.", instructions: "", color: "#3a6b36", model: "muse-spark-1.3" },
];

const iso = (ms: number) => new Date(ms).toISOString();

export function makeFixtureGraph(count = 72, seed = 7): MapGraph {
  const rand = rng(seed);
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
  const now = Date.now();
  const pages: Page[] = [];
  const person = { kind: "person" as const, id: "p-ada", name: "Ada" };
  let n = 0;
  const excerpt = () => {
    const k = 1 + Math.floor(rand() * 4);
    const out: string[] = [];
    for (let i = 0; i < k; i++) out.push(pick(SENTENCES));
    return out.join(rand() > 0.5 ? "\n" : " ");
  };
  const make = (parentId: Id | null, title: string, extra: Partial<Page> = {}): Page => {
    n++;
    const age = Math.floor(rand() * 20 * 86_400_000);
    const agent = rand() > 0.55 ? pick(AGENTS) : null;
    const p: Page = {
      id: `pg-${n}`,
      parentId,
      title,
      icon: null,
      position: `a${String(n).padStart(4, "0")}`,
      excerpt: rand() > 0.08 ? excerpt() : "",
      x: null,
      y: null,
      coverUrl: null,
      createdAt: iso(now - age - 86_400_000),
      updatedAt: iso(now - age),
      updatedBy: agent ? { kind: "agent", id: agent.id, name: agent.name } : person,
      ...extra,
    };
    pages.push(p);
    return p;
  };

  // A board of notes imported from a photo: placed where they were on the whiteboard.
  const board = make(null, "Whiteboard, Tuesday", { x: 0, y: 0 });
  const stickies = Math.min(6, Math.max(2, Math.round(count * 0.06)));
  for (let i = 0; i < stickies; i++)
    make(board.id, ["Ship the map", "Fix search", "Ask Ada about pricing", "Customer quotes", "Hiring plan", "Q4 themes"][i], {
      x: Math.round(((i % 3) + 1) * (CARD_W + 64) + (rand() - 0.5) * 40),
      y: Math.round(Math.floor(i / 3) * 320 + (rand() - 0.5) * 40),
    });

  const remaining = count - n;
  const regionCount = Math.max(1, Math.min(REGIONS.length, Math.round(Math.sqrt(remaining) * 0.75)));
  const loose = Math.max(0, Math.round(remaining * 0.05));
  const perRegion = Math.max(1, Math.floor((remaining - loose - regionCount) / regionCount));
  for (let r = 0; r < regionCount; r++) {
    const root = make(null, REGIONS[r]);
    const kids: Page[] = [];
    const total = r === regionCount - 1 ? count - n - loose : perRegion;
    for (let i = 0; i < total && n < count - loose; i++) {
      const parent = kids.length > 3 && rand() > 0.75 ? pick(kids) : root;
      kids.push(make(parent.id, `${pick(TOPICS)} ${pick(KINDS)}`));
    }
  }
  while (n < count) make(null, `${pick(TOPICS)} ${pick(KINDS)}`);

  const links: Link[] = [];
  const ids = pages.map((p) => p.id);
  for (let i = 0; i < Math.round(count * 0.45); i++) {
    const from = pick(ids);
    const near = rand() > 0.35;
    const idx = ids.indexOf(from);
    const to = near ? ids[Math.max(0, Math.min(ids.length - 1, idx + Math.floor((rand() - 0.5) * 12)))] : pick(ids);
    if (from !== to) links.push({ from, to });
  }

  const runs: Run[] = AGENTS.map((a, i) => ({
    id: `run-${a.id}-0`,
    agentId: a.id,
    threadId: null,
    parentRunId: null,
    prompt: "Tidy up the notebook",
    status: i < 2 ? "running" : "succeeded",
    pageId: ids[Math.floor(rand() * ids.length)],
    error: null,
    steps: [{ at: iso(now), tool: i === 0 ? "write_page" : "read_page", summary: "", pageId: null, ok: true }],
    createdAt: iso(now - i * 60_000),
    endedAt: null,
  }));

  return { pages, links, agents: AGENTS, runs };
}

/**
 * Agents wander: walk to a page, read or write, sometimes finish their run
 * and start another. Ada drifts between pages too. Returns a stop function.
 */
export function runFixtureScript(graph: MapGraph, emit: (e: ServerEvent) => void, seed = 11): () => void {
  const rand = rng(seed);
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
  const pages = new Map(graph.pages.map((p) => [p.id, { ...p }]));
  const ids = [...pages.keys()];
  const where = new Map<Id, Id | null>(graph.agents.map((a) => [a.id, graph.runs.find((r) => r.agentId === a.id)?.pageId ?? null]));
  const runOf = new Map<Id, Run>(graph.runs.map((r) => [r.agentId, r]));
  const timers: ReturnType<typeof setTimeout>[] = [];
  const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
  let ada: Id | null = pick(ids);
  let turn = 0;

  // Agents tend to stay in a neighbourhood: the next page is usually close in reading order.
  const nextPage = (from: Id | null) => {
    if (!from || rand() > 0.7) return pick(ids);
    const i = ids.indexOf(from);
    return ids[Math.max(0, Math.min(ids.length - 1, i + Math.round((rand() - 0.5) * 14)))];
  };

  const step = () => {
    const agent = graph.agents[turn++ % graph.agents.length];
    let run = runOf.get(agent.id)!;
    if (run.status !== "running") {
      run = { ...run, id: `run-${agent.id}-${turn}`, status: "running", createdAt: new Date().toISOString(), endedAt: null, steps: [] };
      runOf.set(agent.id, run);
      emit({ type: "run.updated", run });
    }
    const from = where.get(agent.id) ?? null;
    let to = nextPage(from);
    if (to === from) to = pick(ids);
    const action = rand() > 0.45 ? "writing" : "reading";
    where.set(agent.id, to);
    emit({ type: "agent.moved", runId: run.id, agentId: agent.id, fromPageId: from, toPageId: to, action });
    emit({ type: "run.updated", run: { ...run, pageId: to } });
    if (action === "writing") {
      at(2200, () => {
        const p = pages.get(to);
        if (!p) return;
        const next: Page = {
          ...p,
          excerpt: `${pick(SENTENCES)}\n${p.excerpt}`.slice(0, 600),
          updatedAt: new Date().toISOString(),
          updatedBy: { kind: "agent", id: agent.id, name: agent.name },
        };
        pages.set(to, next);
        emit({ type: "page.updated", page: next });
      });
    }
    if (rand() > 0.8) {
      at(3600, () => {
        const done: Run = { ...run, status: "succeeded", endedAt: new Date().toISOString(), pageId: to };
        runOf.set(agent.id, done);
        emit({ type: "agent.moved", runId: run.id, agentId: agent.id, fromPageId: to, toPageId: null, action: "leaving" });
        emit({ type: "run.updated", run: done });
      });
    }
  };

  const wanderAda = () => {
    ada = nextPage(ada);
    emit({ type: "presence", people: [{ id: "p-ada", name: "Ada", pageId: ada }] });
  };

  at(400, wanderAda);
  const interval = setInterval(step, 2600);
  const adaInterval = setInterval(wanderAda, 7000);
  at(1400, step);
  return () => {
    clearInterval(interval);
    clearInterval(adaInterval);
    timers.forEach(clearTimeout);
  };
}
