import { describe, expect, it } from "vitest";
import type { Run, RunStep } from "@shared/types";
import { failNote, isFiller, noteText, splitFiller, stopNote, stripQuotedFiller, tidyReply, workDone } from "./tidy";

const step = (tool: string, summary: string, pageId: string | null = null, ok = true): RunStep => ({ at: "", tool, summary, pageId, ok });
const run = (status: Run["status"], steps: RunStep[] = [], extra: Partial<Run> = {}): Run => ({
  id: "r1", agentId: "scout", threadId: "t1", parentRunId: null, prompt: "", status, pageId: null, error: null,
  steps, createdAt: "", endedAt: null, ...extra,
});
const searched = [step("search_pages", "Searched for lisbon")];

describe("isFiller", () => {
  it("recognises narration before the work starts", () => {
    for (const t of [
      "Looking through the notebook for material.",
      "Gathering the pages for this.",
      "Let me find the right page before I bring in Wren.",
      "Taking a look at how the notebook is laid out.",
      "Okay, searching the notebook.",
      "Looking thr",
    ]) expect(isFiller(t), t).toBe(true);
  });
  it("leaves real answers alone", () => {
    for (const t of [
      "Nothing in your notebook mentions Lisbon.",
      "Looking at your notes, the trip is five days.",
      "Drafted [Packing list](/p/1) under Lisbon.",
      "Done. I tidied Billing.",
      "Morning flights are cheaper.",
      "Here's the plan.",
    ]) expect(isFiller(t), t).toBe(false);
  });
});

describe("splitFiller", () => {
  it("splits the opening line from the reply", () => {
    expect(splitFiller("Gathering the pages for this.\n\nHere's the summary.")).toEqual({ filler: "Gathering the pages for this.", rest: "Here's the summary." });
    expect(splitFiller("Gathering the pages for this.")).toEqual({ filler: "Gathering the pages for this.", rest: "" });
    expect(splitFiller("Here's the summary.\n\nMore.")).toEqual({ filler: null, rest: "Here's the summary.\n\nMore." });
  });
});

describe("tidyReply", () => {
  it("drops the narration once the real reply follows it", () => {
    expect(tidyReply("Looking through the notebook for material.\n\nDrafted [Plan](/p/1).", run("succeeded", searched))).toEqual({
      text: "Drafted [Plan](/p/1).",
      status: null,
    });
  });
  it("shows the narration as a status while the agent works", () => {
    expect(tidyReply("Looking through the notebook for material.", run("running", searched))).toEqual({
      text: "",
      status: "Looking through the notebook for material.",
    });
  });
  it("drops lone narration from a failed or stopped reply", () => {
    expect(tidyReply("Gathering the pages for this.", run("failed", searched)).text).toBe("");
    expect(tidyReply("Gathering the pages for this.", run("cancelled", searched)).text).toBe("");
  });
  it("keeps a one-line answer that happens to read like narration", () => {
    expect(tidyReply("Looking good: nothing to change.", run("succeeded", searched)).text).toBe("Looking good: nothing to change.");
    expect(tidyReply("Searching is fast here.", run("succeeded")).text).toBe("Searching is fast here.");
    expect(tidyReply("Gathering the pages for this.\n\nDone.", null).text).toBe("Gathering the pages for this.\n\nDone.");
  });
  it("drops the narration that opens a quoted report", () => {
    const text =
      "I found [Weeknight dinners](/p/w) and handed it to Wren. Their report:\n\n> Looking through the notebook for material.\n>\n> Drafted [Plan](/p/p). Ask me to expand any step.";
    expect(tidyReply(text, run("succeeded", searched)).text).toBe(
      "I found [Weeknight dinners](/p/w) and handed it to Wren. Their report:\n\n> Drafted [Plan](/p/p). Ask me to expand any step.",
    );
    expect(stripQuotedFiller("> Just a quote.")).toBe("> Just a quote.");
  });
});

describe("stop note", () => {
  const names = (id: string) => ({ scout: "Scout", wren: "Wren" })[id] ?? "?";
  it("says nothing changed when the agent hadn't written yet", () => {
    expect(noteText(stopNote(workDone(run("cancelled", searched)), names))).toBe("Stopped before any pages changed.");
  });
  it("names the pages already made or changed, including by the agent it asked", () => {
    const parent = run("cancelled", [...searched, step("create_page", "Created Lisbon notes", "p1"), step("edit_page", "Edited Lisbon notes", "p1"), step("ask_agent", "Asked Wren for help")]);
    const child = run("cancelled", [step("create_page", "Created Packing list", "p2"), step("append_to_page", "Added to Trip to Lisbon", "p3"), step("edit_page", "Edited Other", "p4", false)], {
      id: "r2", agentId: "wren", parentRunId: "r1",
    });
    const parts = stopNote(workDone(parent, [child]), names);
    expect(noteText(parts)).toBe("Stopped. Scout had already made Lisbon notes. Wren had already made Packing list and changed Trip to Lisbon.");
    expect(parts.filter((p) => typeof p !== "string")).toEqual([
      { pageId: "p1", title: "Lisbon notes" },
      { pageId: "p2", title: "Packing list" },
      { pageId: "p3", title: "Trip to Lisbon" },
    ]);
  });
  it("shortens a long list", () => {
    const steps = ["A", "B", "C", "D", "E"].map((t, i) => step("create_page", `Created ${t}`, `p${i}`));
    expect(noteText(stopNote(workDone(run("cancelled", steps)), names))).toBe("Stopped. Scout had already made A, B and 3 more pages.");
  });
});

describe("nested reports", () => {
  it("drops narration at every level of quoting", () => {
    expect(stripQuotedFiller("> I found X and handed it to Scout. Their report:\n>\n> > Searching the notebook.\n> >\n> > From X: five days.")).toBe(
      "> I found X and handed it to Scout. Their report:\n>\n> > From X: five days.",
    );
  });
});

describe("failNote", () => {
  const nameOf = (id: string) => (id === "scout" ? "Scout" : "Wren");
  it("says what a failed run had already made, like a stop does", () => {
    const work = workDone(run("failed", [step("create_page", "Created Summary: Startup: launch plan", "p1")]));
    expect(noteText(failNote("Muse Spark couldn't finish this one.", work, nameOf))).toBe(
      "Muse Spark stopped partway. Scout had already made Summary: Startup: launch plan.",
    );
    expect(failNote("Inkwell restarted while this was being written.", work, nameOf)).toContainEqual({ pageId: "p1", title: "Summary: Startup: launch plan" });
    expect(noteText(failNote("Inkwell restarted while this was being written.", work, nameOf))).toBe(
      "Inkwell restarted while this was being written. Scout had already made Summary: Startup: launch plan.",
    );
  });
  it("gives just the reason when nothing changed", () => {
    expect(noteText(failNote("Muse Spark couldn't finish this one.", workDone(run("failed", searched)), nameOf))).toBe("Muse Spark couldn't finish this one.");
  });
});
