import { openDatabase, type DatabaseHandle } from "./db.ts";
import { createEventBus, type EventBus } from "./events.ts";
import { createPageStore, type PageStore } from "./pages.ts";
import { createCollab, type CollabService } from "./collab.ts";

export interface Services {
  handle: DatabaseHandle;
  db: DatabaseHandle["db"];
  dataDir: string;
  uploadsDir: string;
  bus: EventBus;
  pages: PageStore;
  collab: CollabService;
  close: () => Promise<void>;
}

/**
 * Composition root. The agent runtime should use the same Services instance
 * as the HTTP server (via main.ts) so live documents and events are shared.
 */
export function createServices(dataDir?: string): Services {
  const handle = openDatabase(dataDir);
  const bus = createEventBus();
  const pages = createPageStore({ db: handle.db, bus });
  const collab = createCollab({ db: handle.db, pages });
  return {
    handle,
    db: handle.db,
    dataDir: handle.dataDir,
    uploadsDir: handle.uploadsDir,
    bus,
    pages,
    collab,
    async close() {
      await collab.close();
      handle.close();
    },
  };
}
