/**
 * Live updates from GET /api/events.
 *
 * One EventSource per tab (opened by `useServerEvents()` in the app shell).
 * Every ServerEvent first patches the react-query caches, then goes out on a
 * small in-memory bus so any component (the map's footprints, the diary's ink)
 * can react without opening its own stream.
 *
 *   subscribe(fn)                 every event; returns an unsubscribe function
 *   useServerEvent(type, fn)      hook: events of one type, handler may change freely
 *   useConnectionStatus()         "connecting" | "open" | "reconnecting"
 *   usePresence()                 people and the page they're on (from "presence")
 *   emit(event)                   push an event through the same path (tests, demos)
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { DiaryEntry, DiaryThread, Id, MapGraph, Page, PageWithBody, Run, ServerEvent } from "@shared/types";
import { keys } from "./queries";

export type ServerEventType = ServerEvent["type"];
export type EventOf<T extends ServerEventType> = Extract<ServerEvent, { type: T }>;
export type ConnectionStatus = "connecting" | "open" | "reconnecting";
export type PresencePerson = { id: Id; name: string; pageId: Id | null };

const EVENT_TYPES: ServerEventType[] = [
  "page.created",
  "page.updated",
  "page.deleted",
  "run.updated",
  "agent.moved",
  "diary.entry",
  "diary.delta",
  "presence",
];

// ---------------------------------------------------------------- the bus

const listeners = new Set<(e: ServerEvent) => void>();
let status: ConnectionStatus = "connecting";
const statusListeners = new Set<() => void>();
let presence: PresencePerson[] = [];
const presenceListeners = new Set<() => void>();
let activeClient: QueryClient | null = null;

export function subscribe(listener: (e: ServerEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Patch caches (when the app shell is mounted) and notify subscribers. */
export function emit(event: ServerEvent): void {
  if (activeClient) applyServerEvent(activeClient, event);
  if (event.type === "presence") {
    presence = event.people;
    presenceListeners.forEach((l) => l());
  }
  for (const l of [...listeners]) {
    try {
      l(event);
    } catch (err) {
      console.error("[events] listener failed", err);
    }
  }
}

function setStatus(next: ConnectionStatus) {
  if (next === status) return;
  status = next;
  statusListeners.forEach((l) => l());
}

export function useServerEvent<T extends ServerEventType>(type: T, handler: (e: EventOf<T>) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === type) ref.current(e as EventOf<T>);
      }),
    [type],
  );
}

export function useConnectionStatus(): ConnectionStatus {
  return useSyncExternalStore(
    (l) => (statusListeners.add(l), () => statusListeners.delete(l)),
    () => status,
  );
}

export function usePresence(): PresencePerson[] {
  return useSyncExternalStore(
    (l) => (presenceListeners.add(l), () => presenceListeners.delete(l)),
    () => presence,
  );
}

// ---------------------------------------------------------------- cache patching

/**
 * Apply a streamed diary chunk. The contract calls it a delta, so it's
 * appended; if a server sends the whole text so far instead, that's detected
 * (it starts with what we have and is longer) and replaces it.
 */
export function applyDelta(current: string, text: string): string {
  if (current && text.length > current.length && text.startsWith(current)) return text;
  return current + text;
}

const upsert = <T extends { id: Id }>(list: T[], item: T, where: "start" | "end" = "end"): T[] => {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return where === "start" ? [item, ...list] : [...list, item];
  const next = list.slice();
  next[i] = { ...list[i], ...item };
  return next;
};

const byCreated = (a: DiaryEntry, b: DiaryEntry) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);

function patchPage(client: QueryClient, page: Page) {
  client.setQueryData<Page[]>(keys.pages, (old) => (old ? upsert(old, page) : old));
  client.setQueryData<MapGraph>(keys.map, (old) => (old ? { ...old, pages: upsert(old.pages, page) } : old));
  client.setQueryData<PageWithBody>(keys.page(page.id), (old) => (old ? { ...old, ...page } : old));
}

function patchRun(client: QueryClient, id: Id, update: (run: Run) => Run, fresh?: Run) {
  client.setQueryData<MapGraph>(keys.map, (old) => {
    if (!old) return old;
    const exists = old.runs.some((r) => r.id === id);
    if (!exists) return fresh ? { ...old, runs: [fresh, ...old.runs] } : old;
    return { ...old, runs: old.runs.map((r) => (r.id === id ? update(r) : r)) };
  });
  client.setQueryData<Run | null>(keys.run(id), (old) => (old ? update(old) : (fresh ?? old)));
}

/** A thread we only know from events is partial: fetch it in full when someone looks. */
function markPartial(client: QueryClient, threadId: Id) {
  queueMicrotask(() => void client.invalidateQueries({ queryKey: keys.thread(threadId), exact: true, refetchType: "active" }));
}

