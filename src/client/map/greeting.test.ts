import { describe, expect, it } from "vitest";
import { Greeting, hello, HINT, JUST_NOW_MS, whatsNew } from "./greeting";

const at = (iso: string) => Date.parse(iso);
const page = (by: string, kind: "agent" | "person", created: string, updated: string) => ({
  createdAt: created,
  updatedAt: updated,
  updatedBy: { kind, id: by, name: by },
});

describe("greeting", () => {
  it("says hello for the time of day", () => {
    expect(hello(8)).toBe("Good morning.");
    expect(hello(14)).toBe("Good afternoon.");
    expect(hello(21)).toBe("Good evening.");
    expect(hello(2)).toBe("Good evening.");
  });

  it("counts what one agent added since the last visit", () => {
    const since = at("2026-10-30T10:00:00Z");
    const pages = [
      page("Wren", "agent", "2026-10-30T11:00:00Z", "2026-10-30T11:00:00Z"),
      page("Wren", "agent", "2026-10-30T11:05:00Z", "2026-10-30T11:06:00Z"),
      page("Wren", "agent", "2026-10-29T11:05:00Z", "2026-10-29T11:06:00Z"),
      page("You", "person", "2026-10-30T11:05:00Z", "2026-10-30T11:06:00Z"),
    ];
    expect(whatsNew(pages, since)).toBe("Wren added 2 pages since you were here.");
  });

  it("names several agents together", () => {
    const since = at("2026-10-30T10:00:00Z");
    const pages = [
      page("Wren", "agent", "2026-10-30T11:00:00Z", "2026-10-30T11:00:00Z"),
      page("Scout", "agent", "2026-10-20T11:00:00Z", "2026-10-30T11:00:00Z"),
      page("Atlas", "agent", "2026-10-20T11:00:00Z", "2026-10-30T12:00:00Z"),
    ];
    expect(whatsNew(pages, since)).toBe("Wren, Scout and Atlas worked on 3 pages since you were here.");
  });

  it("falls back to what's happening now, then to a hint", () => {
    expect(whatsNew([], null, { name: "Scout", doing: "writing in", where: "Product roadmap" })).toBe(
      "Scout is writing in Product roadmap.",
    );
    expect(whatsNew([], null)).toBe(HINT);
  });

  it("says a page, not 1 pages", () => {
    const since = at("2026-10-30T10:00:00Z");
    expect(whatsNew([page("Wren", "agent", "2026-10-30T11:00:00Z", "2026-10-30T11:00:00Z")], since)).toBe(
      "Wren added a page since you were here.",
    );
  });
});

describe("the greeting holds still while you watch", () => {
  const since = at("2026-10-30T10:00:00Z");
  const before = [
    page("Wren", "agent", "2026-10-30T11:00:00Z", "2026-10-30T11:00:00Z"),
    page("Scout", "agent", "2026-10-20T11:00:00Z", "2026-10-30T11:30:00Z"),
  ];
  const T = at("2026-10-30T12:00:00Z");

  it("counts what happened before you arrived once, and never recounts it", () => {
    const g = new Greeting(since);
    expect(g.line(before, T)).toBe("Wren and Scout worked on 2 pages since you were here.");
    // An agent at work doesn't replace it.
    expect(g.line(before, T + 1000, { name: "Atlas", doing: "reading", where: "Recipes" })).toBe(
      "Wren and Scout worked on 2 pages since you were here.",
    );
  });

  it("says what agents do while you're here, naming them in the order they started", () => {
    const g = new Greeting(since);
    g.line(before, T);
    const scoutNow = page("Scout", "agent", "2026-10-30T12:00:05Z", "2026-10-30T12:00:05Z");
    expect(g.line([...before, scoutNow], T + 5000)).toBe("Scout added a page just now.");
    const wrenNow = page("Wren", "agent", "2026-10-30T12:00:09Z", "2026-10-30T12:00:09Z");
    const many = [...before, scoutNow, wrenNow];
    expect(g.line(many, T + 9000)).toBe("Scout and Wren worked on 2 pages just now.");
    // Scout edits again later: the names keep their places.
    const scoutAgain = { ...scoutNow, updatedAt: "2026-10-30T12:00:20Z" };
    expect(g.line([...before, scoutAgain, wrenNow], T + 20_000)).toBe("Scout and Wren worked on 2 pages just now.");
    // Some minutes on, it's no longer "just now".
    expect(g.line([...before, scoutAgain, wrenNow], T + 20_000 + JUST_NOW_MS)).toBe(
      "Scout and Wren worked on 2 pages while you were here.",
    );
  });

  it("falls back to what's happening now, then to the hint, on a first visit", () => {
    const g = new Greeting(null);
    const seed = [page("Atlas", "agent", "2026-10-29T11:00:00Z", "2026-10-29T11:00:00Z")];
    expect(g.line(seed, T, { name: "Scout", doing: "reading", where: "Recipes" })).toBe("Scout is reading Recipes.");
    expect(g.line(seed, T)).toBe(HINT);
  });
});

