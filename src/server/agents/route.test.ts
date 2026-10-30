// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Agent } from "../../shared/types.ts";
import { pickAgent } from "./route.ts";

const agents = ["Scout", "Wren", "Atlas"].map(name => ({ id: name.toLowerCase(), name }) as Agent);
const pick = (text: string) => pickAgent(agents, text)?.name;

describe("Any agent picks who's best", () => {
  it.each([
    ["Summarise my reading notes", "Scout"],
    ["What did I write about fundraising?", "Scout"],
    ["Draft a packing checklist for Lisbon", "Wren"],
    ["Polish the hiring plan", "Wren"],
    ["Plan my 3 days in Lisbon", "Wren"],
    ["Tidy up the recipes section and link related pages", "Atlas"],
    ["Rename the roadmap page", "Atlas"],
    ["Ask Wren to summarise the launch plan", "Wren"],
    ["hello", "Scout"],
    // Polite questions and everyday words (review of 2026-10-30).
    ["Can you write a packing list for Lisbon?", "Wren"],
    ["Could you draft an email to my landlord?", "Wren"],
    ["Can you polish the hiring plan?", "Wren"],
    ["Fix the typos on this page", "Wren"],
    ["Add a section on budget to the Lisbon trip", "Wren"],
    ["Draft an email to the movers about the move date", "Wren"],
    ["Write a blog post about how I file my taxes", "Wren"],
    ["Summarise the file I uploaded", "Scout"],
    ["Write up what we decided about the move", "Wren"],
    ["Please organise my recipes", "Atlas"],
    ["Could you move the hiring plan under the launch plan?", "Atlas"],
    ["This notebook is messy, can you sort it out", "Atlas"],
    ["Where did I write about Sintra?", "Scout"],
    ["What should I pack?", "Scout"],
    ["Turn the launch plan into a checklist", "Wren"],
    ["Compare my two fundraising options", "Scout"],
    // Real Muse Wonder eval (2026-10-30): the verb can open a later sentence.
    ["Here is a photo of our whiteboard. Turn it into a page with action items.", "Wren"],
    ["I just got back from the offsite. Organise the notes into the launch plan.", "Atlas"],
    ["Big week ahead. Summarise what's left on the roadmap", "Scout"],
  ])("%s -> %s", (text, name) => expect(pick(text)).toBe(name));

  it("sends an attached image to Wren unless an agent is named", () => {
    const image = (text: string) => pickAgent(agents, text, { image: true })?.name;
    expect(image("Here is a photo of our offsite whiteboard. Turn it into a page with action items and link it from the launch plan.")).toBe("Wren");
    expect(image("What's on this whiteboard?")).toBe("Wren");
    expect(image("Ask Scout what this photo says")).toBe("Scout");
  });
});
