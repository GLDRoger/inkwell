import type { Page } from "@shared/types";

/** "Good morning." / "Good afternoon." / "Good evening." for a local hour. */
export function hello(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning.";
  if (hour >= 12 && hour < 18) return "Good afternoon.";
  return "Good evening.";
}

/** "a page", "3 pages". */
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? `a ${one}` : `${n} ${many}`);

function names(list: string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

export const HINT = "Ask an agent in the Diary, and watch it work here.";

type GreetPage = Pick<Page, "createdAt" | "updatedAt" | "updatedBy">;

interface Tally {
  added: number;
  edited: number;
}

/** What each agent did to pages after `after` (and up to `until`), in the order given by `order`. */
function tally(pages: GreetPage[], after: number, until = Infinity): Map<string, Tally> {
  const by = new Map<string, Tally>();
  for (const p of pages) {
    const t = Date.parse(p.updatedAt);
    if (p.updatedBy.kind !== "agent" || !(t > after) || t > until) continue;
    const c = by.get(p.updatedBy.name) ?? { added: 0, edited: 0 };
    if (Date.parse(p.createdAt) > after) c.added++;
    else c.edited++;
    by.set(p.updatedBy.name, c);
  }
  return by;
}

/** "Wren added 2 pages", "Wren edited a page", "Wren and Scout worked on 3 pages". */
function summary(by: Map<string, Tally>, order: string[]): string | null {
  if (!by.size) return null;
  const who = order.filter((n) => by.has(n));
  if (who.length === 1) {
    const c = by.get(who[0])!;
    const what =
      c.edited === 0
        ? `added ${plural(c.added, "page")}`
        : c.added === 0
          ? `edited ${plural(c.edited, "page")}`
          : `added ${plural(c.added, "page")} and edited ${c.edited}`;
    return `${who[0]} ${what}`;
  }
  const total = [...by.values()].reduce((n, c) => n + c.added + c.edited, 0);
  return `${names(who)} worked on ${plural(total, "page")}`;
}

/**
 * One line under the greeting: what the agents did since you were last on
 * the map, else what one is doing now, else how to start. Pure: the map
 * calls it once, when it first has pages, and keeps the answer.
 */
export function whatsNew(
  pages: GreetPage[],
  since: number | null,
  now?: { name: string; doing: string; where: string } | null,
): string {
  if (since !== null && Number.isFinite(since)) {
    const by = tally(pages, since);
    const line = summary(by, [...by.keys()]);
    if (line) return `${line} since you were here.`;
  }
  if (now) return `${now.name} is ${now.doing} ${now.where}.`;
  return HINT;
}

/** "Just now" for this long after the last change you watched, then "while you were here". */
export const JUST_NOW_MS = 120_000;

/**
 * The greeting's line, held still while you look at it. What happened before
 * you arrived is worked out once and never recounted, so it can't change
 * under you as agents work; what agents do while you're here gets its own
 * line ("Wren added a page just now"), naming them in the order they first
 * did something, so names never swap places.
 */
export class Greeting {
  private frozen: string | null = null;
  /** Newest change already on the map when it opened, in the server's clock. */
  private mark = -Infinity;
  private order: string[] = [];
  private lastSeenAt = 0;
  private counts = "";

  constructor(private since: number | null) {}

  get started() {
    return this.mark !== -Infinity;
  }

  /**
   * `pages`: the map's pages now. `now`: the local clock. `working`: an agent at
   * work right now, if any.
   */
  line(pages: GreetPage[], now: number, working?: { name: string; doing: string; where: string } | null): string {
    if (!this.started) {
      if (!pages.length) return working ? `${working.name} is ${working.doing} ${working.where}.` : HINT;
      this.mark = pages.reduce((m, p) => Math.max(m, Date.parse(p.updatedAt) || -Infinity), -Infinity);
      if (this.mark === -Infinity) this.mark = 0;
      const before = this.since !== null && Number.isFinite(this.since) ? summary(tally(pages, this.since, this.mark), this.namesIn(pages, this.since)) : null;
      this.frozen = before ? `${before} since you were here.` : null;
    }
    const live = tally(pages, this.mark);
    for (const name of live.keys()) if (!this.order.includes(name)) this.order.push(name);
    const key = [...live].map(([n, c]) => `${n}:${c.added}:${c.edited}`).join("|");
    if (key !== this.counts) {
      this.counts = key;
      if (live.size) this.lastSeenAt = now;
    }
    const recent = summary(live, this.order);
    if (recent) return `${recent} ${now - this.lastSeenAt < JUST_NOW_MS ? "just now" : "while you were here"}.`;
    if (this.frozen) return this.frozen;
    if (working) return `${working.name} is ${working.doing} ${working.where}.`;
    return HINT;
  }

  /** Agents in the order they first touched a page after `after`. */
  private namesIn(pages: GreetPage[], after: number): string[] {
    return pages
      .filter((p) => p.updatedBy.kind === "agent" && Date.parse(p.updatedAt) > after)
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
      .map((p) => p.updatedBy.name)
      .filter((n, i, all) => all.indexOf(n) === i);
  }
}