export function applyServerEvent(client: QueryClient, e: ServerEvent): void {
  switch (e.type) {
    case "page.created":
    case "page.updated":
      patchPage(client, e.page);
      return;
    case "page.deleted":
      client.setQueryData<Page[]>(keys.pages, (old) => old?.filter((p) => p.id !== e.pageId));
      client.setQueryData<MapGraph>(keys.map, (old) =>
        old
          ? {
              ...old,
              pages: old.pages.filter((p) => p.id !== e.pageId),
              links: old.links.filter((l) => l.from !== e.pageId && l.to !== e.pageId),
            }
          : old,
      );
      void client.invalidateQueries({ queryKey: keys.page(e.pageId) });
      return;
    case "run.updated":
      patchRun(client, e.run.id, () => e.run, e.run);
      return;
    case "agent.moved":
      patchRun(client, e.runId, (r) => ({ ...r, pageId: e.toPageId }));
      return;
    case "diary.entry": {
      const { entry } = e;
      if (!client.getQueryData(keys.thread(entry.threadId))) markPartial(client, entry.threadId);
      client.setQueryData<DiaryEntry[]>(keys.thread(entry.threadId), (old) => {
        const list = old ?? [];
        const merged = mergeEntry(list.find((x) => x.id === entry.id), entry);
        return [...list.filter((x) => x.id !== entry.id), merged].sort(byCreated);
      });
      const threads = client.getQueryData<DiaryThread[]>(keys.threads);
      if (threads && !threads.some((t) => t.id === entry.threadId)) {
        void client.invalidateQueries({ queryKey: keys.threads, exact: true });
      } else {
        client.setQueryData<DiaryThread[]>(keys.threads, (old) =>
          old
            ?.map((t) => (t.id === entry.threadId ? { ...t, updatedAt: entry.createdAt } : t))
            .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
        );
      }
      return;
    }
    case "diary.delta":
      if (!client.getQueryData(keys.thread(e.threadId))) markPartial(client, e.threadId);
      client.setQueryData<DiaryEntry[]>(keys.thread(e.threadId), (old) => {
        const list = old ?? [];
        const i = list.findIndex((x) => x.id === e.entryId);
        if (i === -1) {
          // The chunk beat its entry here: hold the text in a placeholder the entry event will fill in.
          const placeholder: DiaryEntry = {
            id: e.entryId,
            threadId: e.threadId,
            role: "agent",
            agentId: null,
            text: e.text,
            pageIds: [],
            attachments: [],
            runId: null,
            createdAt: new Date().toISOString(),
          };
          return [...list, placeholder];
        }
        const next = list.slice();
        next[i] = { ...list[i], text: applyDelta(list[i].text, e.text) };
        return next;
      });
      return;
    case "presence":
      return;
  }
}

/**
 * Merge a fetched thread with what's cached: the server's list is the truth for
 * which entries exist, but text that streamed in ahead of it is kept.
 */
export function mergeThread(cached: DiaryEntry[] | undefined, fresh: DiaryEntry[]): DiaryEntry[] {
  if (!cached?.length) return fresh;
  const byId = new Map(cached.map((e) => [e.id, e]));
  const merged = fresh.map((e) => mergeEntry(byId.get(e.id), e));
  const known = new Set(fresh.map((e) => e.id));
  // Entries only we know about (streamed, not yet persisted) stay.
  for (const e of cached) if (!known.has(e.id)) merged.push(e);
  return merged.sort(byCreated);
}

/** A diary.entry for an entry we've already streamed shouldn't wipe longer streamed text. */
export function mergeEntry(existing: DiaryEntry | undefined, incoming: DiaryEntry): DiaryEntry {
  if (!existing) return incoming;
  const text = incoming.text.length >= existing.text.length ? incoming.text : existing.text;
  return { ...existing, ...incoming, text };
}

// ---------------------------------------------------------------- the stream

function parse(data: string): ServerEvent | null {
  try {
    const value = JSON.parse(data);
    return value && typeof value.type === "string" ? (value as ServerEvent) : null;
  } catch {
    return null;
  }
}

/** Mount once, in the app shell. Opens the stream, reconnects with backoff, resyncs after gaps. */
export function useServerEvents(): void {
  const client = useQueryClient();
  useEffect(() => {
    activeClient = client;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let everOpened = false;
    let disposed = false;
    // The server names every message, so each arrives through exactly one
    // listener. Never dedupe: two identical diary.delta chunks are both ink.
    const onData = (raw: string) => {
      const event = parse(raw);
      if (event) emit(event);
    };

    const connect = () => {
      if (disposed) return;
      source = new EventSource("/api/events", { withCredentials: true });
      source.onopen = () => {
        if (everOpened) void client.invalidateQueries(); // we may have missed events while away
        everOpened = true;
        attempt = 0;
        setStatus("open");
      };
      source.onmessage = (m) => onData(m.data);
      for (const type of EVENT_TYPES) source.addEventListener(type, (m) => onData((m as MessageEvent).data));
      source.onerror = () => {
        setStatus(everOpened ? "reconnecting" : "connecting");
        if (source?.readyState === EventSource.CLOSED) {
          source.close();
          const delay = Math.min(15_000, 1000 * 2 ** attempt++);
          retryTimer = setTimeout(connect, delay);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      source?.close();
      if (activeClient === client) activeClient = null;
    };
  }, [client]);
}
