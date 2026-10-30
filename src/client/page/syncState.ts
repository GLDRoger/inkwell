import type { CollabStatus } from "./collab";

/**
 * What the save indicator says. The live document only lives in this tab's
 * memory until the server has it, so the copy never promises more than that.
 */
export interface SyncInput {
  status: CollabStatus;
  /** Synced with the server right now. */
  synced: boolean;
  /** Has synced at least once since the page opened. */
  everSynced: boolean;
  /** Local changes the server hasn't confirmed yet. */
  unsynced: number;
  /** When the oldest unconfirmed change was made (ms), or null. */
  pendingSince: number | null;
  /** When the page started connecting, or when the connection last dropped (ms). */
  connectingSince: number;
  now: number;
}

export type SyncTone = "quiet" | "busy" | "bad";
export interface SyncView {
  tone: SyncTone;
  label: string;
  /** Longer explanation, for the tooltip and screen readers. */
  detail?: string;
}

/** Changes the server hasn't taken after this long are treated as not saving. */
export const STUCK_AFTER_MS = 10_000;
/** A dropped connection gets this long to come back before we say "Offline". */
export const OFFLINE_GRACE_MS = 2_000;
/** A first connection that takes longer than this is reported as a problem. */
export const SLOW_CONNECT_MS = 8_000;

export function syncView(s: SyncInput): SyncView {
  if (s.status === "denied")
    return { tone: "bad", label: "Can't open", detail: "This page isn't in your notebook, so it can't be edited here." };

  const online = s.status === "connected";
  if (!online && s.everSynced && s.now - s.connectingSince < OFFLINE_GRACE_MS) return { tone: "busy", label: "Reconnecting…" };
  if (!online && s.everSynced)
    return {
      tone: "bad",
      label: s.unsynced > 0 ? "Offline, not saved yet" : "Offline, keep this tab open",
      detail:
        "Lost the connection. Keep this tab open: your edits are only in this tab until it reconnects, and reloading or closing it loses them.",
    };

  if (!s.everSynced) {
    if (s.now - s.connectingSince > SLOW_CONNECT_MS)
      return { tone: "bad", label: "Can't connect", detail: "Couldn't reach the notebook. Still trying; check your connection." };
    return { tone: "busy", label: "Connecting…" };
  }

  if (s.unsynced > 0 && s.pendingSince != null && s.now - s.pendingSince > STUCK_AFTER_MS)
    return {
      tone: "bad",
      label: "Not saving",
      detail: "The server isn't accepting your latest changes. Copy anything you need, then reload the page.",
    };
  if (s.unsynced > 0 || !s.synced) return { tone: "busy", label: "Saving…" };
  return { tone: "quiet", label: "Saved" };
}
