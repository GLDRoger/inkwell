import { describe, expect, it } from "vitest";
import type { Page } from "@shared/types";
import { plainSnippet, rankPages } from "./CommandPalette";

const p = (id: string, title: string, updatedAt = "2026-10-29T10:00:00Z"): Page => ({
  id, title, parentId: null, icon: null, position: "a", excerpt: "", x: null, y: null, coverUrl: null,
  createdAt: "", updatedAt, updatedBy: { kind: "person", id: "u", name: "U" },
});

describe("rankPages", () => {
  const pages = [p("1", "Checklists"), p("2", "Lisbon itinerary"), p("3", "Trip to Lisbon"), p("4", "Weeknight dinners", "2026-10-29T12:00:00Z")];
  it("puts title prefixes before word starts before substrings", () => {
    expect(rankPages(pages, "lis").map((x) => x.id)).toEqual(["2", "3", "1"]);
  });
  it("shows the most recently edited pages for an empty query", () => {
    expect(rankPages(pages, "", 2)[0].id).toBe("4");
  });
});

describe("plainSnippet", () => {
  it("reads markdown as plain words", () => {
    expect(plainSnippet("# Packing & logistics Bookings for [Trip to Lisbon](/p/abc) - [ ] **Pasta** `x`")).toBe(
      "Packing & logistics Bookings for Trip to Lisbon Pasta x",
    );
  });
});
