import { MAX_YDOC_BYTES } from "./limits.ts";
import { generateKeyBetween } from "fractional-indexing";
import type { Actor, Link, Page, PageWithBody } from "../shared/types.ts";
import {
  getSchemaVersion,
  newId,
  nowIso,
  setSchemaVersion,
  parseActor,
  type Db,
  type PageRow,
} from "./db.ts";
import type { EventBus } from "./events.ts";
import {
  excerptFromMarkdown,
  extractPageLinkIds,
  markdownToPlainText,
  markdownToYDocBytes,
  yDocBytesToMarkdown,
} from "./editor-schema.ts";

function safeCanonical(ydoc: Uint8Array): string | null {
  try { return yDocBytesToMarkdown(ydoc); } catch { return null; }
}

export function isValidPosition(position: string): boolean {
  if (!position || position.length > 128 || !/^[A-Za-z0-9]+$/.test(position)) return false;
  try { generateKeyBetween(position, null); return true; } catch { return false; }
}

export class PageStoreError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "PageStoreError";
    this.status = status;
  }
}

export function rowToPage(row: PageRow): Page {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    icon: row.icon,
    position: row.position,
    excerpt: row.excerpt,
    x: row.x,
    y: row.y,
    coverUrl: row.cover_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: parseActor(row.updated_by),
  };
}

export interface CreatePageInput {
  id?: string;
  parentId?: string | null;
  title?: string;
  icon?: string | null;
  markdown?: string;
  x?: number | null;
  y?: number | null;
  coverUrl?: string | null;
  position?: string;
}

export interface UpdatePageInput {
  title?: string;
  icon?: string | null;
  parentId?: string | null;
  position?: string;
  x?: number | null;
  y?: number | null;
  coverUrl?: string | null;
}

export interface PageStore {
  listPages: (workspaceId: string) => Page[];
  getPage: (workspaceId: string, id: string) => Page | null;
  getPageRow: (workspaceId: string, id: string) => PageRow | null;
  getPageWithBody: (workspaceId: string, id: string) => PageWithBody | null;
  createPage: (workspaceId: string, actor: Actor, input: CreatePageInput) => Page;
  updatePage: (
    workspaceId: string,
    actor: Actor,
    id: string,
    patch: UpdatePageInput,
  ) => Page | null;
  deletePage: (workspaceId: string, id: string) => boolean;
  searchPages: (
    workspaceId: string,
    query: string,
  ) => { page: Page; snippet: string }[];
  getChildren: (workspaceId: string, parentId: string | null) => Page[];
  getDescendantIds: (workspaceId: string, id: string) => string[];
  isDescendant: (workspaceId: string, ancestorId: string, id: string) => boolean;
  nextPosition: (workspaceId: string, parentId: string | null) => string;
  listLinks: (workspaceId: string) => Link[];
  syncPageBody: (
    workspaceId: string,
    pageId: string,
    body: { ydoc: Buffer; markdown: string; actor?: Actor | null },
  ) => Page | null;
  setPageMarkdown: (
    workspaceId: string,
    actor: Actor,
    pageId: string,
    markdown: string,
  ) => Page | null;
  rebuildLinks: (workspaceId: string) => void;
  countPages: (workspaceId: string) => number;
}

