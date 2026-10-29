// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEventBus, createEventsApp } from './events.ts';
import { createServices, type Services } from './services.ts';
import { createWorkspaceSession, type AppEnv } from './session.ts';

let s: Services, dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-hardening-events-')); s = createServices(dir); });
afterEach(async () => { vi.useRealTimers(); s.bus.close(); await s.close(); fs.rmSync(dir, { recursive: true, force: true }); });
function appFor(ctx: ReturnType<typeof createWorkspaceSession>, limits = {}) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => { c.set('ctx', ctx); await next(); });
  app.route('/', createEventsApp(s.bus, { pages: s.pages, ...limits }));
  return app;
}
it('closes the oldest session stream when a seventh tab opens', async () => {
  const ctx = createWorkspaceSession(s), app = appFor(ctx);
  const responses: Response[] = [];
  for (let i = 0; i < 7; i++) responses.push(await app.request('/api/events'));
  expect(s.bus.subscriberCount(ctx.workspaceId)).toBe(6);
  expect((await responses[0]!.body!.getReader().read()).done).toBe(true);
  await Promise.all(responses.slice(1).map(r => r.body!.cancel()));
  expect(s.bus.subscriberCount(ctx.workspaceId)).toBe(0);
});
it('caps global streams and releases the slot on cancellation', async () => {
  const ctx = createWorkspaceSession(s), app = appFor(ctx, { maxStreams: 1 });
  const first = await app.request('/api/events');
  expect((await app.request('/api/events')).status).toBe(503);
  await first.body!.cancel();
  const retry = await app.request('/api/events'); expect(retry.status).toBe(200); await retry.body!.cancel();
});
it('accepts live same-tenant presence and ignores disconnected presence', async () => {
  const ctx = createWorkspaceSession(s), app = appFor(ctx);
  const post = () => app.request('/api/presence', { method: 'POST', body: JSON.stringify({ pageId: s.pages.listPages(ctx.workspaceId)[0]!.id }) });
  expect((await post()).status).toBe(204); expect(s.bus.getPresence(ctx.workspaceId)).toHaveLength(0);
  const stream = await app.request('/api/events');
  expect((await post()).status).toBe(204); expect(s.bus.getPresence(ctx.workspaceId)[0]!.pageId).toBeTruthy();
  await stream.body!.cancel(); expect(s.bus.getPresence(ctx.workspaceId)).toHaveLength(0);
});
it('expires and bounds presence even for internal callers', () => {
  vi.useFakeTimers();
  const bus = createEventBus();
  for (let i = 0; i < 2001; i++) bus.setPresence('workspace', { id: String(i), name: 'Visitor', pageId: null });
  expect(bus.getPresence('workspace')).toHaveLength(2000);
  vi.advanceTimersByTime(70_000); expect(bus.getPresence('workspace')).toHaveLength(0);
  bus.close();
});
