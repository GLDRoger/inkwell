import { describe, expect, it } from "vitest";
import type { Run } from "@shared/types";
import { askedFor, childRuns, helperState, waitingFor } from "./handoff";

const run = (id: string, extra: Partial<Run> = {}): Run => ({
  id, agentId: "scout", threadId: null, parentRunId: null, prompt: "", status: "running", pageId: null, error: null,
  steps: [], createdAt: "2026-10-30T10:00:00Z", endedAt: null, ...extra,
});
const names: Record<string, string> = { scout: "Scout", wren: "Wren", atlas: "Atlas" };

describe("handoffs", () => {
  it("finds the runs a run asked for help, oldest first", () => {
    const runs = [
      run("r3", { parentRunId: "r1", agentId: "atlas", createdAt: "2026-10-30T10:00:09Z" }),
      run("r1"),
      run("r2", { parentRunId: "r1", agentId: "wren", createdAt: "2026-10-30T10:00:05Z" }),
      run("r4", { parentRunId: "r9" }),
    ];
    expect(childRuns(runs, "r1").map((r) => r.id)).toEqual(["r2", "r3"]);
    expect(childRuns(undefined, "r1")).toEqual([]);
  });

  it("says who it's waiting for while a helper works, and nothing once they're done", () => {
    expect(waitingFor([run("r2", { agentId: "wren" })], (id) => names[id])).toBe("Waiting for Wren…");
    expect(waitingFor([run("r2", { agentId: "wren" }), run("r3", { agentId: "atlas", status: "queued" })], (id) => names[id])).toBe("Waiting for Wren and Atlas…");
    expect(waitingFor([run("r2", { agentId: "wren", status: "succeeded" })], (id) => names[id])).toBeNull();
  });

  it("keeps what was asked to one short sentence", () => {
    expect(askedFor("Draft a job post for a founding engineer.  Use the Hiring plan page (id p1).")).toBe("Draft a job post for a founding engineer.");
    const long = askedFor("Please draft ".concat("a very long request ".repeat(20)), 60);
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("…")).toBe(true);
    expect(askedFor("   ")).toBe("");
    expect(askedFor("Draft a job post based on what the notebook decided, using the page [Hiring plan](/p/aWZv) (page id: aWZv). Keep it short.")).toBe(
      "Draft a job post based on what the notebook decided, using the page Hiring plan.",
    );
  });

  it("names the helper's state plainly", () => {
    expect(helperState(run("r", { status: "running" }))).toBe("is working on it…");
    expect(helperState(run("r", { status: "succeeded" }))).toBe("finished");
    expect(helperState(run("r", { status: "failed" }))).toBe("couldn't finish");
  });
});
