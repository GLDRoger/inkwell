import { AgentRuntime, type RuntimeOptions } from "./agents/runtime.ts";
import { IDLE_WORKSPACE_DAYS, startJanitor } from "./janitor.ts";
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
  runtime: AgentRuntime;
  close: () => Promise<void>;
}

/**
 * Composition root. The agent runtime should use the same Services instance
 * as the HTTP server (via main.ts) so live documents and events are shared.
 */
export function createServices(dataDir?: string, runtimeOptions: RuntimeOptions = {}): Services {
  const handle = openDatabase(dataDir);
  const bus = createEventBus();
  const pages = createPageStore({ db: handle.db, bus });
  const collab = createCollab({ db: handle.db, pages });
  const runtime = new AgentRuntime({ db: handle.db, pages, collab, bus, uploadsDir: handle.uploadsDir }, runtimeOptions);
  const services: Services = {
    handle,
    db: handle.db,
    dataDir: handle.dataDir,
    uploadsDir: handle.uploadsDir,
    bus,
    pages,
    collab,
    runtime,
    async close() {
      await stopJanitor();
      await runtime.close();
      await collab.close();
      handle.close();
    },
  };
  const stopJanitor = startJanitor(services, { maxIdleDays: IDLE_WORKSPACE_DAYS });
  return services;
}
