import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Id, MapGraph, Page, ServerEvent } from "@shared/types";
import { api, isNotFound } from "../lib/api";
import { keys, pageTitle } from "../lib/queries";
import { subscribe } from "../lib/events";
import { dismiss, notify } from "../lib/notices";

/**
 * Deleting a page, with a few seconds to undo it. The server has no undelete,
 * so the page is hidden here straight away and the real delete is only sent
 * once the undo window closes, the tab is hidden or closed, or the person
 * closes the notice, whichever comes first. Reading the notice (hover or
 * focus) stops the clock.
 */
export const UNDO_MS = 6_000;

interface Pending {
  /** The page and everything inside it. */
  hidden: Set<Id>;
  timer?: ReturnType<typeof setTimeout>;
  /** When it fires, while the clock runs. */
  due: number;
  /** Time left while paused. */
  left: number;
  commit(): void;
}

/** Holds deletes until their undo window closes. Exported for tests. */
export class PendingDeletes {
  private pending = new Map<Id, Pending>();
  constructor(private readonly delay = UNDO_MS) {}

  /** Start the clock. `commit` runs once, after `delay`, unless undone first. */
  schedule(id: Id, hidden: Iterable<Id>, commit: () => void) {
    this.cancel(id);
    const entry: Pending = { hidden: new Set(hidden), commit, due: 0, left: this.delay };
    this.pending.set(id, entry);
    this.start(id, entry, this.delay);
  }

