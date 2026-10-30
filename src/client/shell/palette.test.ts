import { describe, expect, it } from "vitest";
import type { Page } from "@shared/types";
import { actionDefs, actionScore, entryKey, mentionsAll, paletteEntries, plainSnippet, rankPages } from "./paletteModel";

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

describe("palette entries", () => {
  const pages = [p("1", "Trip to Lisbon"), p("2", "Reading list"), p("3", "Dark patterns essay")];
  const actions = actionDefs({ theme: "light", here: null });
  const keysFor = (q: string, hits: { page: Page; snippet: string }[] = []) => paletteEntries({ q, pages, actions, hits }).map(entryKey);

  it("lists every action when nothing is typed", () => {
    expect(keysFor("")).toEqual(expect.arrayContaining(["diary", "new", "map", "photo", "theme", "about", "welcome"]));
  });

  it("doesn't offer to open the map while you're on it", () => {
    expect(actionDefs({ theme: "light", onMap: true }).map((a) => a.id)).not.toContain("map");
    expect(actionDefs({ theme: "light", onMap: false }).map((a) => a.id)).toContain("map");
  });

  it("filters actions by what you type", () => {
    const keys = keysFor("photo");
    expect(keys).toContain("photo");
    expect(keys).not.toContain("diary");
    expect(keys).not.toContain("theme");
  });

  it("finds the theme toggle by dark, light, theme or mode, labelled by what it switches to", () => {
    for (const q of ["dark", "light", "theme", "mode"]) expect(keysFor(q)).toContain("theme");
    expect(actions.find((a) => a.id === "theme")!.label).toBe("Dark mode");
    expect(actionDefs({ theme: "dark" }).find((a) => a.id === "theme")!.label).toBe("Light mode");
  });

  it("puts a matching page first, with Ask offered below it rather than as the Enter default", () => {
    const keys = keysFor("lisbon");
    expect(keys[0]).toBe("page-1");
    expect(keys[1]).toBe("map-1"); // Show on the map
    expect(keys).toContain("ask");
    expect(keys.indexOf("ask")).toBeGreaterThan(0);
  });

  it("puts an action that starts with the query before pages that only contain it", () => {
    // "Dark patterns essay" starts with "dark" too, so the page still wins there…
    expect(keysFor("dark")[0]).toBe("page-3");
    // …but "theme" only matches the action.
    expect(keysFor("theme")[0]).toBe("theme");
  });

  it("makes Ask the first option only when nothing else matches", () => {
    const keys = keysFor("what should I pack for a rainy weekend");
    expect(keys[0]).toBe("ask");
    expect(keys[1]).toBe("new-titled");
  });

  it("shows full-text hits last, so the highlighted row doesn't jump when they arrive", () => {
    const keys = keysFor("custard", [{ page: pages[0], snippet: "pastel de nata, custard tarts" }]);
    expect(keys).toEqual(["ask", "new-titled", "page-1"]);
  });

  it("calls hits 'Related' unless they have every word typed", () => {
    const sectionOf = (q: string, hits: { page: Page; snippet: string }[]) =>
      paletteEntries({ q, pages, actions, hits }).filter((e) => e.kind === "page" && e.page.id === hits[0].page.id).map((e) => e.section);
    expect(sectionOf("Audit test page", [{ page: pages[0], snippet: "This page is the hub; the details live in the child pages." }])).toEqual(["Related"]);
    expect(sectionOf("custard tarts", [{ page: pages[0], snippet: "pastel de nata, custard tarts" }])).toEqual(["Mentioned in"]);
    expect(sectionOf("custard", [{ page: pages[0], snippet: "a list of desserts" }])).toEqual(["Mentioned in"]);
    expect(mentionsAll({ page: pages[0], snippet: "Pastéis, custard tartlets" }, "custard tart")).toBe(true);
  });

  it("doesn't offer to make a page whose title already exists", () => {
    expect(keysFor("reading list")).not.toContain("new-titled");
  });

  it("scores actions by prefix of name or keyword", () => {
    const theme = actions.find((a) => a.id === "theme")!;
    expect(actionScore(theme, "dar")).toBe(0);
    expect(actionScore(theme, "zebra")).toBe(-1);
  });
});
