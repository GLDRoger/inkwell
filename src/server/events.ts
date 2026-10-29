import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { Id, ServerEvent } from "../shared/types.ts";
import type { AppEnv } from "./session.ts";

type Listener = (event: ServerEvent) => void;

export interface PresencePerson {
  id: Id;
  name: string;
  pageId: Id | null;
}

export interface EventBus {
  publish: (workspaceId: string, event: ServerEvent) => void;
  subscribe: (workspaceId: string, listener: Listener) => () => void;
  setPresence: (workspaceId: string, person: PresencePerson) => void;
  removePresence: (workspaceId: string, personId: string) => void;
  getPresence: (workspaceId: string) => PresencePerson[];
  subscriberCount: (workspaceId: string) => number;
}

export function createEventBus(): EventBus {
  const listeners = new Map<string, Set<Listener>>();
  const presence = new Map<string, Map<string, PresencePerson>>();

  const publish: EventBus["publish"] = (workspaceId, event) => {
    const set = listeners.get(workspaceId);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(event);
      } catch (err) {
        console.error("[inkwell] event listener failed", err);
      }
    }
  };

  const publishPresence = (workspaceId: string) => {
    const people = [...(presence.get(workspaceId)?.values() ?? [])];
    publish(workspaceId, { type: "presence", people });
  };

  return {
    publish,
    subscribe(workspaceId, listener) {
      let set = listeners.get(workspaceId);
      if (!set) {
        set = new Set();
        listeners.set(workspaceId, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(workspaceId);
      };
    },
    setPresence(workspaceId, person) {
      let map = presence.get(workspaceId);
      if (!map) {
        map = new Map();
        presence.set(workspaceId, map);
      }
      map.set(person.id, person);
      publishPresence(workspaceId);
    },
    removePresence(workspaceId, personId) {
      const map = presence.get(workspaceId);
      if (!map?.delete(personId)) return;
      if (map.size === 0) presence.delete(workspaceId);
      publishPresence(workspaceId);
    },
    getPresence(workspaceId) {
      return [...(presence.get(workspaceId)?.values() ?? [])];
    },
    subscriberCount(workspaceId) {
      return listeners.get(workspaceId)?.size ?? 0;
    },
  };
}

const presenceBody = z.object({
  pageId: z.string().nullable().optional(),
});

/**
 * GET /api/events (SSE) + POST /api/presence.
 * Mount behind the session middleware.
 */
export function createEventsApp(
  bus: EventBus,
  options: { heartbeatMs?: number } = {},
): Hono<AppEnv> {
  const heartbeatMs = options.heartbeatMs ?? 20_000;
  const app = new Hono<AppEnv>();
  // Refcount SSE streams per person so closing one tab doesn't drop presence.
  const streamCounts = new Map<string, number>();

  app.get("/api/events", (c) => {
    const { workspaceId, person } = c.get("ctx");
    const countKey = `${workspaceId}:${person.id}`;
    return streamSSE(c, async (stream) => {
      let closed = false;
      const queue: ServerEvent[] = [];
      let wake: (() => void) | null = null;

      const unsubscribe = bus.subscribe(workspaceId, (event) => {
        queue.push(event);
        wake?.();
      });
      streamCounts.set(countKey, (streamCounts.get(countKey) ?? 0) + 1);
      const existing = bus.getPresence(workspaceId).find((p) => p.id === person.id);
      bus.setPresence(workspaceId, {
        id: person.id,
        name: person.name,
        pageId: existing?.pageId ?? null,
      });

      stream.onAbort(() => {
        closed = true;
        wake?.();
      });

      // One heartbeat timer per stream. An SSE comment keeps proxies and
      // browsers from timing the stream out without polluting ServerEvent.
      let heartbeatDue = false;
      const heartbeat = setInterval(() => {
        heartbeatDue = true;
        wake?.();
      }, heartbeatMs);

      try {
        // setPresence above already queued a presence snapshot for us.
        while (!closed) {
          while (queue.length > 0 && !closed) {
            const event = queue.shift()!;
            await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
          }
          if (heartbeatDue && !closed) {
            heartbeatDue = false;
            await stream.write(": heartbeat\n\n");
          }
          if (closed) break;
          if (queue.length === 0 && !heartbeatDue) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
          wake = null;
        }
      } finally {
        clearInterval(heartbeat);
        unsubscribe();
        const remaining = (streamCounts.get(countKey) ?? 1) - 1;
        if (remaining <= 0) {
          streamCounts.delete(countKey);
          bus.removePresence(workspaceId, person.id);
        } else {
          streamCounts.set(countKey, remaining);
        }
      }
    });
  });

  app.post("/api/presence", async (c) => {
    const { workspaceId, person } = c.get("ctx");
    let raw: unknown = {};
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = presenceBody.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, 400);
    }
    bus.setPresence(workspaceId, {
      id: person.id,
      name: person.name,
      pageId: parsed.data.pageId ?? null,
    });
    return c.body(null, 204);
  });

  return app;
}
