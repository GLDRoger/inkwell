// @vitest-environment node
import { describe, expect, it } from "vitest";
import { asksToDelete, rootRequest } from "./intent.ts";

describe("asksToDelete", () => {
  it.each([
    "Delete the Recipes page",
    "Please remove Weeknight dinners",
    "Can you get rid of the old photo notes?",
    "Trash those pages.",
    "I'm deleting the hiring draft, do it for me: delete it",
    "Erase the sourdough journal",
    "Wipe these notes",
    "Clear out the empty cards",
    "Apaga a página de receitas",
    "Delete the old links page",
  ])("allows %s", (text) => expect(asksToDelete(text)).toBe(true));
  it.each([
    "Don't delete anything, just tidy",
    "Do not remove any pages",
    "Remove the typos on this page",
    "Clear out the old links",
    "Remove the duplicate lines in the itinerary",
    "Summarise this page for me.",
    "Tidy up after today",
    "What will this trip cost?",
  ])("refuses %s", (text) => expect(asksToDelete(text)).toBe(false));
});

describe("rootRequest", () => {
  it("carries the request a bare yes confirms", () => {
    expect(asksToDelete(rootRequest("yes, go ahead", "Delete the Recipes page"))).toBe(true);
  });
  it("ignores the previous message for a new request", () => {
    expect(rootRequest("Summarise the reading notes", "Delete the Recipes page")).toBe("Summarise the reading notes");
  });
});
