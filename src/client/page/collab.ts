import { useEffect, useState } from "react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

export type CollabStatus = "connecting" | "connected" | "disconnected" | "denied";

export interface Collab {
  provider: HocuspocusProvider;
  doc: Y.Doc;
}

export const collabUrl = () => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/collab`;

/**
 * One live Yjs document per page over Hocuspocus. The session cookie rides on
 * the websocket upgrade, so the token is only a placeholder for servers that
 * require one to be present.
 */
export function useCollab(pageId: string) {
  const [collab, setCollab] = useState<Collab | null>(null);
  const [status, setStatus] = useState<CollabStatus>("connecting");
  const [synced, setSynced] = useState(false);
  const [unsynced, setUnsynced] = useState(0);

  useEffect(() => {
    const doc = new Y.Doc();
    setStatus("connecting");
    setSynced(false);
    const provider = new HocuspocusProvider({
      url: collabUrl(),
      name: pageId,
      document: doc,
      token: "session",
      onStatus: ({ status }) => setStatus((prev) => (prev === "denied" ? prev : (status as CollabStatus))),
      onSynced: ({ state }) => setSynced(state),
      onAuthenticationFailed: () => setStatus("denied"),
      onUnsyncedChanges: ({ number }) => setUnsynced(number),
    });
    setCollab({ provider, doc });
    return () => {
      provider.destroy();
      doc.destroy();
      setCollab(null);
    };
  }, [pageId]);

  return { collab, status, synced, unsynced };
}
