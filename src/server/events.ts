import { Hono } from 'hono';
import { z } from 'zod';
import type { Id, ServerEvent } from '../shared/types.ts';
import type { AppEnv } from './session.ts';
import type { PageStore } from './pages.ts';
import { jsonBodyLimit } from './limits.ts';

type Listener = (event: ServerEvent) => void;
export interface PresencePerson { id: Id; name: string; pageId: Id | null }
export interface EventBus {
  publish: (workspaceId: string, event: ServerEvent) => void;
  subscribe: (workspaceId: string, listener: Listener) => () => void;
  setPresence: (workspaceId: string, person: PresencePerson) => void;
  removePresence: (workspaceId: string, personId: string) => void;
  getPresence: (workspaceId: string) => PresencePerson[];
  subscriberCount: (workspaceId: string) => number;
  onClose: (callback: () => void) => () => void;
  close: () => void;
}

export function createEventBus(): EventBus {
  const listeners = new Map<string, Set<Listener>>();
  const presence = new Map<string, Map<string, { person: PresencePerson; expires: number }>>();
  const closers = new Set<() => void>();
  let presenceCount = 0;
  const publish: EventBus['publish'] = (workspaceId, event) => {
    for (const fn of [...(listeners.get(workspaceId) ?? [])]) {
      try { fn(event); } catch (err) { console.error('[inkwell] event listener failed', err); }
    }
  };
  const getPresence = (workspaceId: string) => [...(presence.get(workspaceId)?.values() ?? [])].map(v => v.person);
  const publishPresence = (workspaceId: string) => publish(workspaceId, { type: 'presence', people: getPresence(workspaceId) });
  const removePresence = (workspaceId: string, personId: string) => {
    const map = presence.get(workspaceId);
    if (!map?.delete(personId)) return;
    presenceCount--;
    if (!map.size) presence.delete(workspaceId);
    publishPresence(workspaceId);
  };
  const sweep = setInterval(() => {
    for (const [workspaceId, map] of presence) {
      for (const [id, entry] of map) if (entry.expires <= Date.now()) removePresence(workspaceId, id);
    }
  }, 10_000);
  sweep.unref();
  return {
    publish, getPresence, removePresence,
    subscribe(workspaceId, listener) {
      let set = listeners.get(workspaceId);
      if (!set) { set = new Set(); listeners.set(workspaceId, set); }
      set.add(listener);
      return () => { set.delete(listener); if (!set.size) listeners.delete(workspaceId); };
    },
    setPresence(workspaceId, person) {
      let map = presence.get(workspaceId);
      if (!map?.has(person.id) && presenceCount >= 2000) return;
      if (!map) { map = new Map(); presence.set(workspaceId, map); }
      if (!map.has(person.id)) presenceCount++;
      map.set(person.id, { person, expires: Date.now() + 60_000 });
      publishPresence(workspaceId);
    },
    subscriberCount: workspaceId => listeners.get(workspaceId)?.size ?? 0,
    onClose(callback) { closers.add(callback); return () => { closers.delete(callback); }; },
    close() {
      clearInterval(sweep);
      for (const close of [...closers]) close();
      closers.clear(); listeners.clear(); presence.clear(); presenceCount = 0;
    },
  };
}

const presenceBody = z.object({ pageId: z.string().max(64).nullable().optional() });

/** Mount behind session middleware. pages is required to accept non-null presence. */
export function createEventsApp(bus: EventBus, options: {
  heartbeatMs?: number;
  pages?: Pick<PageStore, 'getPage'>;
  maxStreams?: number;
  maxSessionStreams?: number;
} = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const streams = new Map<string, Set<() => void>>();
  let total = 0;
  app.get('/api/events', c => {
    const { workspaceId, person, sessionId } = c.get('ctx');
    let sessionStreams = streams.get(sessionId);
    if (sessionStreams && sessionStreams.size >= (options.maxSessionStreams ?? 6)) sessionStreams.values().next().value?.();
    if (total >= (options.maxStreams ?? 2000)) return c.json({ error: 'The server is busy. Live updates will reconnect shortly.' }, 503);
    sessionStreams = streams.get(sessionId) ?? new Set();
    streams.set(sessionId, sessionStreams);
    let closed = false;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const queue: Uint8Array[] = [];
    let queuedBytes = 0;
    let demand = false;
    let unsubscribe = () => {};
    let unclose = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const cleanup = () => {
      if (closed) return;
      closed = true; queue.length = 0; queuedBytes = 0;
      clearInterval(heartbeat); unsubscribe(); unclose();
      c.req.raw.signal.removeEventListener('abort', close);
      sessionStreams!.delete(close); total--;
      if (!sessionStreams!.size) {
        streams.delete(sessionId);
        bus.removePresence(workspaceId, person.id);
      }
    };
    const close = () => { if (!closed) { cleanup(); controller.close(); } };
    const drain = () => {
      if (!closed && demand && queue.length) {
        const next = queue.shift()!; queuedBytes -= next.byteLength;
        demand = false; controller.enqueue(next);
      }
    };
    const enqueue = (data: string) => {
      if (closed) return;
      const bytes = new TextEncoder().encode(data);
      if (queue.length >= 500 || queuedBytes + bytes.byteLength > 2 * 1024 * 1024) { close(); return; }
      queue.push(bytes); queuedBytes += bytes.byteLength; drain();
    };
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        controller = ctrl; total++; sessionStreams!.add(close);
        unsubscribe = bus.subscribe(workspaceId, event => enqueue(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        unclose = bus.onClose(close);
        c.req.raw.signal.addEventListener('abort', close, { once: true });
        const existing = bus.getPresence(workspaceId).find(p => p.id === person.id);
        bus.setPresence(workspaceId, { id: person.id, name: person.name, pageId: existing?.pageId ?? null });
        heartbeat = setInterval(() => enqueue(': heartbeat\n\n'), options.heartbeatMs ?? 20_000);
        heartbeat.unref();
        if (c.req.raw.signal.aborted) close();
      },
      pull() { demand = true; drain(); },
      cancel() { cleanup(); },
    }, { highWaterMark: 0 });
    return new Response(body, { headers: {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      'Connection': 'keep-alive', 'X-Accel-Buffering': 'no',
    } });
  });
  app.post('/api/presence', jsonBodyLimit(2048), async c => {
    const { workspaceId, person, sessionId } = c.get('ctx');
    let raw: unknown;
    try { raw = await c.req.json(); } catch { return c.json({ error: 'The request wasn\'t valid JSON.' }, 400); }
    const parsed = presenceBody.safeParse(raw);
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid body' }, 400);
    const pageId = parsed.data.pageId ?? null;
    if (pageId && !options.pages?.getPage(workspaceId, pageId)) return c.json({ error: 'That page doesn\'t exist.' }, 400);
    if (streams.get(sessionId)?.size) bus.setPresence(workspaceId, { id: person.id, name: person.name, pageId });
    return c.body(null, 204);
  });
  return app;
}
