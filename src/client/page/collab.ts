import { useEffect, useState } from "react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { getDemo } from "../lib/demo";

export type CollabStatus = "connecting" | "connected" | "disconnected" | "denied";

export interface Collab {
  provider: HocuspocusProvider;
  doc: Y.Doc;
}

export interface CollabState {
  collab: Collab | null;
  status: CollabStatus;
  synced: boolean;
  everSynced: boolean;
  unsynced: number;
  /** When unconfirmed changes started piling up, or null when there are none. */
  pendingSince: number | null;
  /** When the page started connecting, or when the connection last dropped. */
  connectingSince: number;
}

/** The demo notebook's pages are opened with ?notebook=demo (read-only on the server). */
export const collabUrl = () =>
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/collab${getDemo().notebook === "demo" ? "?notebook=demo" : ""}`;

const initial = (): Omit<CollabState, "collab"> => ({
  status: "connecting",
  synced: false,
  everSynced: false,
  unsynced: 0,
  pendingSince: null,
  connectingSince: Date.now(),
});

/**
 * One live Yjs document per page over Hocuspocus. The session cookie rides on
 * the websocket upgrade, so the token is only a placeholder for servers that
 * require one to be present.
 *
 * The document is kept in memory only: edits made while offline survive as
 * long as this tab stays open, and are sent when the connection comes back.
 */
export function useCollab(pageId: string): CollabState {
  const [collab, setCollab] = useState<Collab | null>(null);
  const [state, setState] = useState(initial);

  useEffect(() => {
    const doc = new Y.Doc();
    setState(initial());
    const patch = (fn: (s: Omit<CollabState, "collab">) => Partial<Omit<CollabState, "collab">>) =>
      setState((s) => ({ ...s, ...fn(s) }));
    const provider = new HocuspocusProvider({
      url: collabUrl(),
      name: pageId,
      document: doc,
      token: "session",
      onStatus: ({ status }) =>
        patch((s) => {
          if (s.status === "denied") return {};
          const next = status as CollabStatus;
          return {
            status: next,
            // Not synced again until the server has answered on the new connection.
            synced: next === "connected" ? s.synced : false,
            connectingSince: s.status === "connected" && next !== "connected" ? Date.now() : s.connectingSince,
          };
        }),
      onSynced: ({ state }) => patch((s) => ({ synced: state, everSynced: s.everSynced || state })),
      onAuthenticationFailed: () => patch(() => ({ status: "denied" })),
      onUnsyncedChanges: ({ number }) =>
        patch((s) => ({ unsynced: number, pendingSince: number > 0 ? (s.pendingSince ?? Date.now()) : null })),
    });
    setCollab({ provider, doc });
    return () => {
      provider.destroy();
      doc.destroy();
      setCollab(null);
    };
  }, [pageId]);

  return { collab, ...state };
}
