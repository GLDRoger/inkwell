import type { Actor } from "../shared/types.ts";
import {
  appendRunStep,
  insertAgent,
  insertDiaryEntry,
  insertDiaryThread,
  insertRun,
  updateRun,
  newId,
  type Db,
} from "./db.ts";
import type { PageStore } from "./pages.ts";

interface SeedPage {
  key: string;
  parentKey: string | null;
  title: string;
  icon: string;
  x: number;
  y: number;
  /** Markdown body (the title is a separate field, so no leading H1) with
   * {{key}} placeholders resolved to /p/<id> links. */
  body: string;
}

const PAGES: SeedPage[] = [
  // ---- Trip to Lisbon (west) ----
  {
    key: "lisbon",
    parentKey: null,
    title: "Trip to Lisbon",
    icon: "✈️",
    x: -950,
    y: -380,
    body: `Five days in Lisbon in late spring — part holiday, part scouting trip for a longer stay next year. This page is the hub; the details live in the child pages.

## The plan at a glance

- **Days 1–2:** Alfama and the old town, stay near Graça
- **Day 3:** Belém for the monuments and pastéis
- **Day 4:** Day trip to Sintra if the weather holds
- **Day 5:** Slow morning, LX Factory, fly home

The day-by-day schedule is in [Lisbon itinerary]({{lisbon-itinerary}}), and everything worth eating is collected in [Lisbon food & neighbourhoods]({{lisbon-food}}). Flights, bags and bookings live in [Packing & logistics]({{lisbon-logistics}}).

## Why Lisbon

> "Lisbon is a city that rewards walking uphill." — every guidebook, accurately

Light, hills, trams, and custard tarts. Also a serious test of whether we could live somewhere slower for a season.
`,
  },
  {
    key: "lisbon-itinerary",
    parentKey: "lisbon",
    title: "Lisbon itinerary",
    icon: "🗓️",
    x: -720,
    y: -520,
    body: `Day by day. Times are intentions, not contracts. Back to the hub: [Trip to Lisbon]({{lisbon}}).

| Day | Base | Morning | Afternoon | Evening |
| --- | --- | --- | --- | --- |
| 1 | Graça | Arrive, settle in | Alfama wander | Tasca dinner |
| 2 | Graça | Castelo de São Jorge | Tram 28 end to end | Fado in Alfama |
| 3 | Graça | Belém: monastery & tower | Pastéis de Belém | Sunset at Miradouro da Graça |
| 4 | Sintra day trip | Pena Palace early | Quinta da Regaleira | Train back, Bairro Alto |
| 5 | Graça | LX Factory | Souvenirs & coffee | Fly home |

## Notes

- Book Pena Palace entry for the first slot — it fills up by 11.
- The Lisboa Card only pays off if we do two paid museums on day 3.
- Restaurants worth booking are listed in [Lisbon food & neighbourhoods]({{lisbon-food}}).
`,
  },
  {
    key: "lisbon-food",
    parentKey: "lisbon",
    title: "Lisbon food & neighbourhoods",
    icon: "🍮",
    x: -700,
    y: -220,
    body: `Where to eat and where to wander. Part of [Trip to Lisbon]({{lisbon}}); timing is in the [Lisbon itinerary]({{lisbon-itinerary}}).

## Eat

- **Pastéis de Belém** — the original custard tarts, warm with cinnamon
- **Time Out Market** — easy first-night option, go early
- **A neighbourhood tasca in Graça** — grilled sardines if they're on
- **Ginjinha stand** — sour cherry liqueur, one shot, standing up

## Neighbourhoods

### Alfama
The old maze below the castle. Fado leaking out of doorways, laundry over the alleys. Get lost on purpose.

### Graça
Quieter, local, great viewpoints. Our base — close enough to walk everywhere, far enough to sleep.

### Belém
Monumental and riverside. Monastery, tower, and the tart queue that's actually worth it.
`,
  },
  {
    key: "lisbon-logistics",
    parentKey: "lisbon",
    title: "Packing & logistics",
    icon: "🧳",
    x: -980,
    y: -120,
    body: `Bookings and bags for [Trip to Lisbon]({{lisbon}}).

## Checklist

- [x] Flights booked — out Thursday morning, back Monday evening
- [x] Graça apartment reserved
- [ ] Pena Palace tickets (first slot, day 4)
- [ ] Airport transfer or metro plan
- [ ] Travel insurance documents saved offline
- [ ] Restaurant booking for Saturday night

## Pack

1. Shoes that survive cobblestones and hills
2. Light layers — Atlantic evenings are cool
3. EU plug adapter and a power bank
4. Room in the bag for tins of sardines and ceramics

## Money notes

Cards work almost everywhere; keep €20 in coins/small notes for trams and tiny cafés.
`,
  },

  // ---- Startup (north-centre) ----
  {
    key: "startup",
    parentKey: null,
    title: "Startup: launch plan",
    icon: "🚀",
    x: 120,
    y: -480,
    body: `The hub for getting v1 into real users' hands. Everything below rolls up to one goal: **ten happy paying teams by the end of the quarter.**

## Workstreams

- [Product roadmap]({{roadmap}}) — what ships, in what order
- [Fundraising notes]({{fundraising}}) — runway, round, and investor list
- [Hiring plan]({{hiring}}) — the two roles that unblock everything
- [Metrics that matter]({{metrics}}) — the numbers we review every Monday

## Principles

1. Ship to three friendly teams before polishing anything.
2. Every feature must answer a complaint we heard in a user call.
3. If it isn't measured in [Metrics that matter]({{metrics}}), it didn't happen.
`,
  },
  {
    key: "roadmap",
    parentKey: "startup",
    title: "Product roadmap",
    icon: "🗺️",
    x: 380,
    y: -620,
    body: `Sequenced for the [launch plan]({{startup}}). Dates are targets we renegotiate weekly, not promises.

## Now (next 4 weeks)

- [x] Onboarding flow with sample data
- [ ] Billing: cards, invoices, dunning emails
- [ ] Audit log for workspace admins
- [ ] Performance pass on the two slowest screens

## Next

- Public API + webhooks
- Templates gallery seeded from our three pilot teams
- Mobile companion (read + capture only)

## Later / maybe never

- Native desktop apps
- Marketplace for third-party integrations

Progress is judged against [Metrics that matter]({{metrics}}), not against this list.
`,
  },
  {
    key: "fundraising",
    parentKey: "startup",
    title: "Fundraising notes",
    icon: "💰",
    x: 400,
    y: -360,
    body: `Supporting the [launch plan]({{startup}}). We raise when the pilot metrics are boring in the best way: retention first, growth second.

## Position

- Runway at current burn: ~9 months
- Target: seed extension, closed before runway hits 5 months
- Proof points needed: 10 paying teams, week-4 retention above 60%

## Investor conversations

| Firm | Stage | Next step |
| --- | --- | --- |
| North Pier | Partner meeting done | Send updated metrics |
| Fieldstone | Intro call | Product demo with pilot user |
| Operators' syndicate | Verbal interest | Term sheet draft |

## Diligence folder

Financial model, cap table, pilot references, and the security one-pager. Keep it boring and current.
`,
  },
  {
    key: "hiring",
    parentKey: "startup",
    title: "Hiring plan",
    icon: "🧑‍🤝‍🧑",
    x: 90,
    y: -230,
    body: `Two roles unblock the [launch plan]({{startup}}); everything else can wait a quarter.

## Role 1: Full-stack engineer

- Owns billing and the public API from the [Product roadmap]({{roadmap}})
- Strong product sense; will talk to pilot teams weekly
- Loop: work sample → pairing session → founder chat

## Role 2: Designer (product + brand)

- Owns onboarding polish and the templates gallery
- Sets the visual system we keep improvising today

## Rules

1. No role opens without a written scorecard.
2. Every finalist does a paid work trial.
3. We hire for the next 18 months of problems, not the last 18 days.
`,
  },
  {
    key: "metrics",
    parentKey: "startup",
    title: "Metrics that matter",
    icon: "📈",
    x: 350,
    y: -140,
    body: `Reviewed every Monday as part of the [launch plan]({{startup}}). If a number isn't here, we don't argue about it in the meeting.

## The five numbers

| Metric | Definition | Target |
| --- | --- | --- |
| Activated teams | Teams completing onboarding in week 1 | 10 paying by quarter end |
| Week-4 retention | Teams still active 4 weeks after signup | ≥ 60% |
| Weekly active editors | People editing in the last 7 days | Growing 5%/week |
| Time to first value | Signup → first shared page | < 10 minutes |
| Support load | Tickets per active team per week | < 0.5 |

## How we use them

- Roadmap debates ([Product roadmap]({{roadmap}})) must name the metric they move.
- Two red weeks in a row on any metric stops new feature work until it's understood.

\`\`\`sql
-- Weekly active editors, the query behind the chart
SELECT date_trunc('week', edited_at) AS week, COUNT(DISTINCT user_id)
FROM edits GROUP BY 1 ORDER BY 1;
\`\`\`
`,
  },

  // ---- Reading notes (south-west) ----
  {
    key: "reading",
    parentKey: null,
    title: "Reading notes",
    icon: "📚",
    x: -420,
    y: 420,
    body: `Notes worth keeping from books actually finished. Two so far this year:

- [The Design of Everyday Things]({{doet}}) — affordances, signifiers, and why doors confuse everyone
- [Thinking in Systems]({{systems}}) — stocks, flows, feedback loops, and leverage points

## Reading rules

1. A book only gets a page if it changed how I do something.
2. Notes are written from memory a week after finishing — what survived is what mattered.
3. Quotes are kept short; the point is the idea, not the scrapbook.
`,
  },
  {
    key: "doet",
    parentKey: "reading",
    title: "The Design of Everyday Things",
    icon: "🚪",
    x: -180,
    y: 300,
    body: `Don Norman. Filed under [Reading notes]({{reading}}).

## Ideas that stuck

- **Affordances vs signifiers:** what an object *can* do vs what it *tells* you it can do. Most "user error" is missing signifiers.
- **Norman doors:** if a door needs a push/pull sign, the door failed, not the person.
- **Feedback:** every action needs a visible result, immediately, or people repeat it (elevator buttons!).
- **Constraints** are kindness: make the wrong thing impossible instead of warning about it.

## Where I use this

Product onboarding reviews — every "users keep doing X wrong" is a signifier bug until proven otherwise. Pairs well with the systems view in [Thinking in Systems]({{systems}}).
`,
  },
  {
    key: "systems",
    parentKey: "reading",
    title: "Thinking in Systems",
    icon: "🔁",
    x: -160,
    y: 560,
    body: `Donella Meadows. Filed under [Reading notes]({{reading}}).

## Ideas that stuck

- **Stocks and flows:** you can only change a stock through its flows, and flows are usually slow. Patience is a strategy.
- **Feedback loops:** reinforcing loops explain runaway growth and collapse; balancing loops explain stubborn plateaus.
- **Leverage points:** changing goals and paradigms beats tweaking parameters — but it's the hardest place to push.
- **Bounded rationality:** every actor is rational inside their own information bubble. Fix the information, not the actor.

> "We can't control systems or figure them out. But we can dance with them."

I keep coming back to this when a metric won't move — usually I'm pushing a parameter when the goal of the system is the problem. See also the design lens in [The Design of Everyday Things]({{doet}}).
`,
  },

  // ---- Recipes (east) ----
  {
    key: "recipes",
    parentKey: null,
    title: "Recipes",
    icon: "🍳",
    x: 820,
    y: 300,
    body: `The house cookbook. Two collections:

- [Weeknight dinners]({{dinners}}) — 30 minutes, one pan, no tears
- [Sourdough journal]({{sourdough}}) — the long game

## House rules

1. A recipe earns its place after being cooked three times.
2. Quantities are written the way we actually cook, approximations and all.
3. Every recipe names its source or its inventor (usually hunger).
`,
  },
  {
    key: "dinners",
    parentKey: "recipes",
    title: "Weeknight dinners",
    icon: "🍝",
    x: 1060,
    y: 180,
    body: `From [Recipes]({{recipes}}). The rotation that saves Tuesdays.

## Go-to list

- [ ] **Pasta e ceci** — chickpeas, tomato, rosemary, small pasta. 25 minutes.
- [ ] **Miso eggs on rice** — jammy eggs marinated overnight, rice from the cooker.
- [ ] **Sheet-pan gnocchi** — gnocchi, tomatoes, and whatever green is wilting.
- [x] **Black bean quesadillas** — the undefeated champion.

## Pasta e ceci (the method)

1. Soften garlic and rosemary in olive oil; add tomato paste until dark.
2. Add chickpeas with their liquid plus a mug of water; simmer 10 minutes.
3. Mash a ladleful for body, add small pasta, cook in the broth.
4. Finish with lemon, parmesan, and more olive oil than feels polite.

Bread for the table comes from the [Sourdough journal]({{sourdough}}) when the starter is behaving.
`,
  },
  {
    key: "sourdough",
    parentKey: "recipes",
    title: "Sourdough journal",
    icon: "🍞",
    x: 1080,
    y: 460,
    body: `Notes on the starter ("Clint Yeastwood") and recent loaves. Part of [Recipes]({{recipes}}).

## Current formula

| Ingredient | Baker's % | For 1 loaf |
| --- | --- | --- |
| Bread flour | 100% | 500 g |
| Water | 75% | 375 g |
| Starter | 20% | 100 g |
| Salt | 2% | 10 g |

## Log

- **Loaf 41:** Best ear yet. Cold proof 14 h, baked in the Dutch oven at 240°C.
- **Loaf 40:** Overproofed — kitchen was warm, bulk ran 1 h too long. Still made fine toast.
- **Loaf 39:** 10% wholemeal. Better flavour, slightly tighter crumb.

## Reminders

- Feed the starter the night before a bake, not the morning of.
- Judge bulk by the dough, not the clock.
- Slice for [Weeknight dinners]({{dinners}}) garlic bread emergencies.
`,
  },
];

