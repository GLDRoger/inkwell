import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSSE, runCase, parseArgs, runFamily } from './run.mjs';
import { cases, diaryLinks } from './cases.mjs';

const exec = promisify(execFile);
const actor = { kind: 'person', id: 'visitor', name: 'Visitor' };
const agents = ['Scout', 'Wren', 'Atlas'].map((name) => ({ id: name.toLowerCase(), name }));
const output = 'Lisbon café 🪶 '.repeat(300); // 900 words: inside the 700–900 the case asks for

async function fakeServer(t, mode = 'success') {
  const sessions = new Map(), cancellations = [], timers = new Set();
  let next = 0;
  const later = (fn, ms) => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); };
  function emit(s, event) { s.stream?.write(`event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`); }
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const json = (data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      if (path === '/api/me') {
        assert.equal(req.headers.cookie, undefined, 'Each case must start without an old cookie');
        const id = `session-${++next}`;
        sessions.set(id, { pages: [{ id: 'seed', title: 'Seed', markdown: 'Keep me.', parentId: null, updatedBy: actor }], runs: [], entries: [], stream: null });
        res.setHeader('set-cookie', [`inkwell_sid=${id}; HttpOnly; Path=/`, 'aux=present; Path=/']);
        return json({ workspaceId: id, person: actor });
      }
      assert.match(req.headers.cookie ?? '', /aux=present/);
      const id = /inkwell_sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
      const s = sessions.get(id);
      if (!s) return json({ error: 'wrong session' }, 401);
      if (path === '/api/agents') return json(agents);
      if (path === '/api/map') return json({ pages: s.pages, agents, links: [], runs: s.runs });
      if (path === '/api/events') {
        res.writeHead(200, { 'content-type': mode === 'wrong-mime' ? 'application/json' : 'text/event-stream' });
        s.stream = res;
        res.write(': hello\r\n\r\n');
        return;
      }
      if (path === '/api/pages' && req.method === 'GET') return json(s.pages.map(({ markdown, ...p }) => p));
      if (path.startsWith('/api/pages/')) return json(s.pages.find((p) => p.id === path.split('/').at(-1)));
      if (path.startsWith('/api/runs/') && path.endsWith('/cancel')) { cancellations.push(path.split('/')[3]); return json({ status: 'cancelled' }); }
      if (path.startsWith('/api/diary/')) return json(s.entries);
      let raw = ''; for await (const chunk of req) raw += chunk;
      const input = raw ? JSON.parse(raw) : {};
      if (path === '/api/pages' && req.method === 'POST') {
        const p = { ...input, id: `page-${s.pages.length}`, parentId: input.parentId ?? null, updatedBy: actor };
        s.pages.push(p); return json(p, 201);
      }
      if (path !== '/api/diary' || req.method !== 'POST') return json({ error: 'not found' }, 404);
      if (mode === 'missing-route') return json({ error: 'not found' }, 404);
      assert.ok(s.stream, 'SSE must be open before POST');
      const root = { id: 'root', agentId: input.agentId, threadId: 'thread', parentRunId: null, status: 'running', steps: [], error: null };
      const child = { ...root, id: 'child', parentRunId: 'root', agentId: 'wren', steps: [] };
      const unrelated = { ...root, id: 'other', parentRunId: null };
      s.runs.push(root, unrelated);
      emit(s, { type: 'run.updated', run: root });
      if (mode === 'disconnect') s.stream.end();
      else if (mode === 'malformed') s.stream.write('data: {not json}\n\n');
      else if (!['timeout', 'missing-root'].includes(mode)) {
        if (mode === 'child') { s.runs.push(child); emit(s, { type: 'run.updated', run: child }); }
        const entry = { id: 'answer', threadId: 'thread', role: 'agent', agentId: root.agentId, text: output, runId: root.id };
        emit(s, { type: 'diary.entry', entry: { ...entry, text: '' } });
        // Deliberately repeated chunks; never deduplicate identical delta events.
        for (let i = 0; i < 300; i++) emit(s, { type: 'diary.delta', entryId: entry.id, threadId: 'thread', text: 'Lisbon café 🪶 ' });
        s.entries.push(entry);
        emit(s, { type: 'diary.entry', entry });
        emit(s, { type: 'agent.moved', runId: root.id, agentId: root.agentId, toPageId: input.pageId ?? 'seed', fromPageId: null, action: 'reading' });
        root.steps = [{ tool: 'read_page', ok: true }, { tool: 'search', ok: false }];
        root.status = mode === 'failed' ? 'failed' : mode === 'cancelled' ? 'cancelled' : 'succeeded';
        root.error = mode === 'failed' ? "Meta API key isn't configured" : null;
        if (mode === 'tokens') root.usage = { totalTokens: 123 };
        emit(s, { type: 'run.updated', run: root });
        if (mode === 'child') later(() => {
          const p = s.pages.find((p) => p.id === input.pageId);
          p.markdown = 'Wren completed the edit.';
          p.updatedBy = { kind: 'agent', id: 'wren', name: 'Wren' };
          child.status = 'succeeded'; child.steps = [{ tool: 'edit_page', ok: true }];
          emit(s, { type: 'run.updated', run: child });
        }, 120);
      }
      if (mode === 'missing-root') s.runs = [unrelated];
      return json({ runId: mode === 'missing-root' ? 'absent' : root.id, threadId: 'thread', entry: { text: input.text } });
    } catch (err) { json({ error: err.message }, 500); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { for (const timer of timers) clearTimeout(timer); for (const s of sessions.values()) s.stream?.destroy(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}`, sessions, cancellations };
}

const probe = {
  name: 'probe', agent: 'Scout', timeoutMs: 3000,
  setup: async (s) => ({ pageId: (await s.api.post('/api/pages', { title: 'Probe', markdown: 'Before.' })).id }),
  prompt: 'Exercise the public API',
  checks: [
    (s) => ({ ok: s.answer === output, why: 'Persisted diary read via REST' }),
    cases.find((c) => c.name === 'long_diary_stream').checks[1],
  ],
};
const fast = { pollMs: 5, settleMs: 15 };

test('SSE handles split UTF-8, CRLF, multiline data, comments, repeated messages and incomplete EOF', async () => {
  const text = ': heartbeat\r\nevent: diary.delta\r\ndata: {"type":"diary.delta",\r\ndata: "text":"café 🪶"}\r\n\r\n' +
    'data: {"text":"same"}\n\ndata: {"text":"same"}\r\rdata: {"incomplete":true}';
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } });
  const events = [];
  await readSSE(stream, (e) => events.push(e));
  assert.deepEqual(events, [{ type: 'diary.delta', text: 'café 🪶' }, { text: 'same' }, { text: 'same' }]);
});

test('fresh cookies, setup, early SSE events, persisted checks and friction metrics', async (t) => {
  const fake = await fakeServer(t);
  const a = await runCase(probe, { ...fake, ...fast });
  const b = await runCase(probe, { ...fake, ...fast });
  assert.equal(a.pass, true, JSON.stringify(a)); assert.equal(b.pass, true);
  assert.notEqual(a.workspaceId, b.workspaceId);
  assert.equal(fake.sessions.size, 2);
  assert.equal(a.metrics.steps, 2); assert.equal(a.metrics.failedToolSteps, 1);
  assert.equal(a.metrics.tokens, null); assert.equal(a.metrics.footprints, true);
  assert.equal(a.metrics.deltaBeforeFinal, true); assert.equal(a.metrics.deltaCount, 300);
  assert.equal(a.runs.length, 1, 'Unrelated running tasks do not block completion');
});

test('parent terminal is not completion while a child is still running', async (t) => {
  const fake = await fakeServer(t, 'child');
  const result = await runCase({ ...probe, checks: [...probe.checks, (s) => ({ ok: s.pages.some((p) => p.id === s.fixture.pageId && p.markdown === 'Wren completed the edit.'), why: 'Child edit persisted' })] }, { ...fake, ...fast });
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.runs.length, 2); assert.equal(result.metrics.steps, 3);
});

test('provider failure and cancellation cannot pass even if outcome checks pass', async (t) => {
  for (const mode of ['failed', 'cancelled']) {
    const fake = await fakeServer(t, mode);
    const result = await runCase(probe, { ...fake, ...fast });
    assert.equal(result.pass, false);
    assert.match(result.checks[0].why, mode === 'failed' ? /Meta API key isn't configured/ : /cancelled/);
  }
});

test('optional exposed total token usage is recorded', async (t) => {
  const fake = await fakeServer(t, 'tokens');
  assert.equal((await runCase(probe, { ...fake, ...fast })).metrics.tokens, 123);
});

test('timeout and missing root fail and cancel instead of passing vacuously', async (t) => {
  for (const mode of ['timeout', 'missing-root']) {
    const fake = await fakeServer(t, mode);
    const result = await runCase({ ...probe, timeoutMs: 180 }, { ...fake, ...fast });
    assert.equal(result.pass, false); assert.match(result.error, /Timed out/);
    assert.ok(fake.cancellations.includes(mode === 'missing-root' ? 'absent' : 'root'));
  }
});

test('HTTP, SSE disconnect, invalid MIME and malformed event errors fail cleanly', async (t) => {
  for (const [mode, error] of [['missing-route', /HTTP 404/], ['disconnect', /SSE stream ended/], ['wrong-mime', /expected text\/event-stream/], ['malformed', /JSON/]]) {
    const fake = await fakeServer(t, mode);
    const result = await runCase(probe, { ...fake, ...fast });
    assert.equal(result.pass, false); assert.match(result.error, error);
  }
});

test('failed or throwing checks cannot produce a pass', async (t) => {
  const fake = await fakeServer(t);
  const result = await runCase({ ...probe, checks: [() => ({ ok: false, why: 'missing edit' }), () => { throw new Error('broken oracle'); }] }, { ...fake, ...fast });
  assert.equal(result.pass, false);
  assert.deepEqual(result.checks.slice(1, 3), [{ ok: false, why: 'missing edit' }, { ok: false, why: 'Check error: broken oracle' }]);
});

test('diary links must lead to the pages they name', () => {
  const pages = [{ id: 'trip', title: 'Trip to Lisbon' }, { id: 'plan', title: 'Startup: launch plan' }];
  const ok = (answer) => diaryLinks({ answer, pages }).ok;
  assert.equal(ok('See [Trip to Lisbon](/p/trip) and [the launch plan](/p/plan).'), true);
  assert.equal(ok('See [**Trip to Lisbon**](/p/trip).'), true);
  assert.equal(ok('See [Trip to Lisbon](/p/trlp).'), false, 'a mis-copied id');
  assert.equal(ok('See [Trip to Lisbon](/p/plan).'), false, 'another page\'s id');
});

test('ambiguous_tidy accepts a kept recipe with additions or its name as the title, rejects a lost line', () => {
  const c = cases.find((c) => c.name === 'ambiguous_tidy');
  const original = 'Recipe: Lemon chickpea skillet\n\nChickpeas, lemon, garlic. Cook in one pan for 20 minutes.';
  const state = (markdown, title = 'Untitled dinner note') => ({ fixture: { pageId: 'note' }, before: [{ id: 'note', markdown: original }], pages: [{ id: 'note', title, markdown }] });
  assert.equal(c.checks[1](state(`${original}\n\nSee also [Weeknight dinners](/p/dinners).`)).ok, true);
  assert.equal(c.checks[1](state('From [Recipes](/p/r).\n\nChickpeas, lemon, garlic. Cook in one pan for 20 minutes.', 'Lemon chickpea skillet')).ok, true, 'the name became the title');
  assert.equal(c.checks[1](state('From [Recipes](/p/r).\n\nChickpeas, lemon, garlic. Cook in one pan for 20 minutes.', 'Dinner')).ok, false, 'the name is lost');
  assert.equal(c.checks[1](state('Recipe: Lemon chickpea skillet\n\nChickpeas, lemon, garlic.')).ok, false);
});

test('long_diary_stream rejects an answer far past the requested length', () => {
  const c = cases.find((c) => c.name === 'long_diary_stream');
  assert.equal(c.checks[0]({ answer: 'word '.repeat(800) }).ok, true);
  assert.equal(c.checks[0]({ answer: 'word '.repeat(1400) }).ok, false);
});

test('long-page oracle rejects truncation and unrelated edits, accepts only target change', async () => {
  const c = cases.find((c) => c.name === 'edit_long_page');
  let page;
  const fixture = await c.setup({ api: { post: async (_path, input) => (page = { ...input, id: 'long' }) } });
  assert.ok(page.markdown.length > 28_000 && page.markdown.length < 35_000);
  const state = { fixture, before: [page], pages: [{ ...page, markdown: page.markdown.replace('within 30 days', 'within 45 days') }] };
  assert.ok(c.checks.every((fn) => fn(state).ok));
  state.pages[0].markdown = state.pages[0].markdown.slice(0, 25_000);
  assert.equal(c.checks[2](state).ok, false);
  state.pages[0].markdown = page.markdown.replace('within 30 days', 'within 45 days').replace('amber-1-intact', 'oops');
  assert.equal(c.checks[2](state).ok, false);
});

test('CLI validates options; filter, repeat, JSON and failure exit code work end-to-end', async (t) => {
  assert.throws(() => parseArgs(['--repeat', '0']), /positive integer/);
  assert.throws(() => parseArgs(['--case', 'typo']), /Unknown case/);
  assert.throws(() => parseArgs(['--base']), /Invalid argument/);
  const fake = await fakeServer(t, 'missing-route');
  const dir = await mkdtemp(join(tmpdir(), 'inkwell-corpus-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const reportPath = join(dir, 'report.json');
  let failed;
  try { await exec(process.execPath, ['scripts/corpus/run.mjs', '--base', fake.base, '--case', 'summarise_page', '--repeat', '2', '--json', reportPath]); }
  catch (err) { failed = err; }
  assert.equal(failed?.code, 1);
  assert.match(failed.stdout, /0\/2 passed/);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.total, 2); assert.equal(report.passRate, 0);
  assert.ok(report.results.every((r) => r.name === 'summarise_page'));
  assert.equal(new Set(report.results.map((r) => r.workspaceId)).size, 2);
});


test('family discovery includes out-of-order grandchildren but excludes unrelated runs', () => {
  const all = new Map([
    ['grandchild', { id: 'grandchild', parentRunId: 'child' }],
    ['other', { id: 'other', parentRunId: null }],
    ['child', { id: 'child', parentRunId: 'root' }],
    ['root', { id: 'root', parentRunId: null }],
  ]);
  assert.deepEqual(runFamily(all, 'root').map((r) => r.id).sort(), ['child', 'grandchild', 'root']);
});

test('explicit stream cancellation settles a pending reader', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const reading = readSSE(stream, () => {}, controller.signal);
  controller.abort();
  await reading;
  assert.equal(cancelled, true);
});

test('CLI success exits zero against fake long-answer stream', async (t) => {
  const fake = await fakeServer(t);
  const { stdout } = await exec(process.execPath, ['scripts/corpus/run.mjs', '--base', fake.base, '--case', 'long_diary_stream']);
  assert.match(stdout, /1\/1 passed \(100.0%\)/);
});
