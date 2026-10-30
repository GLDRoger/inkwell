import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Id, MapGraph, Page } from "@shared/types";
import { api, isNotFound } from "../lib/api";
import { keys, pageTitle } from "../lib/queries";
import { dismiss, notify } from "../lib/notices";

/**
 * Deleting a page, with a few seconds to undo it. The server has no undelete,
 * so the page is hidden here straight away and the real delete is only sent
 * once the undo window closes (or the tab is closed, whichever comes first).
 */
export const UNDO_MS = 6_000;

interface Pending {
  /** The page and everything inside it. */
  hidden: Set<Id>;
  timer: ReturnType<typeof setTimeout>;
  commit(): void;
}

/** Holds deletes until their undo window closes. Exported for tests. */
export class PendingDeletes {
  private pending = new Map<Id, Pending>();
  constructor(private readonly delay = UNDO_MS) {}

  /** Start the clock. `commit` runs once, after `delay`, unless undone first. */
  schedule(id: Id, hidden: Iterable<Id>, commit: () => void) {
    this.cancel(id);
    const entry: Pending = {
      hidden: new Set(hidden),
      commit,
      timer: setTimeout(() => this.fire(id), this.delay),
    };
    this.pending.set(id, entry);
  }

  /** Undo: the delete never reaches the server. Returns false if it already went. */
  cancel(id: Id): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(id);
    return true;
  }

  /** Send every waiting delete now (the tab is closing). */
  flush() {
    for (const id of [...this.pending.keys()]) this.fire(id);
  }

  isHidden(id: Id): boolean {
    for (const p of this.pending.values()) if (p.hidden.has(id)) return true;
    return false;
  }

  get size() {
    return this.pending.size;
  }

  private fire(id: Id) {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.commit();
  }
}

/** A page and all the pages inside it. */
export function subtreeOf(pages: Pick<Page, "id" | "parentId">[], id: Id): Set<Id> {
  const out = new Set<Id>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pages) if (p.parentId && out.has(p.parentId) && !out.has(p.id)) (out.add(p.id), (grew = true));
  }
  return out;
}

const deletes = new PendingDeletes();
/** Ids whose delete has been sent but not yet confirmed; still hidden. */
const sending = new Set<Id>();
const hidden = (id: Id) => deletes.isHidden(id) || sending.has(id);

function hideIn(client: QueryClient) {
  const pages = client.getQueryData<Page[]>(keys.pages);
  if (pages?.some((p) => hidden(p.id))) client.setQueryData<Page[]>(keys.pages, pages.filter((p) => !hidden(p.id)));
  const graph = client.getQueryData<MapGraph>(keys.map);
  if (graph?.pages.some((p) => hidden(p.id))) client.setQueryData<MapGraph>(keys.map, { ...graph, pages: graph.pages.filter((p) => !hidden(p.id)) });
}

let watching: QueryClient | null = null;
/** Keep hidden pages hidden when a refetch brings them back before the delete is sent. */
function watch(client: QueryClient) {
  if (watching === client) return;
  watching = client;
  client.getQueryCache().subscribe((e) => {
    if (e.type !== "updated" || (!deletes.size && !sending.size)) return;
    const k = e.query.queryKey[0];
    if (k === keys.pages[0] || k === keys.map[0]) hideIn(client);
  });
}

let unloading = false;
if (typeof window !== "undefined") {
  // Closing the tab inside the undo window still deletes the page (sent with keepalive).
  window.addEventListener("pagehide", () => {
    unloading = true;
    deletes.flush();
  });
}

function send(client: QueryClient, id: Id, title: string, ids: Set<Id>, keepalive = false) {
  ids.forEach((x) => sending.add(x));
  const done = () => {
    ids.forEach((x) => {
      sending.delete(x);
      client.removeQueries({ queryKey: keys.page(x) });
    });
  };
  const request = keepalive
    ? fetch(`/api/pages/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin", keepalive: true }).then((r) => {
        if (!r.ok && r.status !== 404) throw new Error(String(r.status));
      })
    : api.deletePage(id);
  request.then(done, (e) => {
    if (isNotFound(e)) return done();
    ids.forEach((x) => sending.delete(x));
    void client.invalidateQueries({ queryKey: keys.pages });
    void client.invalidateQueries({ queryKey: keys.map });
    notify({ tone: "error", text: `Couldn't delete “${title}”, so it's still in your notebook.`, persist: true });
  });
}

/**
 * Delete a page with an Undo notice. Moves you to its parent (or the map)
 * straight away; Undo brings it back and takes you to it again.
 */
export function useDeleteWithUndo() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return useCallback(
    (page: Page) => {
      watch(client);
      const all = client.getQueryData<Page[]>(keys.pages) ?? [page];
      const ids = subtreeOf(all, page.id);
      const title = pageTitle(page);
      const noticeId = `delete-${page.id}`;
      deletes.schedule(page.id, ids, () => {
        dismiss(noticeId);
        send(client, page.id, title, ids, unloading);
      });
      hideIn(client);
      const inside = ids.size - 1;
      notify({
        id: noticeId,
        tone: "done",
        persist: true,
        duration: UNDO_MS,
        text: inside ? `Deleted “${title}” and ${inside === 1 ? "the page" : `${inside} pages`} inside it.` : `Deleted “${title}”.`,
        action: {
          label: "Undo",
          run: () => {
            if (!deletes.cancel(page.id)) return;
            void client.invalidateQueries({ queryKey: keys.pages });
            void client.invalidateQueries({ queryKey: keys.map });
            navigate(`/p/${page.id}`);
          },
        },
      });
      const parent = page.parentId && !ids.has(page.parentId) ? page.parentId : null;
      navigate(parent ? `/p/${parent}` : "/");
      // Land somewhere a keyboard or screen reader can carry on from.
      requestAnimationFrame(() => document.getElementById("main")?.focus({ preventScroll: true }));
    },
    [client, navigate],
  );
}

/** True while a page is deleted but its undo window is still open. */
export const isDeletePending = (id: Id) => hidden(id);
