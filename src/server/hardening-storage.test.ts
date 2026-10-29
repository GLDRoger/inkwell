// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServices, type Services } from './services.ts';
import { createApp } from './main.ts';
import { createWorkspaceSession } from './session.ts';
import { cleanIdleWorkspaces, startJanitor } from './janitor.ts';
import { touchSession, openDatabase } from './db.ts';

let s: Services;
let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-hardening-storage-')); s = createServices(dir); });
afterEach(async () => { vi.restoreAllMocks(); s.bus.close(); await s.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const old = '2000-01-01T00:00:00.000Z';
function makeStale(id: string) {
  s.db.prepare('UPDATE workspaces SET created_at = ? WHERE id = ?').run(old, id);
  s.db.prepare('UPDATE sessions SET created_at = ?, last_seen_at = ? WHERE workspace_id = ?').run(old, old, id);
}
it('adds last_seen_at to legacy databases and touches at most hourly', () => {
  const ctx = createWorkspaceSession(s);
  makeStale(ctx.workspaceId);
  touchSession(s.db, ctx.sessionId);
  const stamp = () => (s.db.prepare('SELECT last_seen_at FROM sessions WHERE id = ?').get(ctx.sessionId) as { last_seen_at: string }).last_seen_at;
  const first = stamp(); expect(first).not.toBe(old);
  touchSession(s.db, ctx.sessionId); expect(stamp()).toBe(first);
  const legacyDir = path.join(dir, 'legacy');
  let handle = openDatabase(legacyDir);
  handle.db.exec('ALTER TABLE sessions DROP COLUMN last_seen_at'); handle.close();
  handle = openDatabase(legacyDir);
  expect((handle.db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).some(c => c.name === 'last_seen_at')).toBe(true);
  handle.close();
});
it('purges idle tenant rows, FTS, uploads and Yjs while preserving active tenants', async () => {
  const stale = createWorkspaceSession(s), active = createWorkspaceSession(s), live = createWorkspaceSession(s);
  makeStale(stale.workspaceId); makeStale(active.workspaceId); makeStale(live.workspaceId);
  touchSession(s.db, active.sessionId);
  const unsubscribe = s.bus.subscribe(live.workspaceId, () => {});
  fs.writeFileSync(path.join(s.uploadsDir, 'old.png'), 'file');
  s.db.prepare("INSERT INTO attachments VALUES (?, ?, 'image', 'old', 'image/png', 4, 'old.png', ?)").run('old', stale.workspaceId, old);
  expect(await cleanIdleWorkspaces(s, { maxIdleDays: 14 })).toBe(1);
  for (const table of ['workspaces', 'sessions', 'people', 'pages', 'pages_fts', 'links', 'attachments', 'diary_entries', 'diary_threads', 'agents', 'runs']) {
    const field = table === 'workspaces' ? 'id' : 'workspace_id';
    expect((s.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${field} = ?`).get(stale.workspaceId) as { n: number }).n).toBe(0);
  }
  expect(fs.existsSync(path.join(s.uploadsDir, 'old.png'))).toBe(false);
  expect(s.pages.countPages(active.workspaceId)).toBeGreaterThan(0);
  expect(s.pages.countPages(live.workspaceId)).toBeGreaterThan(0);
  unsubscribe();
});
it('keeps loaded collab documents and retries failed disk cleanup durably', async () => {
  const ctx = createWorkspaceSession(s); makeStale(ctx.workspaceId);
  const page = s.pages.listPages(ctx.workspaceId)[0]!;
  const direct = await s.collab.openDirect(page.id, ctx.workspaceId);
  expect(await cleanIdleWorkspaces(s, { maxIdleDays: 14 })).toBe(0);
  await direct.disconnect();
  s.db.prepare("INSERT INTO pending_file_deletions VALUES ('retry.png')").run();
  fs.writeFileSync(path.join(s.uploadsDir, 'retry.png'), 'old');
  const failure = vi.spyOn(fs.promises, 'rm').mockRejectedValueOnce(new Error('disk temporarily unavailable'));
  await cleanIdleWorkspaces(s, { maxIdleDays: 14 });
  expect(s.db.prepare('SELECT * FROM pending_file_deletions').all()).toHaveLength(1);
  failure.mockRestore();
  const stop = startJanitor(s, { maxIdleDays: 14 }); await stop();
  expect(s.db.prepare('SELECT * FROM pending_file_deletions').all()).toHaveLength(0);
  expect(fs.existsSync(path.join(s.uploadsDir, 'retry.png'))).toBe(false);
});
it('refuses uploads when statfs reports under 2 GB free', async () => {
  const ctx = createWorkspaceSession(s), app = createApp(s);
  vi.spyOn(fs.promises, 'statfs').mockResolvedValue({ bavail: 1, bsize: 4096 } as fs.StatsFs);
  const form = new FormData(); form.append('file', new File(['tiny'], 'x.png', { type: 'image/png' }));
  const r = await app.request('/api/uploads', { method: 'POST', headers: { cookie: `inkwell_sid=${ctx.sessionId}` }, body: form });
  expect(r.status).toBe(413); expect(fs.readdirSync(s.uploadsDir)).toHaveLength(0);
});
it('reserves upload quota atomically across concurrent writers', async () => {
  const ctx = createWorkspaceSession(s), app = createApp(s);
  s.db.prepare("INSERT INTO attachments VALUES ('old', ?, 'image', 'old', 'image/png', ?, 'old.png', ?)")
    .run(ctx.workspaceId, 100 * 1024 * 1024 - 6, old);
  const upload = () => {
    const form = new FormData(); form.append('file', new File(['four'], 'x.png', { type: 'image/png' }));
    return app.request('/api/uploads', { method: 'POST', headers: { cookie: `inkwell_sid=${ctx.sessionId}` }, body: form });
  };
  expect((await Promise.all([upload(), upload()])).map(r => r.status).sort()).toEqual([201, 413]);
});