  /** Undo: the delete never reaches the server. Returns false if it already went. */
  cancel(id: Id): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(id);
    return true;
  }

  /** Stop the clock (the person is reading the notice). */
  pause(id: Id) {
    const p = this.pending.get(id);
    if (!p || p.timer === undefined) return;
    clearTimeout(p.timer);
    p.timer = undefined;
    p.left = Math.max(0, p.due - Date.now());
  }

  /** Restart the clock with the time it had left. */
  resume(id: Id) {
    const p = this.pending.get(id);
    if (p && p.timer === undefined) this.start(id, p, p.left);
  }

  /** Send one waiting delete now. */
  commitNow(id: Id) {
    this.fire(id);
  }

  /** Send every waiting delete now (the tab is going away). */
  flush() {
    for (const id of [...this.pending.keys()]) this.fire(id);
  }

  has(id: Id): boolean {
    return this.pending.has(id);
  }

  /** The pages whose deletes are waiting. */
  roots(): Id[] {
    return [...this.pending.keys()];
  }

  /** Does the waiting delete of `root` take `id` with it? */
  covers(root: Id, id: Id): boolean {
    return this.pending.get(root)?.hidden.has(id) ?? false;
  }

  isHidden(id: Id): boolean {
    for (const p of this.pending.values()) if (p.hidden.has(id)) return true;
    return false;
  }

  get size() {
    return this.pending.size;
  }

  private start(id: Id, p: Pending, ms: number) {
    p.due = Date.now() + ms;
    p.timer = setTimeout(() => this.fire(id), ms);
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

export interface DeleteUndoDeps {
  client: QueryClient;
  navigate(path: string): void;
  /** Send the delete. `keepalive` when the tab is being hidden or closed. */
  send(id: Id, keepalive: boolean): Promise<void>;
  /** The page list straight from the server, so Undo can check the page still exists. */
  fetchPages(): Promise<Page[]>;
  /** Live server events, to notice a page deleted elsewhere (by an agent) during its undo window. */
  subscribe?(listener: (e: ServerEvent) => void): () => void;
  delay?: number;
}

export const noticeIdFor = (id: Id) => `delete-${id}`;

/** The undo-able delete, without React, so every sequence can be tested. */
export function createDeleteUndo(deps: DeleteUndoDeps) {
  const { client } = deps;
  const deletes = new PendingDeletes(deps.delay ?? UNDO_MS);
  /** Ids whose delete has been sent but not yet confirmed; still hidden. */
  const sending = new Set<Id>();
  /** Pages hidden right now, so a later delete of their parent still counts them as inside it. */
  const rows = new Map<Id, Pick<Page, "id" | "parentId">>();
  const titles = new Map<Id, string>();
  const hidden = (id: Id) => deletes.isHidden(id) || sending.has(id);
  const prune = () => {
    for (const id of rows.keys()) if (!hidden(id)) rows.delete(id);
    for (const id of titles.keys()) if (!deletes.has(id)) titles.delete(id);
  };

  function hideIn() {
    const pages = client.getQueryData<Page[]>(keys.pages);
    if (pages?.some((p) => hidden(p.id))) client.setQueryData<Page[]>(keys.pages, pages.filter((p) => !hidden(p.id)));
    const graph = client.getQueryData<MapGraph>(keys.map);
    if (graph?.pages.some((p) => hidden(p.id)))
      client.setQueryData<MapGraph>(keys.map, { ...graph, pages: graph.pages.filter((p) => !hidden(p.id)) });
  }

  // Keep hidden pages hidden when a refetch brings them back before the delete is sent.
  client.getQueryCache().subscribe((e) => {
    if (e.type !== "updated" || (!deletes.size && !sending.size)) return;
    const k = e.query.queryKey[0];
    if (k === keys.pages[0] || k === keys.map[0]) hideIn();
  });

  // Deleted somewhere else (an agent, another tab) while its undo window was open: nothing to undo or send.
  deps.subscribe?.((e) => {
    if (e.type !== "page.deleted" || !deletes.has(e.pageId)) return;
    const title = titles.get(e.pageId) ?? "This page";
    deletes.cancel(e.pageId);
    prune();
    notify({ id: noticeIdFor(e.pageId), tone: "done", persist: true, text: `“${title}” was also deleted elsewhere, so it can't come back.` });
  });

  let leaving = false;
  function send(id: Id, title: string, ids: Set<Id>) {
    ids.forEach((x) => sending.add(x));
    const done = () => {
      ids.forEach((x) => {
        sending.delete(x);
        client.removeQueries({ queryKey: keys.page(x) });
      });
      prune();
    };
    deps.send(id, leaving).then(done, (e) => {
      if (isNotFound(e)) return done();
      ids.forEach((x) => sending.delete(x));
      prune();
      void client.invalidateQueries({ queryKey: keys.pages });
      void client.invalidateQueries({ queryKey: keys.map });
      notify({ tone: "error", text: `Couldn't delete “${title}”, so it's still in your notebook.`, persist: true });
    });
  }

  /** Hide a page and everything inside it, with an Undo notice. Returns how many pages went with it. */
  function remove(page: Page): number {
    const cached = client.getQueryData<Page[]>(keys.pages) ?? [page];
    const all = [...cached, ...[...rows.values()].filter((r) => !cached.some((p) => p.id === r.id))];
    if (!all.some((p) => p.id === page.id)) all.push(page);
    const ids = subtreeOf(all, page.id);
    // Pages already waiting on their own delete aren't news; don't count them again.
    const inside = [...ids].filter((x) => x !== page.id && !hidden(x)).length;
    for (const p of all) if (ids.has(p.id)) rows.set(p.id, { id: p.id, parentId: p.parentId });
    const title = pageTitle(page);
    titles.set(page.id, title);
    const noticeId = noticeIdFor(page.id);
    deletes.schedule(page.id, ids, () => {
      dismiss(noticeId);
      ids.forEach((x) => sending.add(x));
      // Pages inside that were deleted on their own first go with this one, so their Undo can't work any more.
      for (const other of deletes.roots())
        if (ids.has(other)) {
          deletes.cancel(other);
          dismiss(noticeIdFor(other));
        }
      send(page.id, title, ids);
    });
    hideIn();
    notify({
      id: noticeId,
      tone: "done",
      persist: true,
      sticky: true,
      text: inside ? `Deleted “${title}” and ${inside === 1 ? "the page" : `${inside} pages`} inside it.` : `Deleted “${title}”.`,
      action: { label: "Undo", run: () => void undo(page.id) },
      onHold: () => deletes.pause(page.id),
      onRelease: () => deletes.resume(page.id),
      onClose: () => deletes.commitNow(page.id),
    });
    return inside;
  }

  /** Bring a page back and open it. Resolves false if it couldn't come back. */
  async function undo(id: Id): Promise<boolean> {
    const title = titles.get(id) ?? "This page";
    if (!deletes.cancel(id)) return false;
    // A page inside one that's also waiting to be deleted can only come back with it.
    const alsoBack: string[] = [];
    for (const root of deletes.roots())
      if (deletes.covers(root, id)) {
        alsoBack.push(titles.get(root) ?? "the page it's in");
        deletes.cancel(root);
        dismiss(noticeIdFor(root));
      }
    prune();
    let fresh: Page[] | null = null;
    try {
      fresh = await deps.fetchPages();
      client.setQueryData<Page[]>(keys.pages, fresh);
    } catch {
      // Can't check right now (offline?): assume it's there; the page screen says so if not.
    }
    void client.invalidateQueries({ queryKey: keys.map });
    if (fresh && !fresh.some((p) => p.id === id)) {
      notify({ tone: "error", persist: true, text: `“${title}” was also deleted elsewhere, so it can't come back.` });
      return false;
    }
    if (alsoBack.length)
      notify({
        tone: "done",
        persist: true,
        text: `Brought back ${alsoBack.map((t) => `“${t}”`).join(" and ")} too, because “${title}” is inside it.`,
      });
    deps.navigate(`/p/${id}`);
    return true;
  }

  /** Send everything now: the tab is being hidden or closed and may never come back. */
  function flush() {
    leaving = true;
    try {
      deletes.flush();
    } finally {
      leaving = false;
    }
  }

  return { remove, undo, flush, isHidden: hidden, get waiting() { return deletes.size; } };
}

export type DeleteUndo = ReturnType<typeof createDeleteUndo>;

/** Sent with keepalive so it survives the tab closing. */
async function sendDelete(id: Id, keepalive: boolean) {
  if (!keepalive) return api.deletePage(id);
  const r = await fetch(`/api/pages/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin", keepalive: true });
  if (!r.ok && r.status !== 404) throw new Error(String(r.status));
}

let shared: DeleteUndo | null = null;
let currentNavigate: (path: string) => void = () => {};

function sharedFor(client: QueryClient): DeleteUndo {
  if (shared) return shared;
  shared = createDeleteUndo({
    client,
    navigate: (path) => currentNavigate(path),
    send: sendDelete,
    fetchPages: api.pages,
    subscribe,
  });
  const flush = () => shared?.flush();
  // Closing the tab, or hiding it (phones often discard hidden tabs without a pagehide), sends waiting deletes.
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
  return shared;
}

/**
 * Delete a page with an Undo notice. Moves you to its parent (or the map)
 * straight away; Undo brings it back and takes you to it again.
 */
export function useDeleteWithUndo() {
  const client = useQueryClient();
  const navigate = useNavigate();
  currentNavigate = navigate;
  return useCallback(
    (page: Page) => {
      const ids = sharedFor(client);
      ids.remove(page);
      const pages = client.getQueryData<Page[]>(keys.pages) ?? [];
      const parent = page.parentId && pages.some((p) => p.id === page.parentId) ? page.parentId : null;
      navigate(parent ? `/p/${parent}` : "/");
      // Land somewhere a keyboard or screen reader can carry on from.
      requestAnimationFrame(() => document.getElementById("main")?.focus({ preventScroll: true }));
    },
    [client, navigate],
  );
}

/** True while a page is deleted but its undo window is still open (or the delete is on its way). */
export const isDeletePending = (id: Id) => shared?.isHidden(id) ?? false;
