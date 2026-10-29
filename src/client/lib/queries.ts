import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { DiaryEntry, Id, MapGraph, Page, Run } from "@shared/types";
import { api, isNotFound } from "./api";
import { mergeThread } from "./events";

/** Query keys shared by the app, the events hook and the map. */
export const keys = {
  me: ["me"] as const,
  map: ["map"] as const,
  pages: ["pages"] as const,
  page: (id: Id) => ["page", id] as const,
  agents: ["agents"] as const,
  threads: ["diary"] as const,
  thread: (threadId: Id) => ["diary", threadId] as const,
  run: (id: Id) => ["run", id] as const,
  search: (q: string) => ["search", q] as const,
};

/** Don't hammer routes that aren't built yet; retry real failures a couple of times. */
const retry = (count: number, error: unknown) => !isNotFound(error) && count < 2;

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: api.me, staleTime: Infinity, retry });
export const useMap = () => useQuery({ queryKey: keys.map, queryFn: api.map, retry });
export const usePages = () => useQuery({ queryKey: keys.pages, queryFn: api.pages, retry });
export const usePage = (id: Id) => useQuery({ queryKey: keys.page(id), queryFn: () => api.page(id), retry });
export const useAgents = () => useQuery({ queryKey: keys.agents, queryFn: api.agents, staleTime: 60_000, retry });
export const useThreads = () => useQuery({ queryKey: keys.threads, queryFn: api.threads, retry });
export function useThread(threadId: Id | null) {
  const client = useQueryClient();
  return useQuery({
    queryKey: keys.thread(threadId ?? "none"),
    // Merge rather than replace, so a refetch mid-reply doesn't erase ink that already streamed in.
    queryFn: async () => mergeThread(client.getQueryData<DiaryEntry[]>(keys.thread(threadId!)), await api.thread(threadId!)),
    enabled: !!threadId,
    retry,
  });
}

/**
 * A run's latest state. There's no GET /api/runs/:id, so runs come from the
 * map graph and from `run.updated` events (which write into this key).
 */
export function useRun(id: Id | null, client: QueryClient) {
  return useQuery({
    queryKey: keys.run(id ?? "none"),
    enabled: !!id,
    staleTime: Infinity,
    retry,
    queryFn: async (): Promise<Run | null> => {
      const graph: MapGraph | undefined =
        client.getQueryData<MapGraph>(keys.map) ?? (await client.fetchQuery({ queryKey: keys.map, queryFn: api.map }));
      return graph?.runs.find((r) => r.id === id) ?? null;
    },
  });
}

/** Ancestors of a page, root first. Guards against cycles. */
export function ancestorsOf(pages: Page[], id: Id): Page[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const out: Page[] = [];
  const seen = new Set<Id>([id]);
  let cur = byId.get(id)?.parentId ?? null;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const p = byId.get(cur);
    if (!p) break;
    out.unshift(p);
    cur = p.parentId;
  }
  return out;
}

export const childrenOf = (pages: Page[], id: Id | null) =>
  pages
    .filter((p) => p.parentId === id)
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : a.title.localeCompare(b.title)));

export const pageTitle = (p: Pick<Page, "title"> | undefined | null) => (p?.title?.trim() ? p.title : "Untitled");
