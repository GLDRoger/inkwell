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
  /** The browser thinks it has a network (navigator.onLine). Defaults to true. */
  browserOnline?: boolean;
  /**
   * Watching, not writing (the recorded demo). Nothing here is the viewer's
   * to save: the server ignores local changes (the editor's own normalising,
   * say), so they never count as unsaved work.
   */
  readOnly?: boolean;
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

export type OfflineKind = "offline" | "unreachable";

/**
 * The one explanation for being cut off, shared by the page's save status and
 * the shell's connection notice so they never disagree. Edits made meanwhile
 * live only in this tab's memory and are sent when the connection returns.
 */
export function offlineMessage(kind: OfflineKind, where: "page" | "map"): string {
  if (where === "page")
    return kind === "offline"
      ? "You're offline. Keep this tab open and your edits will save when you're back online."
      : "Can't reach your notebook. Keep this tab open and your edits will save when it's back.";
  return kind === "offline" ? "You're offline. Inkwell will reconnect when you're back online." : "Can't reach your notebook. Trying again…";
}

export function syncView(s: SyncInput): SyncView {
  if (s.readOnly) return s.everSynced ? { tone: "quiet", label: "Read only" } : { tone: "quiet", label: "Opening…" };
  if (s.status === "denied")
    return { tone: "bad", label: "Can't open", detail: "This page isn't in your notebook, so it can't be edited here." };

  // The browser knows it's offline before the socket notices; believe it straight away.
  const browserOffline = s.browserOnline === false;
  const online = s.status === "connected" && !browserOffline;
  if (!online && !browserOffline && s.everSynced && s.now - s.connectingSince < OFFLINE_GRACE_MS) return { tone: "busy", label: "Reconnecting…" };
  if (!online && (s.everSynced || browserOffline)) {
    const kind: OfflineKind = browserOffline ? "offline" : "unreachable";
    const state = kind === "offline" ? "Offline" : "Not connected";
    return { tone: "bad", label: s.unsynced > 0 ? `${state}, not saved yet` : state, detail: offlineMessage(kind, "page") };
  }

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

/** Ask before a reload or close only when there are edits of yours the server hasn't got. */
export function warnBeforeUnload(s: Pick<SyncInput, "unsynced" | "readOnly">): boolean {
  return !s.readOnly && s.unsynced > 0;
}