export const SEED_AGENTS = [
  {
    name: "Scout",
    description: "Researcher — searches the notebook and gathers what matters",
    instructions:
      "You are Scout, a research agent. Search and read the user's pages before answering. Summarise with links to the pages you used, quote sparingly, and say plainly when the notebook doesn't contain an answer. Prefer facts already in the notebook over general knowledge.",
    color: "#c0602f",
  },
  {
    name: "Wren",
    description: "Writer & editor — drafts, polishes and expands pages",
    instructions:
      "You are Wren, a writing agent. Draft and revise prose directly in the user's pages, preserving their voice and structure. Prefer small, reviewable edits over wholesale rewrites. Keep headings, lists and links intact unless the request asks otherwise.",
    color: "#3b7a58",
  },
  {
    name: "Atlas",
    description: "Organiser — files, links and tidies the notebook",
    instructions:
      "You are Atlas, an organising agent. Keep the notebook tidy: file pages under the right parents, add links between related pages, and give pages clear titles. Make the changes yourself, then say what you moved, linked or renamed. Never delete a page unless the person asks explicitly.",
    color: "#6b56a8",
  },
] as const;

/** Earlier seeded instructions, replaced in existing notebooks unless someone edited them. */
const RETIRED_INSTRUCTIONS: Record<string, string> = {
  Atlas: "You are Atlas, an organising agent. Keep the notebook tidy: file pages under the right parents, add links between related pages, fix titles and excerpts, and propose structure before making big moves. Never delete a page without being asked explicitly.",
};

