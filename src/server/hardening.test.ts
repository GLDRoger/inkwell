// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServices, type Services } from './services.ts';
import { createApp } from './main.ts';
import { createWorkspaceSession } from './session.ts';
import { extractPageLinkIds } from './editor-schema.ts';

let s: Services;
let dir: string;
let ctx: ReturnType<typeof createWorkspaceSession>;
let app: ReturnType<typeof createApp>;
let cookie: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-hardening-'));
  s = createServices(dir);
  ctx = createWorkspaceSession(s);
  cookie = `inkwell_sid=${ctx.sessionId}`;
  app = createApp(s);
});
afterEach(async () => { vi.restoreAllMocks(); s.bus.close(); await s.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const json = (url: string, body: unknown, method = 'POST') => app.request(url, {
  method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
});
it('rejects oversized ignored JSON before parsing, including chunked bodies', async () => {
  for (const url of ['/api/pages', '/api/agents', '/api/presence']) {
    const body = JSON.stringify({ title: 'probe', name: 'probe', ignored: 'x'.repeat(600_000) });
    for (const headers of [{ 'content-length': String(body.length) }, { 'transfer-encoding': 'chunked' }]) {
      const r = await app.request(url, { method: 'POST', headers: { cookie, ...headers }, body });
      expect(r.status).toBe(413);
      expect(await r.json()).toHaveProperty('error');
    }
  }
});
it('rejects bad position without poisoning the next create at both boundaries', async () => {
  const page = s.pages.createPage(ctx.workspaceId, ctx.person, { title: 'probe' });
  expect((await json(`/api/pages/${page.id}`, { position: 'z!' }, 'PATCH')).status).toBe(400);
  expect((await json('/api/pages', { title: 'after' })).status).toBe(201);
  expect(() => s.pages.updatePage(ctx.workspaceId, ctx.person, page.id, { position: 'z!' })).toThrow();
  expect(() => s.pages.createPage(ctx.workspaceId, ctx.person, { position: 'z!' })).toThrow();
});
it('rebuilds every seed forward link after targets exist', () => {
  const pages = s.pages.listPages(ctx.workspaceId);
  const expected = pages.flatMap(p => extractPageLinkIds(s.pages.getPageRow(ctx.workspaceId, p.id)!.markdown)
    .filter(to => to !== p.id).map(to => `${p.id}:${to}`));
  const actual = s.pages.listLinks(ctx.workspaceId).map(l => `${l.from}:${l.to}`);
  expect(actual.sort()).toEqual([...new Set(expected)].sort());
});
it('rejects invalid and foreign presence page IDs', async () => {
  expect((await json('/api/presence', { pageId: 'x'.repeat(100_000) })).status).toBe(413);
  const other = createWorkspaceSession(s);
  expect((await json('/api/presence', { pageId: s.pages.listPages(other.workspaceId)[0]!.id })).status).toBe(400);
  expect(s.bus.getPresence(ctx.workspaceId)).toEqual([]);
});
it('disconnects a stalled SSE subscriber rather than retaining the probe backlog', async () => {
  const response = await app.request('/api/events', { headers: { cookie } });
  for (let i = 0; i < 1000; i++) s.bus.publish(ctx.workspaceId, { type: 'diary.delta', threadId: 'thread', entryId: 'entry', text: 'x'.repeat(10_000) });
  // Cleanup even on the pre-fix failure.
  const count = s.bus.subscriberCount(ctx.workspaceId);
  await response.body!.cancel();
  expect(count).toBe(0);
});
it('refuses workspace uploads over quota', async () => {
  s.db.prepare(`INSERT INTO attachments VALUES (?, ?, 'image', 'old', 'image/png', ?, 'old.png', ?)`)
    .run('old', ctx.workspaceId, 100 * 1024 * 1024, new Date().toISOString());
  const form = new FormData(); form.append('file', new File(['small'], 'x.png', { type: 'image/png' }));
  expect((await app.request('/api/uploads', { method: 'POST', headers: { cookie }, body: form })).status).toBe(413);
});

it('bounds patch bodies and markdown and also guards direct storage writes', async () => {
  const page = s.pages.createPage(ctx.workspaceId, ctx.person, { title: 'bounded' });
  expect((await json(`/api/pages/${page.id}`, { ignored: 'x'.repeat(600_000) }, 'PATCH')).status).toBe(413);
  expect((await json('/api/pages', { markdown: 'x'.repeat(200_001) })).status).toBe(400);
  expect(() => s.pages.syncPageBody(ctx.workspaceId, page.id, { markdown: 'oversize', ydoc: Buffer.alloc(4 * 1024 * 1024 + 1) })).toThrow('4 MB');
  expect(s.pages.getPageRow(ctx.workspaceId, page.id)!.markdown).toBe('');
});
