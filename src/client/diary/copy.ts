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
  send: "Send",
  stop: "Stop",
  saved: "Your words are saved.",
  tryAgain: "Try again",
  carryOn: "Continue",
  /** Sent when someone taps Continue under a reply that ran out of time or steps. */
  continueRequest: "Please continue from where you stopped.",
  notConnected: "The agents aren't connected yet, so they can't write back. Your words are saved.",
} as const;

/** "Ask Scout, Wren or Atlas…", or "Ask Wren…" once someone is picked. */
export function composerPlaceholder(agents: Pick<Agent, "name">[], picked?: Pick<Agent, "name"> | null): string {
  if (picked) return `Ask ${picked.name}…`;
  const names = agents.map((a) => a.name);
  if (!names.length) return "Ask the agents…";
  if (names.length === 1) return `Ask ${names[0]}…`;
  return `Ask ${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}…`;
}

/** A model id as people say it: "muse-spark-1.3" → "Muse Spark". */
export function modelName(model: string | null | undefined): string {
  const id = (model ?? "").trim().toLowerCase();
  if (!id) return "Muse Spark";
  const words = id
    .replace(/[-_.]?\d[\w.]*$/, "")
    .split(/[-_\s]+/)
    .filter(Boolean);
  if (!words.length) return model!.trim();
  return words.map((w) => (w === "sam" ? "SAM" : w[0].toUpperCase() + w.slice(1))).join(" ");
}

/** One-tap first requests that work against the demo notebook. */
export const STARTERS_NOTEBOOK = [
  "Plan my 5 days in Lisbon",
  "Summarise my reading notes",
  "Turn the launch plan into a checklist",
];

export const STARTERS_PAGE = ["Summarise this page", "Tighten this page", "Link related pages"];
