import { describe, expect, it } from "vitest";
import type { Run } from "@shared/types";
import { splitFailure, trailOff } from "./reply";

const run = (status: Run["status"], error: string | null = null): Run => ({
  id: "r1", agentId: "a1", threadId: "t1", parentRunId: null, prompt: "", status, pageId: null, error,
  steps: [], createdAt: "", endedAt: null,
});
const NO_KEY = "The Meta API key isn't configured. Set META_API_KEY to let the agents work.";

describe("splitFailure", () => {
  it("leaves live and finished replies alone", () => {
    expect(splitFailure("Hello", run("running"))).toEqual({ text: "Hello", note: null });
    expect(splitFailure("Done.", run("succeeded"))).toEqual({ text: "Done.", note: null });
    expect(splitFailure("Hi", null)).toEqual({ text: "Hi", note: null });
  });

  it("moves the missing-key message out of the ink", () => {
    expect(splitFailure(NO_KEY, run("failed", NO_KEY))).toEqual({
      text: "",
      note: "The agents aren't connected yet, so they can't write back. Your request is saved.",
    });
  });

  it("keeps what was written before the failure", () => {
    expect(splitFailure("I read Billing.\n\nAgent run timed out.", run("failed", "Agent run timed out."))).toEqual({
      text: "I read Billing.",
      note: "Agent run timed out.",
    });
  });

  it("calls a cancel 'Stopped.'", () => {
    expect(splitFailure("Run cancelled.", run("cancelled", "Run cancelled."))).toEqual({ text: "", note: "Stopped." });
    expect(splitFailure("Half a thought\n\nRun cancelled.", run("cancelled", "Run cancelled."))).toEqual({ text: "Half a thought…", note: "Stopped." });
  });
});

describe("trailOff", () => {
  it("trails a reply cut mid-sentence off with an ellipsis", () => {
    expect(trailOff("Day 1 is Alfama, then the")).toBe("Day 1 is Alfama, then the…");
    expect(trailOff("Day 1 is Alfama,")).toBe("Day 1 is Alfama…");
    expect(trailOff("Start at [Plan](/p/")).toBe("Start at Plan…");
  });
  it("leaves a reply that ended on a whole thought", () => {
    for (const t of ["Day 1 is Alfama.", "Is that right?", "He said “go.”", "**Done.**", "| a | b |\n| --- | --- |\n| 1 | 2 |", "## Day 2", "```\ncode\n```"]) expect(trailOff(t), t).toBe(t);
  });
  it("adds it to a stopped or failed reply, not a finished one", () => {
    expect(splitFailure("Day 1 is\n\nRun cancelled.", run("cancelled", "Run cancelled.")).text).toBe("Day 1 is…");
    expect(splitFailure("Day 1 is", run("failed", "Agent run timed out.")).text).toBe("Day 1 is…");
    expect(splitFailure("Day 1 is", run("succeeded")).text).toBe("Day 1 is");
  });
});
