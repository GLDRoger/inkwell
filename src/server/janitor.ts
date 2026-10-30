import fs from 'node:fs';
import path from 'node:path';
import type { Services } from './services.ts';
import { purgeWorkspaceContent } from './db.ts';

/** Notebooks nobody has opened for this long are deleted (testers come back after weeks). */
export const IDLE_WORKSPACE_DAYS = 90;

/** Delete only idle workspaces; filesystem cleanup is durably retried after DB commit. */
export async function cleanIdleWorkspaces(services: Services, options: { maxIdleDays: number }): Promise<number> {
  if (!Number.isFinite(options.maxIdleDays) || options.maxIdleDays <= 0) throw new Error('maxIdleDays must be positive');
  const { db, bus, collab } = services;
  const cutoff = new Date(Date.now() - options.maxIdleDays * 86_400_000).toISOString();
  let deleted = 0;
  db.transaction(() => {
    const stale = db.prepare(`SELECT w.id FROM workspaces w WHERE w.created_at < ?
      AND NOT EXISTS (SELECT 1 FROM sessions s WHERE (s.workspace_id = w.id OR s.demo_workspace_id = w.id) AND COALESCE(s.last_seen_at, s.created_at) >= ?)
      AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.workspace_id = w.id AND r.status IN ('queued', 'running'))`).all(cutoff, cutoff) as { id: string }[];
    for (const { id } of stale) {
      if (bus.subscriberCount(id)) continue;
      const pageIds = db.prepare('SELECT id FROM pages WHERE workspace_id = ?').all(id) as { id: string }[];
      if (pageIds.some(page => collab.isLoaded(page.id))) continue;
      purgeWorkspaceContent(db, id);
      db.prepare('DELETE FROM sessions WHERE workspace_id = ?').run(id);
      db.prepare('DELETE FROM people WHERE workspace_id = ?').run(id);
      // A demo notebook whose session goes is orphaned, and collected on a later pass.
      db.prepare('UPDATE sessions SET demo_workspace_id = NULL WHERE demo_workspace_id = ?').run(id);
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
      deleted++;
    }
  })();
  await flushFileDeletions(services);
  return deleted;
}

/** Remove files whose rows were deleted; failures stay queued for the next pass. */
export async function flushFileDeletions(services: Pick<Services, 'db' | 'uploadsDir'>): Promise<void> {
  const { db, uploadsDir } = services;
  const pending = db.prepare('SELECT path FROM pending_file_deletions').all() as { path: string }[];
  for (const file of pending) {
    try {
      await fs.promises.rm(path.join(uploadsDir, path.basename(file.path)), { force: true });
      db.prepare('DELETE FROM pending_file_deletions WHERE path = ?').run(file.path);
    } catch (error) { console.error('[inkwell] janitor file cleanup failed', error); }
  }
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
