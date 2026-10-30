import { describe, expect, it } from "vitest";
import { hello, HINT, whatsNew } from "./greeting";

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
});