/** Earlier seeded colours (see docs/DESIGN.md), replaced unless someone changed them. */
const RETIRED_COLORS: Record<string, string> = { Scout: "#b3541e", Wren: "#2e5e4e", Atlas: "#3b4a7a" };

/** Bring seeded agents in existing notebooks up to the current instructions and colours. */
export function upgradeSeedAgents(db: Db): void {
  for (const agent of SEED_AGENTS) {
    const oldColor = RETIRED_COLORS[agent.name];
    if (oldColor) db.prepare("UPDATE agents SET color = ? WHERE name = ? AND color = ?").run(agent.color, agent.name, oldColor);
    const retired = RETIRED_INSTRUCTIONS[agent.name];
    if (retired) db.prepare("UPDATE agents SET instructions = ? WHERE name = ? AND instructions = ?").run(agent.instructions, agent.name, retired);
  }
}

export function seedWorkspace(
  deps: { db: Db; pages: PageStore },
  workspaceId: string,
  _actor: Actor,
): void {
  const { db, pages } = deps;
  if (pages.countPages(workspaceId) > 0) return;

  const ids = new Map<string, string>();
  for (const page of PAGES) ids.set(page.key, newId());
  const resolve = (body: string) =>
    body.replace(/\{\{([a-z-]+)\}\}/g, (_m, key: string) => `/p/${ids.get(key) ?? key}`);

  db.transaction(() => {
    const agents = SEED_AGENTS.map((agent) => insertAgent(db, workspaceId, { ...agent }));
    const atlas = agents.find((a) => a.name === "Atlas")!;
    const author: Actor = { kind: "agent", id: atlas.id, name: atlas.name };
    // Parents first (PAGES is ordered that way), then children.
    for (const seed of PAGES) {
      pages.createPage(workspaceId, author, {
        id: ids.get(seed.key)!,
        parentId: seed.parentKey ? ids.get(seed.parentKey)! : null,
        title: seed.title,
        icon: seed.icon,
        markdown: resolve(seed.body),
        x: seed.x,
        y: seed.y,
      });
    }

    pages.rebuildLinks(workspaceId);

    const thread = insertDiaryThread(db, workspaceId, "Welcome to Inkwell");
    const stops: Record<string, { key: string; summary: string; tool: string }> = {
      Atlas: { key: "startup", summary: "Laid out the demo map", tool: "move_page" },
      Scout: { key: "reading", summary: "Gathered the demo reading notes", tool: "read_page" },
      Wren: { key: "lisbon", summary: "Prepared the demo Lisbon trip notes", tool: "write_page" },
    };
    for (const agent of agents) {
      const stop = stops[agent.name]!;
      const pageId = ids.get(stop.key)!;
      const run = insertRun(db, workspaceId, { agentId: agent.id, prompt: stop.summary, pageId });
      appendRunStep(db, workspaceId, run.id, { tool: stop.tool, summary: stop.summary, pageId, ok: true });
      updateRun(db, workspaceId, run.id, { status: "succeeded" });
    }
    insertDiaryEntry(db, workspaceId, {
      threadId: thread.id,
      role: "agent",
      agentId: atlas.id,
      text: `Welcome to your notebook. I've laid out a demo map for you — a Lisbon trip in the west, a startup launch plan up north, reading notes in the south, and recipes out east.\n\nAsk me (or Scout, or Wren) to research, write, or tidy anything. Watch the map: you'll see our footprints as we work.`,
      pageIds: [ids.get("lisbon")!, ids.get("startup")!],
    });
  })();
}
