import type { Id, Run } from "@shared/types";

/**
 * The diary's local lifecycle. Entries themselves live in the query cache
 * (patched by server events); this tracks what the person is doing with them.
 *
 *   idle ──send──▶ sending ──sent──▶ waiting ──reply──▶ writing ──run ends──▶ idle
 *                    │                                              ▲
 *                    └──failed──▶ idle + error (draft restored) ────┘
 *
 * `sinking` runs alongside: the text sinking into the paper after send.
 */
export type DiaryPhase = "idle" | "sending" | "waiting" | "writing";

export interface DiaryError {
  kind: "unavailable" | "failed" | "offline";
  message: string;
  /** What to let go of so a retry can work: a deleted conversation, agent or open page. */
  reset?: "thread" | "agent" | "page";
}

export interface DiaryState {
  phase: DiaryPhase;
  threadId: Id | null;
  agentId: Id | null;
  /** Words sinking into the page (shown over the composer while they fade). */
  sinking: string | null;
  /** The person's entry, hidden from the thread until the sinking finishes. */
  hiddenEntryId: Id | null;
  runId: Id | null;
  /** Entries whose ink should write itself out (they streamed in during this visit). */
  liveEntryIds: Id[];
  error: DiaryError | null;
  /** When a send fails the words come back to the composer. */
  restoreDraft: string | null;
}

export type DiaryAction =
  | { type: "selectThread"; threadId: Id | null }
  | { type: "selectAgent"; agentId: Id | null }
  /** `quiet`: a resend from a failed reply, with nothing sinking from the composer. */
  | { type: "send"; text: string; quiet?: boolean }
  | { type: "sinkDone" }
  | { type: "sent"; threadId: Id; runId: Id; entryId: Id }
  | { type: "sendFailed"; error: DiaryError; text: string }
  | { type: "replyStarted"; entryId: Id; threadId: Id }
  | { type: "runUpdated"; run: Run }
  | { type: "cancelled" }
  | { type: "dismissError" }
  | { type: "draftRestored" }
  /** The request never left (no Meta key yet): put the words back without an error. */
  | { type: "putBack"; text: string };

export const initialDiaryState: DiaryState = {
  phase: "idle",
  threadId: null,
  agentId: null,
  sinking: null,
  hiddenEntryId: null,
  runId: null,
  liveEntryIds: [],
  error: null,
  restoreDraft: null,
};

const ENDED: Run["status"][] = ["succeeded", "failed", "cancelled"];

export function diaryReducer(state: DiaryState, action: DiaryAction): DiaryState {
  switch (action.type) {
    case "selectThread":
      if (state.phase === "sending") return state; // don't switch away mid-send
      return { ...initialDiaryState, agentId: state.agentId, liveEntryIds: state.liveEntryIds, threadId: action.threadId };
    case "selectAgent":
      return { ...state, agentId: action.agentId };
    case "send":
      if (state.phase === "sending" || !action.text.trim()) return state;
      return { ...state, phase: "sending", sinking: action.quiet ? null : action.text, error: null, restoreDraft: null };
    case "sinkDone":
      return { ...state, sinking: null, hiddenEntryId: null };
    case "sent":
      if (state.phase !== "sending") return state;
      return {
        ...state,
        phase: "waiting",
        threadId: action.threadId,
        runId: action.runId,
        hiddenEntryId: state.sinking ? action.entryId : null,
      };
    case "sendFailed":
      return {
        ...state,
        phase: "idle",
        sinking: null,
        hiddenEntryId: null,
        error: action.error,
        restoreDraft: action.text || null,
        threadId: action.error.reset === "thread" ? null : state.threadId,
        agentId: action.error.reset === "agent" ? null : state.agentId,
      };
    case "replyStarted": {
      const live = state.liveEntryIds.includes(action.entryId) ? state.liveEntryIds : [...state.liveEntryIds, action.entryId];
      const ours = action.threadId === state.threadId && state.phase === "waiting";
      return { ...state, liveEntryIds: live, phase: ours ? "writing" : state.phase };
    }
    case "runUpdated":
      if (action.run.id !== state.runId || !ENDED.includes(action.run.status)) return state;
      // A failed run's reason shows under its reply in the thread, not as a second note here.
      return { ...state, phase: "idle", runId: null };
    case "cancelled":
      return { ...state, phase: "idle", runId: null };
    case "dismissError":
      return { ...state, error: null };
    case "draftRestored":
      return { ...state, restoreDraft: null };
    case "putBack":
      return { ...state, phase: "idle", sinking: null, hiddenEntryId: null, restoreDraft: action.text || null };
  }
}

/** Is the agent still busy, so the composer should offer Stop instead of Send? */
export const isBusy = (s: DiaryState) => s.phase === "sending" || s.phase === "waiting" || s.phase === "writing";
