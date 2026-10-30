import fs from 'node:fs';
import path from 'node:path';
import type { Services } from './services.ts';

/** Notebooks nobody has opened for this long are deleted (testers come back after weeks). */
export const IDLE_WORKSPACE_DAYS = 90;

/** Delete only idle workspaces; filesystem cleanup is durably retried after DB commit. */
export async function cleanIdleWorkspaces(services: Services, options: { maxIdleDays: number }): Promise<number> {
  if (!Number.isFinite(options.maxIdleDays) || options.maxIdleDays <= 0) throw new Error('maxIdleDays must be positive');
  const { db, bus, collab, uploadsDir } = services;
  const cutoff = new Date(Date.now() - options.maxIdleDays * 86_400_000).toISOString();
  let deleted = 0;
  db.transaction(() => {
    const stale = db.prepare(`SELECT w.id FROM workspaces w WHERE w.created_at < ?
      AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.workspace_id = w.id AND COALESCE(s.last_seen_at, s.created_at) >= ?)
      AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.workspace_id = w.id AND r.status IN ('queued', 'running'))`).all(cutoff, cutoff) as { id: string }[];
    for (const { id } of stale) {
      if (bus.subscriberCount(id)) continue;
      const pageIds = db.prepare('SELECT id FROM pages WHERE workspace_id = ?').all(id) as { id: string }[];
      if (pageIds.some(page => collab.isLoaded(page.id))) continue;
      db.prepare('INSERT OR IGNORE INTO pending_file_deletions (path) SELECT path FROM attachments WHERE workspace_id = ?').run(id);
      // All tenant tables, in FK order. pages.ydoc is removed along with the page.
      for (const table of ['diary_entries', 'runs', 'diary_threads', 'agents', 'attachments', 'links', 'pages_fts', 'pages', 'sessions', 'people']) {
        // Table names are an internal constant allowlist, never request data.
        db.prepare(`DELETE FROM ${table} WHERE workspace_id = ?`).run(id);
      }
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
      deleted++;
    }
  })();
  const pending = db.prepare('SELECT path FROM pending_file_deletions').all() as { path: string }[];
  for (const file of pending) {
    try {
      await fs.promises.rm(path.join(uploadsDir, path.basename(file.path)), { force: true });
      db.prepare('DELETE FROM pending_file_deletions WHERE path = ?').run(file.path);
    } catch (error) { console.error('[inkwell] janitor file cleanup failed', error); }
  }
  return deleted;
}

/** Run at startup and hourly. Await stop() before closing SQLite. */
export function startJanitor(services: Services, options: { maxIdleDays: number }): () => Promise<void> {
  let running: Promise<unknown> | undefined;
  const run = () => {
    if (!running) running = cleanIdleWorkspaces(services, options)
      .catch(error => console.error('[inkwell] janitor failed', error))
      .finally(() => { running = undefined; });
  };
  const timer = setInterval(run, 3_600_000);
  timer.unref();
  run();
  return async () => { clearInterval(timer); await running; };
}