export function createPageStore(deps: { db: Db; bus: EventBus }): PageStore {
  const { db, bus } = deps;

  const getPageRow: PageStore["getPageRow"] = (workspaceId, id) => {
    const row = db
      .prepare(
        "SELECT * FROM pages WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL",
      )
      .get(workspaceId, id) as PageRow | undefined;
    return row ?? null;
  };

  const syncFts = (workspaceId: string, pageId: string, title: string, markdown: string) => {
    db.prepare("DELETE FROM pages_fts WHERE workspace_id = ? AND page_id = ?").run(
      workspaceId,
      pageId,
    );
    // Index the readable text, not markdown syntax, so snippets read cleanly
    // and link targets (/p/<id>) don't match searches.
    db.prepare(
      "INSERT INTO pages_fts (page_id, workspace_id, title, markdown) VALUES (?, ?, ?, ?)",
    ).run(pageId, workspaceId, title, markdownToPlainText(markdown));
  };

  const outgoing = (workspaceId: string, fromId: string): string[] =>
    (db.prepare("SELECT to_id FROM links WHERE workspace_id = ? AND from_id = ? ORDER BY to_id")
      .all(workspaceId, fromId) as { to_id: string }[]).map((r) => r.to_id);

  /** Rewrite a page's outgoing links. Returns the new set if it changed, else null. */
  const syncLinks = (workspaceId: string, fromId: string, markdown: string): Link[] | null => {
    const before = outgoing(workspaceId, fromId);
    db.prepare("DELETE FROM links WHERE workspace_id = ? AND from_id = ?").run(
      workspaceId,
      fromId,
    );
    const insert = db.prepare(
      "INSERT OR IGNORE INTO links (workspace_id, from_id, to_id) VALUES (?, ?, ?)",
    );
    for (const toId of extractPageLinkIds(markdown)) {
      if (toId === fromId) continue;
      // Only link to live pages in the same workspace (no dangling paths).
      if (getPageRow(workspaceId, toId)) insert.run(workspaceId, fromId, toId);
    }
    const after = outgoing(workspaceId, fromId);
    if (after.length === before.length && after.every((id, i) => id === before[i])) return null;
    return after.map((to) => ({ from: fromId, to }));
  };

  // Schema v2: the search index holds plain text instead of markdown.
  if (getSchemaVersion(db) < 2) {
    db.transaction(() => {
      const rows = db
        .prepare("SELECT id, workspace_id, title, markdown FROM pages WHERE deleted_at IS NULL")
        .all() as Pick<PageRow, "id" | "workspace_id" | "title" | "markdown">[];
      for (const row of rows) syncFts(row.workspace_id, row.id, row.title, row.markdown);
      setSchemaVersion(db, 2);
    })();
  }

  const getDescendantIds: PageStore["getDescendantIds"] = (workspaceId, id) => {
    const rows = db
      .prepare(
        `WITH RECURSIVE subtree(id) AS (
           SELECT id FROM pages WHERE workspace_id = ? AND parent_id = ? AND deleted_at IS NULL
           UNION ALL
           SELECT p.id FROM pages p JOIN subtree s ON p.parent_id = s.id
           WHERE p.workspace_id = ? AND p.deleted_at IS NULL
         )
         SELECT id FROM subtree`,
      )
      .all(workspaceId, id, workspaceId) as { id: string }[];
    return rows.map((r) => r.id);
  };

  const isDescendant: PageStore["isDescendant"] = (workspaceId, ancestorId, id) =>
    getDescendantIds(workspaceId, ancestorId).includes(id);

  const assertValidParent = (
    workspaceId: string,
    parentId: string | null,
    selfId?: string,
  ) => {
    if (parentId === null) return;
    if (!getPageRow(workspaceId, parentId)) {
      throw new PageStoreError("The parent page doesn't exist. Pick another parent.", 400);
    }
    if (selfId) {
      if (parentId === selfId) throw new PageStoreError("A page can't be its own parent.", 400);
      if (isDescendant(workspaceId, selfId, parentId)) {
        throw new PageStoreError("A page can't move inside one of its own subpages.", 400);
      }
    }
  };

  const nextPosition: PageStore["nextPosition"] = (workspaceId, parentId) => {
    const row = (
      parentId === null
        ? db
            .prepare(
              `SELECT position FROM pages WHERE workspace_id = ? AND parent_id IS NULL AND deleted_at IS NULL
               ORDER BY position DESC LIMIT 1`,
            )
            .get(workspaceId)
        : db
            .prepare(
              `SELECT position FROM pages WHERE workspace_id = ? AND parent_id = ? AND deleted_at IS NULL
               ORDER BY position DESC LIMIT 1`,
            )
            .get(workspaceId, parentId)
    ) as { position: string } | undefined;
    return generateKeyBetween(row?.position ?? null, null);
  };

  const createPage: PageStore["createPage"] = (workspaceId, actor, input) => {
    if (input.position !== undefined && !isValidPosition(input.position)) throw new PageStoreError("That position isn't valid.");
    const parentId = input.parentId ?? null;
    assertValidParent(workspaceId, parentId);
    const id = input.id ?? newId();
    const markdown = input.markdown ?? "";
    const now = nowIso();
    const row: PageRow = {
      id,
      workspace_id: workspaceId,
      parent_id: parentId,
      title: input.title ?? "",
      icon: input.icon ?? null,
      position: input.position ?? nextPosition(workspaceId, parentId),
      excerpt: excerptFromMarkdown(markdown, 600, input.title ?? ""),
      x: input.x ?? null,
      y: input.y ?? null,
      cover_url: input.coverUrl ?? null,
      markdown,
      ydoc: markdownToYDocBytes(markdown),
      updated_by: JSON.stringify(actor),
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    if (row.ydoc!.byteLength > MAX_YDOC_BYTES) throw new PageStoreError("This page is over the 4 MB size limit. Split it into smaller pages.", 413);
    const links = db.transaction(() => {
      db.prepare(
        `INSERT INTO pages (id, workspace_id, parent_id, title, icon, position, excerpt, x, y, cover_url, markdown, ydoc, updated_by, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).run(
        row.id,
        row.workspace_id,
        row.parent_id,
        row.title,
        row.icon,
        row.position,
        row.excerpt,
        row.x,
        row.y,
        row.cover_url,
        row.markdown,
        row.ydoc,
        row.updated_by,
        row.created_at,
        row.updated_at,
      );
      syncFts(workspaceId, row.id, row.title, row.markdown);
      return syncLinks(workspaceId, row.id, row.markdown);
    })();
    const page = rowToPage(row);
    bus.publish(workspaceId, { type: "page.created", page });
    if (links) bus.publish(workspaceId, { type: "page.links", pageId: page.id, links });
    return page;
  };

  const updatePage: PageStore["updatePage"] = (workspaceId, actor, id, patch) => {
    if (patch.position !== undefined && !isValidPosition(patch.position)) throw new PageStoreError("That position isn't valid.");
    const existing = getPageRow(workspaceId, id);
    if (!existing) return null;
    if (patch.parentId !== undefined) {
      assertValidParent(workspaceId, patch.parentId, id);
      // Moving without an explicit position goes to the end of the new parent.
      if (patch.parentId !== existing.parent_id && patch.position === undefined) {
        patch = { ...patch, position: nextPosition(workspaceId, patch.parentId) };
      }
    }
    const next: PageRow = {
      ...existing,
      title: patch.title !== undefined ? patch.title : existing.title,
      icon: patch.icon !== undefined ? patch.icon : existing.icon,
      parent_id: patch.parentId !== undefined ? patch.parentId : existing.parent_id,
      position: patch.position !== undefined ? patch.position : existing.position,
      x: patch.x !== undefined ? patch.x : existing.x,
      y: patch.y !== undefined ? patch.y : existing.y,
      cover_url: patch.coverUrl !== undefined ? patch.coverUrl : existing.cover_url,
      updated_by: JSON.stringify(actor),
      updated_at: nowIso(),
    };
    if (next.title !== existing.title) {
      next.excerpt = excerptFromMarkdown(next.markdown, 600, next.title);
    }
    db.transaction(() => {
      db.prepare(
        `UPDATE pages SET title = ?, excerpt = ?, icon = ?, parent_id = ?, position = ?, x = ?, y = ?, cover_url = ?, updated_by = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL`,
      ).run(
        next.title,
        next.excerpt,
        next.icon,
        next.parent_id,
        next.position,
        next.x,
        next.y,
        next.cover_url,
        next.updated_by,
        next.updated_at,
        workspaceId,
        id,
      );
      if (next.title !== existing.title) syncFts(workspaceId, id, next.title, next.markdown);
    })();
    const page = rowToPage(next);
    bus.publish(workspaceId, { type: "page.updated", page });
    return page;
  };

  const deletePage: PageStore["deletePage"] = (workspaceId, id) => {
    if (!getPageRow(workspaceId, id)) return false;
    const ids = [id, ...getDescendantIds(workspaceId, id)];
    const now = nowIso();
    db.transaction(() => {
      const mark = db.prepare(
        "UPDATE pages SET deleted_at = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
      );
      const dropFts = db.prepare(
        "DELETE FROM pages_fts WHERE workspace_id = ? AND page_id = ?",
      );
      const dropLinks = db.prepare(
        "DELETE FROM links WHERE workspace_id = ? AND (from_id = ? OR to_id = ?)",
      );
      for (const pageId of ids) {
        mark.run(now, now, workspaceId, pageId);
        dropFts.run(workspaceId, pageId);
        dropLinks.run(workspaceId, pageId, pageId);
      }
    })();
    for (const pageId of ids) bus.publish(workspaceId, { type: "page.deleted", pageId });
    return true;
  };

  const syncPageBody: PageStore["syncPageBody"] = (workspaceId, pageId, body) => {
    if (body.ydoc.byteLength > MAX_YDOC_BYTES) throw new PageStoreError("This page is over the 4 MB size limit. Split it into smaller pages.", 413);
    const existing = getPageRow(workspaceId, pageId);
    if (!existing) return null;
    // Stored markdown can be the raw text an agent wrote, which differs from the
    // editor's canonical form (a trailing newline, list markers). Compare content
    // against the canonical form of the stored document, so a client merely
    // opening the page (and normalising it) isn't credited with an edit.
    const markdownChanged = existing.markdown !== body.markdown
      && !(existing.ydoc && safeCanonical(existing.ydoc) === body.markdown);
    const ydocChanged =
      !existing.ydoc || !Buffer.from(existing.ydoc).equals(body.ydoc);
    if (!markdownChanged && !ydocChanged) return rowToPage(existing);
    if (!markdownChanged) {
      // Same content, new bookkeeping (e.g. editor position stores): keep it quietly.
      db.prepare("UPDATE pages SET ydoc = ?, markdown = ? WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL")
        .run(body.ydoc, body.markdown, workspaceId, pageId);
      return rowToPage({ ...existing, ydoc: body.ydoc, markdown: body.markdown });
    }

    const next: PageRow = {
      ...existing,
      markdown: body.markdown,
      ydoc: body.ydoc,
      excerpt: markdownChanged
        ? excerptFromMarkdown(body.markdown, 600, existing.title)
        : existing.excerpt,
      updated_by: body.actor ? JSON.stringify(body.actor) : existing.updated_by,
      updated_at: nowIso(),
    };
    const links = db.transaction(() => {
      db.prepare(
        `UPDATE pages SET markdown = ?, ydoc = ?, excerpt = ?, updated_by = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL`,
      ).run(next.markdown, next.ydoc, next.excerpt, next.updated_by, next.updated_at, workspaceId, pageId);
      if (!markdownChanged) return null;
      syncFts(workspaceId, pageId, next.title, next.markdown);
      return syncLinks(workspaceId, pageId, next.markdown);
    })();
    const page = rowToPage(next);
    if (markdownChanged) bus.publish(workspaceId, { type: "page.updated", page });
    // The map draws paths from links; tell it when this page's paths change.
    if (links) bus.publish(workspaceId, { type: "page.links", pageId, links });
    return page;
  };

  const setPageMarkdown: PageStore["setPageMarkdown"] = (workspaceId, actor, pageId, markdown) =>
    syncPageBody(workspaceId, pageId, {
      ydoc: markdownToYDocBytes(markdown),
      markdown,
      actor,
    });

  return {
    listPages(workspaceId) {
      const rows = db
        .prepare(
          `SELECT * FROM pages WHERE workspace_id = ? AND deleted_at IS NULL
           ORDER BY position ASC, created_at ASC`,
        )
        .all(workspaceId) as PageRow[];
      return rows.map(rowToPage);
    },
    getPage(workspaceId, id) {
      const row = getPageRow(workspaceId, id);
      return row ? rowToPage(row) : null;
    },
    getPageRow,
    getPageWithBody(workspaceId, id) {
      const row = getPageRow(workspaceId, id);
      return row ? { ...rowToPage(row), markdown: row.markdown } : null;
    },
    createPage,
    updatePage,
    deletePage,
    searchPages(workspaceId, query) {
      const q = query.trim();
      if (!q) return [];
      // Quote each term for FTS5 and prefix-match the last one (type-ahead).
      const terms = q.split(/\s+/).filter(Boolean);
      const quoted = terms.map((term, i) => `"${term.replace(/"/g, '""')}"${i === terms.length - 1 ? "*" : ""}`);
      const run = (match: string) => {
        try {
          return db
            .prepare(
              `SELECT p.*, snippet(pages_fts, -1, '', '', '…', 24) AS snip
               FROM pages_fts
               JOIN pages p ON p.id = pages_fts.page_id
               WHERE pages_fts MATCH ? AND pages_fts.workspace_id = ?
                 AND p.workspace_id = ? AND p.deleted_at IS NULL
               ORDER BY rank LIMIT 30`,
            )
            .all(match, workspaceId, workspaceId) as (PageRow & { snip: string })[];
        } catch {
          return [];
        }
      };
      // Every word first; if nothing has them all, any of them (ranked by relevance).
      let rows = run(quoted.join(" "));
      if (!rows.length && terms.length > 1) rows = run(quoted.join(" OR "));
      return rows.map((row) => ({
        page: rowToPage(row),
        snippet: (row.snip || row.excerpt).replace(/\s+/g, " ").trim(),
      }));
    },
    getChildren(workspaceId, parentId) {
      const rows = (
        parentId === null
          ? db
              .prepare(
                `SELECT * FROM pages WHERE workspace_id = ? AND parent_id IS NULL AND deleted_at IS NULL
                 ORDER BY position ASC, created_at ASC`,
              )
              .all(workspaceId)
          : db
              .prepare(
                `SELECT * FROM pages WHERE workspace_id = ? AND parent_id = ? AND deleted_at IS NULL
                 ORDER BY position ASC, created_at ASC`,
              )
              .all(workspaceId, parentId)
      ) as PageRow[];
      return rows.map(rowToPage);
    },
    getDescendantIds,
    isDescendant,
    nextPosition,
    listLinks(workspaceId) {
      const rows = db
        .prepare(
          `SELECT l.from_id AS "from", l.to_id AS "to" FROM links l
           JOIN pages pf ON pf.id = l.from_id AND pf.workspace_id = l.workspace_id AND pf.deleted_at IS NULL
           JOIN pages pt ON pt.id = l.to_id AND pt.workspace_id = l.workspace_id AND pt.deleted_at IS NULL
           WHERE l.workspace_id = ?`,
        )
        .all(workspaceId) as Link[];
      return rows;
    },
    syncPageBody,
    setPageMarkdown,
    rebuildLinks(workspaceId) {
      db.transaction(() => {
        const rows = db.prepare("SELECT id, markdown FROM pages WHERE workspace_id = ? AND deleted_at IS NULL")
          .all(workspaceId) as { id: string; markdown: string }[];
        for (const row of rows) syncLinks(workspaceId, row.id, row.markdown);
      })();
    },
    countPages(workspaceId) {
      const row = db
        .prepare(
          "SELECT COUNT(*) AS n FROM pages WHERE workspace_id = ? AND deleted_at IS NULL",
        )
        .get(workspaceId) as { n: number };
      return row.n;
    },
  };
}
