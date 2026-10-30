import { describe, expect, it } from "vitest";
import type { Run } from "@shared/types";
import { diaryReducer, initialDiaryState, isBusy, type DiaryState } from "./state";

const run = (status: Run["status"], extra: Partial<Run> = {}): Run => ({
  id: "r1", agentId: "a1", threadId: "t1", parentRunId: null, prompt: "", status, pageId: null, error: null,
  steps: [], createdAt: "", endedAt: null, ...extra,
});
const reduce = (s: DiaryState, ...actions: Parameters<typeof diaryReducer>[1][]) => actions.reduce(diaryReducer, s);

describe("diaryReducer", () => {
  it("walks a request from send to finished", () => {
    let s = reduce(initialDiaryState, { type: "send", text: "Tidy Billing" });
    expect(s).toMatchObject({ phase: "sending", sinking: "Tidy Billing" });
    expect(isBusy(s)).toBe(true);
    s = reduce(s, { type: "sent", threadId: "t1", runId: "r1", entryId: "e0" });
    expect(s).toMatchObject({ phase: "waiting", threadId: "t1", runId: "r1", hiddenEntryId: "e0" });
    s = reduce(s, { type: "sinkDone" });
    expect(s).toMatchObject({ sinking: null, hiddenEntryId: null });
    s = reduce(s, { type: "replyStarted", entryId: "e1", threadId: "t1" });
    expect(s).toMatchObject({ phase: "writing", liveEntryIds: ["e1"] });
    s = reduce(s, { type: "runUpdated", run: run("succeeded") });
    expect(s).toMatchObject({ phase: "idle", runId: null, error: null });
    expect(isBusy(s)).toBe(false);
  });

  it("ignores empty sends and double sends", () => {
    expect(reduce(initialDiaryState, { type: "send", text: "   " })).toBe(initialDiaryState);
    const s = reduce(initialDiaryState, { type: "send", text: "one" });
    expect(reduce(s, { type: "send", text: "two" })).toBe(s);
  });

  it("gives the words back when sending fails", () => {
    const s = reduce(
      initialDiaryState,
      { type: "send", text: "Draft a plan" },
      { type: "sendFailed", text: "Draft a plan", error: { kind: "unavailable", message: "not yet" } },
    );
    expect(s).toMatchObject({ phase: "idle", sinking: null, restoreDraft: "Draft a plan", error: { kind: "unavailable" } });
    expect(reduce(s, { type: "draftRestored" }).restoreDraft).toBeNull();
  });

  it("settles on a failed run (the reply carries why) and ignores other runs", () => {
    let s = reduce(initialDiaryState, { type: "send", text: "x" }, { type: "sent", threadId: "t1", runId: "r1", entryId: "e0" });
    expect(reduce(s, { type: "runUpdated", run: run("failed", { id: "other" }) })).toBe(s);
    expect(reduce(s, { type: "runUpdated", run: run("running") })).toBe(s);
    s = reduce(s, { type: "runUpdated", run: run("failed", { error: "Model timed out" }) });
    expect(s).toMatchObject({ phase: "idle", runId: null, error: null });
    expect(isBusy(s)).toBe(false);
  });

  it("marks replies on other threads live without changing phase", () => {
    const s = reduce(initialDiaryState, { type: "selectThread", threadId: "t1" }, { type: "replyStarted", entryId: "e9", threadId: "t2" });
    expect(s).toMatchObject({ phase: "idle", liveEntryIds: ["e9"] });
  });

  it("switching threads keeps the chosen agent and live ink, but not mid-send", () => {
    let s = reduce(initialDiaryState, { type: "selectAgent", agentId: "a2" }, { type: "replyStarted", entryId: "e1", threadId: "t1" });
    s = reduce(s, { type: "selectThread", threadId: "t3" });
    expect(s).toMatchObject({ threadId: "t3", agentId: "a2", liveEntryIds: ["e1"] });
    const sending = reduce(s, { type: "send", text: "hi" });
    expect(reduce(sending, { type: "selectThread", threadId: null })).toBe(sending);
  });

  it("stops on cancel", () => {
    const s = reduce(initialDiaryState, { type: "send", text: "x" }, { type: "sent", threadId: "t1", runId: "r1", entryId: "e0" }, { type: "cancelled" });
    expect(s).toMatchObject({ phase: "idle", runId: null });
  });

  it("resends from a failed reply without sinking words from the composer", () => {
    const s = reduce(initialDiaryState, { type: "send", text: "Plan my trip", quiet: true });
    expect(s).toMatchObject({ phase: "sending", sinking: null });
    const failed = reduce(s, { type: "sendFailed", text: "", error: { kind: "offline", message: "x" } });
    expect(failed.restoreDraft).toBeNull();
  });
});
