import type { Page } from "@shared/types";

/** "Good morning." / "Good afternoon." / "Good evening." for a local hour. */
export function hello(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning.";
  if (hour >= 12 && hour < 18) return "Good afternoon.";
  return "Good evening.";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function names(list: string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

export const HINT = "Ask an agent in the Diary, and watch it work here.";

/**
 * One line under the greeting: what the agents did since you were last on
 * the map, else what one is doing now, else how to start.
 */
export function whatsNew(
  pages: Pick<Page, "createdAt" | "updatedAt" | "updatedBy">[],
  since: number | null,
  now?: { name: string; doing: string; where: string } | null,
): string {
  if (since !== null && Number.isFinite(since)) {
    const by = new Map<string, { added: number; edited: number }>();
    for (const p of pages) {
      if (p.updatedBy.kind !== "agent" || !(Date.parse(p.updatedAt) > since)) continue;
      const c = by.get(p.updatedBy.name) ?? { added: 0, edited: 0 };
      if (Date.parse(p.createdAt) > since) c.added++;
      else c.edited++;
      by.set(p.updatedBy.name, c);
    }
    if (by.size === 1) {
      const [[who, c]] = [...by];
      const what =
        c.edited === 0
          ? `added ${plural(c.added, "page")}`
          : c.added === 0
            ? `edited ${plural(c.edited, "page")}`
            : `added ${plural(c.added, "page")} and edited ${c.edited}`;
      return `${who} ${what} since you were here.`;
    }
    if (by.size > 1) {
      const total = [...by.values()].reduce((n, c) => n + c.added + c.edited, 0);
      return `${names([...by.keys()])} worked on ${plural(total, "page")} since you were here.`;
    }
  }
  if (now) return `${now.name} is ${now.doing} ${now.where}.`;
  return HINT;
}
