/**
 * The demo scenario (docs/DEMO-MODE.md, "Scenario"). The same definition drives
 * recording (scripts/demo/record.mjs) and replay, so the two can't drift apart.
 */
import type { DemoStep } from "../../shared/types.ts";

export type StepAction =
  /** A person writes to an agent in the diary. */
  | { kind: "ask"; agent: string; prompt: string }
  /** A person speaks to an agent: the bundled recording is transcribed, then sent. */
  | { kind: "voice"; agent: string; audio: string }
  /** Photo to cards on the bundled photo. */
  | { kind: "photo"; image: string }
  /** A Muse Image cover for the first page created in the demo whose title matches. */
  | { kind: "cover"; title: RegExp };

export interface ScenarioStep extends DemoStep { action: StepAction }

export interface ScenarioDefinition {
  id: string;
  title: string;
  steps: ScenarioStep[];
}

export const LISBON_TOUR: ScenarioDefinition = {
  id: "lisbon-tour",
  title: "A tour of Inkwell",
  steps: [
    {
      id: "plan",
      caption: "Wren is planning your Lisbon trip. Watch her walk the map and write.",
      model: "muse-wonder",
      action: {
        kind: "ask", agent: "Wren",
        prompt: "Plan my 5 days in Lisbon. Read the trip pages first, then write the plan as a new page called \"Plan: 5 days in Lisbon\" under Trip to Lisbon, and add a link to it in the itinerary.",
      },
    },
    {
      id: "voice",
      caption: "You can talk to Inkwell too. Muse Voice turns speech into a request for Scout.",
      model: "muse-voice",
      action: { kind: "voice", agent: "Scout", audio: "voice.wav" },
    },
    {
      id: "handoff",
      caption: "Agents hand work to each other: Scout finds the hiring decision, then asks Wren to draft the job post.",
      model: "muse-wonder",
      action: {
        kind: "ask", agent: "Scout",
        prompt: "Find what we decided about hiring, then have Wren draft the job post.",
      },
    },
    {
      id: "photo",
      caption: "Photo to cards: SAM 3.1 finds each sticky note and Muse Wonder reads the handwriting.",
      model: "sam-3.1+muse-wonder",
      action: { kind: "photo", image: "sticky-notes.jpg" },
    },
    {
      id: "cover",
      caption: "Muse Image paints a cover for the new Lisbon plan.",
      model: "muse-image",
      action: { kind: "cover", title: /lisbon/i },
    },
    {
      id: "tidy",
      caption: "Atlas tidies up, linking the new pages into the right parts of the notebook.",
      model: "muse-wonder",
      action: {
        kind: "ask", agent: "Atlas",
        prompt: "Tidy up after today's work: link each new page from the page of the area it belongs to, and back. The photo cards stay where they are under Photo notes, with their titles: link them, don't move or rename them.",
      },
    },
  ],
};

export const SCENARIOS: Record<string, ScenarioDefinition> = { [LISBON_TOUR.id]: LISBON_TOUR };

/** The public view of a step (no prompts or regexes). */
export const publicStep = ({ id, caption, model }: ScenarioStep): DemoStep => ({ id, caption, ...(model ? { model } : {}) });
