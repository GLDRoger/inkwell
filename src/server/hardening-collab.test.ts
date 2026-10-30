// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { createServices, type Services } from './services.ts';
import { createApp, startServer } from './main.ts';
import { createWorkspaceSession } from './session.ts';
import { MAX_YDOC_BYTES, MAX_WS_PAYLOAD_BYTES } from './limits.ts';
import { shutdown } from './shutdown.ts';
import { yDocToMarkdown } from './editor-schema.ts';

let s: Services;
let dir: string;
let server: Awaited<ReturnType<typeof startServer>>;
let ctx: ReturnType<typeof createWorkspaceSession>;
const clients: { provider: HocuspocusProvider; doc: Y.Doc }[] = [];
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean) {
  const end = Date.now() + 5000;
  while (!check()) { if (Date.now() > end) throw new Error('condition timed out'); await pause(10); }
}
function cookieSocket(cookie: string) {
  return class extends WebSocket {
    constructor(address: string, protocols?: string | string[]) { super(address, protocols, { headers: { Cookie: cookie } }); }
  };
}
async function connect(pageId: string, port = server.port, cookie = `inkwell_sid=${ctx.sessionId}`) {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({ url: `ws://127.0.0.1:${port}/collab`, name: pageId, document: doc,
    // @ts-expect-error Hocuspocus forwards this supported socket option but omits it from provider configuration.
    WebSocketPolyfill: cookieSocket(cookie) });
  clients.push({ provider, doc });
  await until(() => provider.isSynced);
  return { provider, doc };
}
function text(doc: Y.Doc) { return (doc.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText; }
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-hardening-ws-'));
  s = createServices(dir); ctx = createWorkspaceSession(s);
  server = await startServer(s, createApp(s), 0);
});
afterAll(async () => {
  for (const { provider, doc } of clients) { provider.destroy(); doc.destroy(); }
  await shutdown({ services: s, closeHttp: () => new Promise<void>(resolve => server.server.close(() => resolve())) });
  fs.rmSync(dir, { recursive: true, force: true });
});
it('rejects hidden shared types before they mutate or persist the editor', async () => {
  const page = s.pages.createPage(ctx.workspaceId, ctx.person, { markdown: 'hello' });
  const { provider, doc } = await connect(page.id);
  let closed = false; provider.on('close', () => { closed = true; });
  doc.getMap('arbitrary-hidden-state').set('blob', 'x'.repeat(100_000));
  await until(() => closed);
  provider.destroy();
  const saved = new Y.Doc(); Y.applyUpdate(saved, s.pages.getPageRow(ctx.workspaceId, page.id)!.ydoc!);
  expect([...saved.share.keys()]).toEqual(['default']); saved.destroy();
  expect(s.collab.hocuspocus.documents.get(page.id)?.share.has('arbitrary-hidden-state') ?? false).toBe(false);
});
it('enforces websocket maxPayload before accepting an oversized frame', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/collab`);
  await new Promise<void>(resolve => ws.once('open', resolve));
  let closeCode: number | undefined;
  ws.once('close', code => { closeCode = code; });
  try {
    ws.send(Buffer.alloc(MAX_WS_PAYLOAD_BYTES + 1));
    await until(() => closeCode !== undefined);
    expect(closeCode).toBe(1009);
  } finally { ws.terminate(); }
});
it('caps cumulative editor state and refuses later updates on that connection', async () => {
  const page = s.pages.createPage(ctx.workspaceId, ctx.person, { markdown: 'hello' });
  const { provider, doc } = await connect(page.id);
  let closed = false; provider.on('close', () => { closed = true; });
  for (let i = 0; i < 2; i++) {
    text(doc).insert(0, 'x'.repeat(1_500_000));
    await until(() => (s.collab.hocuspocus.documents.get(page.id)?.getXmlFragment('default').toString().length ?? 0) > (i + 1) * 1_500_000);
  }
  text(doc).insert(0, 'x'.repeat(1_500_000));
  await until(() => closed); provider.destroy();
  await until(() => (s.pages.getPageRow(ctx.workspaceId, page.id)?.ydoc?.byteLength ?? 0) > 1_000_000);
  expect(s.pages.getPageRow(ctx.workspaceId, page.id)!.ydoc!.byteLength).toBeLessThanOrEqual(MAX_YDOC_BYTES);
});
it('rate limits before queuing repeated client messages', async () => {
  const page = s.pages.createPage(ctx.workspaceId, ctx.person, { markdown: 'hello' });
  const { provider } = await connect(page.id);
  let closed = false; provider.on('close', () => { closed = true; });
  for (let i = 0; i < 150; i++) provider.sendStateless('probe');
  await until(() => closed); provider.destroy();
});
it('returns rejected agent edits as errors without corrupting the live or stored document', async () => {
  const page = s.pages.createPage(ctx.workspaceId, ctx.person, { markdown: 'hello' });
  await expect(s.collab.transact(page.id, ctx.workspaceId, doc => doc.getMap('hidden').set('x', 'bad'))).rejects.toThrow('fragment');
  await expect(s.collab.replaceMarkdown(page.id, ctx.workspaceId, 'x'.repeat(MAX_YDOC_BYTES + 1))).rejects.toThrow('4 MB');
  expect((await s.collab.readPageMarkdown(page.id, ctx.workspaceId))?.trim()).toBe('hello');
  await expect(s.collab.appendMarkdown(page.id, ctx.workspaceId, 'accepted')).resolves.toBe(true);
  expect(await s.collab.readPageMarkdown(page.id, ctx.workspaceId)).toContain('accepted');
});
it('persists peer-delivered edits on SIGTERM before SQLite closes', async () => {
  const childDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-hardening-signal-'));
  // Uses the production shutdown export with explicit wiring, independent of main.ts ownership.
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import {createServices} from './src/server/services.ts';
    import {createApp,startServer} from './src/server/main.ts';
    import {installShutdown} from './src/server/shutdown.ts';
    const services=createServices(process.env.DATA_DIR);
    const started=await startServer(services,createApp(services),0);
    installShutdown({services,closeHttp:()=>new Promise(resolve=>started.server.close(resolve))});
    console.log('PORT:'+started.port);
  `], { cwd: process.cwd(), env: { ...process.env, DATA_DIR: childDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; let errors = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; });
  try {
    await until(() => /PORT:(\d+)/.test(output));
    const port = Number(output.match(/PORT:(\d+)/)![1]);
    const response = await fetch(`http://127.0.0.1:${port}/api/me`);
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    const page = await (await fetch(`http://127.0.0.1:${port}/api/pages`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ markdown: 'original' }) })).json() as { id: string };
    const a = await connect(page.id, port, cookie), b = await connect(page.id, port, cookie);
    text(a.doc).insert(0, 'unsaved-marker ');
    await until(() => yDocToMarkdown(b.doc).includes('unsaved-marker'));
    const stopped = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)));
    child.kill('SIGTERM');
    expect(await stopped, errors).toBe(0);
    a.provider.destroy(); b.provider.destroy();
    const db = new Database(path.join(childDir, 'inkwell.db'), { readonly: true });
    try {
      const row = db.prepare('SELECT ydoc, markdown FROM pages WHERE id = ?').get(page.id) as { ydoc: Buffer; markdown: string };
      const saved = new Y.Doc(); Y.applyUpdate(saved, row.ydoc);
      expect(yDocToMarkdown(saved)).toContain('unsaved-marker'); expect(row.markdown).toContain('unsaved-marker'); saved.destroy();
    } finally { db.close(); }
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); fs.rmSync(childDir, { recursive: true, force: true }); }
}, 15_000);
it('keeps edits when the editor records position migrations (pressing Enter)', async () => {
  const page = s.pages.createPage(ctx.workspaceId, ctx.person, { markdown: 'hello' });
  const { provider, doc } = await connect(page.id);
  let closed = false; provider.on('close', () => { closed = true; });
  // What @tiptap/y-tiptap does when a paragraph is split.
  doc.transact(() => {
    doc.getMap('__tiptap_position_migrations:root:default').set('m1', new Uint8Array([1, 2, 3]));
    const para = new Y.XmlElement('paragraph'); para.insert(0, [new Y.XmlText('second line')]);
    doc.getXmlFragment('default').insert(1, [para]);
  });
  await until(() => s.collab.hocuspocus.documents.get(page.id)?.getXmlFragment('default').length === 2);
  await pause(3500); // past maxDebounce, so the store has run
  expect(closed).toBe(false);
  expect(yDocToMarkdown(s.collab.hocuspocus.documents.get(page.id)!)).toContain('second line');
  const saved = new Y.Doc(); Y.applyUpdate(saved, s.pages.getPageRow(ctx.workspaceId, page.id)!.ydoc!);
  expect(yDocToMarkdown(saved)).toContain('second line'); saved.destroy();
}, 10_000);
it('still rejects other hidden maps alongside a position store', async () => {
  const page = s.pages.createPage(ctx.workspaceId, ctx.person, { markdown: 'hello' });
  const { provider, doc } = await connect(page.id);
  let closed = false; provider.on('close', () => { closed = true; });
  doc.getMap('__tiptap_position_migrations_evil').set('blob', 'x');
  await until(() => closed);
  provider.destroy();
});
