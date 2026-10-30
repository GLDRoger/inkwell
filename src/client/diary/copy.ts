import type { Agent } from "@shared/types";

/**
 * The diary's words in one place. A diary thread is a "conversation" (a "page"
 * is always a notebook page), and the agents are named, not "the diary".
 */
export const COPY = {
  panel: "Diary",
  conversations: "Conversations",
  newConversation: "New conversation",
  untitledConversation: "Untitled conversation",
  anyAgent: "Any agent",
  anyAgentDetail: "Inkwell picks who's best",
  attachPicture: "Attach a picture",
  speak: "Speak your request",
  stopListening: "Stop and transcribe",
  transcribing: "Transcribing…",
  transcribedBy: "Transcribed by Muse Voice",
  /** Muse Voice heard the recording but found no words in it. */
  heardNothing: "Didn't catch that. Try again a little closer to the mic, or type instead.",
  send: "Send",
  stop: "Stop",
  saved: "Your request is saved.",
  tryAgain: "Try again",
  carryOn: "Continue",
  /** Sent when someone taps Continue under a reply that ran out of time or steps. */
  continueRequest: "Please continue from where you stopped.",
  notConnected: "The agents aren't connected yet, so they can't write back. Your request is saved.",
  demoReadOnly: "This is a recorded demo, so you can watch but not write.",
  tryYourself: "Try it yourself",
  demoWaitingTitle: "The demo's conversation will appear here.",
  demoWaiting: "Each request is written in, then the agent writes back.",
} as const;

/**
 * The conversation's name in the diary's header. A conversation the thread
 * list hasn't caught up with yet (the demo's, a moment after it starts) is
 * named after its first request, as the server will name it, not "Untitled".
 */
export function threadTitle(
  title: string | null | undefined,
  threadId: string | null,
  entries: { role: string; text: string }[],
): string {
  if (title?.trim()) return title;
  if (!threadId) return COPY.newConversation;
  const asked = entries.find((e) => e.role === "person" && e.text.trim())?.text.trim();
  if (asked) return asked.replace(/\s+/g, " ").slice(0, 80);
  return entries.length ? COPY.untitledConversation : COPY.newConversation;
}

/** "Ask Scout, Wren or Atlas…", or "Ask Wren…" once someone is picked. */
export function composerPlaceholder(agents: Pick<Agent, "name">[], picked?: Pick<Agent, "name"> | null): string {
  if (picked) return `Ask ${picked.name}…`;
  const names = agents.map((a) => a.name);
  if (!names.length) return "Ask the agents…";
  if (names.length === 1) return `Ask ${names[0]}…`;
  return `Ask ${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}…`;
}

/** A model id as people say it: "muse-spark-1.3-contributor" → "Muse Spark". Unknown means the default, Muse Wonder. */
export function modelName(model: string | null | undefined): string {
  const id = (model ?? "").trim().toLowerCase();
  if (!id) return "Muse Wonder";
  const words = id
    .replace(/[-_]contributor$/, "")
    .replace(/[-_.]?\d[\w.]*$/, "")
    .split(/[-_\s]+/)
    .filter(Boolean);
  if (!words.length) return model!.trim();
  return words.map((w) => (w === "sam" ? "SAM" : w[0].toUpperCase() + w.slice(1))).join(" ");
}

/**
 * Quiet provenance under a finished reply: "Written with Muse Wonder", or
 * "Recorded run · Muse Wonder" for a run replayed in the demo.
 */
export function provenance(run: { model?: string; recorded?: boolean } | null | undefined, agentModel?: string | null): string {
  const name = modelName(run?.model ?? agentModel);
  return run?.recorded ? `Recorded run · ${name}` : `Written with ${name}`;
}

/** One-tap first requests that work against the demo notebook. */
export const STARTERS_NOTEBOOK = [
  "Plan my 5 days in Lisbon",
  "Summarise my reading notes",
  "Turn the launch plan into a checklist",
];

export const STARTERS_PAGE = ["Summarise this page", "Tighten this page", "Link related pages"];
