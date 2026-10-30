/**
 * The demo scenario (docs/DEMO-MODE.md, "Scenario"). The same definition drives
 * recording (scripts/demo/record.mjs) and replay, so the two can't drift apart.
 */
import type { DemoStep } from "../../shared/types.ts";

export type StepAction =
  /**
   * A person writes to an agent in the diary. `prompt` is what the person types, as a
   * person would type it; `guidance` steers the recording through the agent's system
   * prompt (never shown in the diary, not passed to child runs).
   */
  | { kind: "ask"; agent: string; prompt: string; guidance?: string }
  /** A person speaks to an agent: the bundled recording is transcribed, then sent. */
  | { kind: "voice"; agent: string; audio: string }
  /** Photo to cards on the bundled photo. */
  | { kind: "photo"; image: string }
  /** A Muse Image cover for the first page created in the demo whose title matches. */
  | { kind: "cover"; title: RegExp };

export interface ScenarioStep extends DemoStep {
  action: StepAction;
  /** Shortest time the step stays on screen in replay, including the pause after it (scaled by pace). */
  minMs?: number;
}

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
        prompt: "Plan my 5 days in Lisbon",
        guidance: "For this request: read the trip pages first. Write the plan as one new page titled \"Plan: 5 days in Lisbon\" under Trip to Lisbon, one short section per day, and add a link to it in the Lisbon itinerary.",
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
        prompt: "What did we decide about hiring? Get Wren to draft the job post",
        guidance: "For this request: find the hiring decision in the notebook, then ask Wren with ask_agent to draft the job post for the first role as a new page under Hiring plan. Reply with what was decided and a link to Wren's draft.",
      },
    },
    {
      id: "photo",
      caption: "Photo to cards: SAM 3.1 finds each sticky note and Muse Wonder reads the handwriting.",
      model: "sam-3.1+muse-wonder",
      action: { kind: "photo", image: "sticky-notes.jpg" },
      minMs: 14_000,
    },
    {
      id: "cover",
      caption: "Muse Image makes a cover for the new Lisbon plan.",
      model: "muse-image",
      action: { kind: "cover", title: /lisbon/i },
      minMs: 14_000,
    },
    {
      id: "tidy",
      caption: "Atlas tidies up, linking the new pages into the right parts of the notebook.",
      model: "muse-wonder",
      action: {
        kind: "ask", agent: "Atlas",
        prompt: "Can you tidy up after today?",
        guidance: "For this request: today's new pages are the Lisbon plan, the reading summary, the job post and the photo cards. Call list_pages once, read only those pages and the area pages they belong to, and don't ask other agents. Link each new page from its area page and back. Only add links: don't move or rename any page, and leave the photo cards under Photo notes with their titles.",
      },
    },
  ],
};

export const SCENARIOS: Record<string, ScenarioDefinition> = { [LISBON_TOUR.id]: LISBON_TOUR };

/** The public view of a step (no prompts or regexes). */
export const publicStep = ({ id, caption, model }: ScenarioStep): DemoStep => ({ id, caption, ...(model ? { model } : {}) });
