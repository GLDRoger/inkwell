#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { cases, diaryLinks } from './cases.mjs';

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

/** Incremental UTF-8 SSE reader: comments, multiline data, CR/LF/CRLF, no deduplication. */
export async function readSSE(body, onEvent, signal) {
  const reader = body.getReader();
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const decoder = new TextDecoder();
  let buffer = '', data = [];
  function line(value) {
    if (!value) {
      if (data.length) onEvent(JSON.parse(data.join('\n')));
      data = [];
    } else if (value === 'data' || value.startsWith('data:')) {
      data.push(value === 'data' ? '' : value.slice(5).replace(/^ /, ''));
    }
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let match;
      while ((match = /[\r\n]/.exec(buffer))) {
        const i = match.index;
        if (!done && buffer[i] === '\r' && i === buffer.length - 1) break;
        const width = buffer[i] === '\r' && buffer[i + 1] === '\n' ? 2 : 1;
        line(buffer.slice(0, i));
        buffer = buffer.slice(i + width);
      }
      if (done) break; // Incomplete frames at EOF are not dispatched.
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createClient(base, signal) {
  const cookies = new Map();
  async function request(path, { method = 'GET', body, stream = false, requestSignal = signal } = {}) {
    const response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      method, signal: requestSignal, redirect: 'error',
      headers: { ...(cookies.size ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0], split = pair.indexOf('=');
      cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
    if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    if (stream) {
      if (!response.headers.get('content-type')?.includes('text/event-stream')) {
        await response.body?.cancel();
        throw new Error(`${path}: expected text/event-stream`);
      }
      return response;
    }
    return response.status === 204 ? null : response.json();
  }
  return { request, get: (path) => request(path), post: (path, body) => request(path, { method: 'POST', body }) };
}

export function runFamily(allRuns, rootId) {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const run of allRuns.values()) {
      if (ids.has(run.parentRunId) && !ids.has(run.id)) { ids.add(run.id); changed = true; }
    }
  }
  return [...ids].map((id) => allRuns.get(id)).filter(Boolean);
}

function metrics(state, started) {
  const ids = new Set(state.runs.map((run) => run.id));
  const entries = state.entries.filter((entry) => ids.has(entry.runId) && entry.role === 'agent');
  const relevant = state.events.filter(({ event }) => ids.has(event.runId) || ids.has(event.run?.id)
    || ids.has(event.entry?.runId) || (event.type === 'diary.delta' && event.threadId === state.threadId));
  const deltasBeforeFinal = entries.map((entry) => {
    const first = relevant.findIndex(({ event }) => event.type === 'diary.delta' && event.entryId === entry.id);
    const final = relevant.findIndex(({ event }) => event.type === 'diary.entry' && event.entry.id === entry.id && event.entry.text === entry.text);
    return first >= 0 && final > first;
  });
  const tokenValues = state.runs.map((run) => run.usage?.totalTokens ?? run.totalTokens ?? null);
  return {
    wallMs: Date.now() - started,
    steps: state.runs.reduce((n, r) => n + r.steps.length, 0),
    failedToolSteps: state.runs.reduce((n, r) => n + r.steps.filter((s) => !s.ok).length, 0),
    tokens: tokenValues.length && tokenValues.every(Number.isFinite) ? tokenValues.reduce((a, b) => a + b, 0) : null,
    footprints: relevant.some(({ event }) => event.type === 'agent.moved'),
    deltaBeforeFinal: deltasBeforeFinal.some(Boolean),
    deltaCount: relevant.filter(({ event }) => event.type === 'diary.delta').length,
  };
}

export async function runCase(testCase, { base = 'http://localhost:8787', pollMs = 500, settleMs = 250 } = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timed out after ${testCase.timeoutMs}ms`)), testCase.timeoutMs);
  const api = createClient(base, controller.signal);
  const allRuns = new Map();
  const state = { api, events: [], runs: [], pages: [], before: [], entries: [], agents: [], fixture: {}, rootId: null, threadId: null };
  let streamTask, streamError, stopping = false, checks = [], error = null;
  try {
    state.workspaceId = (await api.get('/api/me')).workspaceId;
    state.agents = await api.get('/api/agents');
    state.pages = await api.get('/api/pages');
    state.page = (title) => {
      const found = state.pages.find((p) => p.title === title);
      if (!found) throw new Error(`Missing fixture page: ${title}`);
      return found;
    };
    state.fixture = (await testCase.setup?.(state)) ?? {};
    const before = await api.get('/api/pages');
    state.before = await Promise.all(before.map((p) => api.get(`/api/pages/${p.id}`)));
    // Subscribe before submitting: fast failures and first ink may precede POST's response.
    const stream = await api.request('/api/events', { stream: true });
    streamTask = readSSE(stream.body, (event) => {
      state.events.push({ atMs: Date.now() - started, event });
      if (event.type === 'run.updated') allRuns.set(event.run.id, event.run);
    }, controller.signal).then(() => { if (!stopping) streamError = new Error('SSE stream ended before completion'); })
      .catch((err) => { if (!stopping) streamError = err; });
    const agent = testCase.agent ? state.agents.find((a) => a.name === testCase.agent) : null;
    if (testCase.agent && !agent) throw new Error(`Missing agent: ${testCase.agent}`);
    const submission = await api.post('/api/diary', {
      text: typeof testCase.prompt === 'function' ? testCase.prompt(state) : testCase.prompt,
      ...(agent ? { agentId: agent.id } : {}),
      ...(state.fixture.pageId ? { pageId: state.fixture.pageId } : {}),
    });
    state.rootId = submission.runId;
    state.threadId = submission.threadId;
    if (!state.rootId || !state.threadId) throw new Error('Diary response missing runId/threadId');
    let settledAt = null, lastFamily = '';
    while (true) {
      controller.signal.throwIfAborted();
      if (streamError) throw streamError;
      // Reconcile with REST so dropped run events cannot manufacture completion.
      const graph = await api.get('/api/map');
      for (const run of graph.runs) allRuns.set(run.id, run);
      state.runs = runFamily(allRuns, state.rootId);
      const signature = state.runs.map((r) => `${r.id}:${r.status}`).sort().join('|');
      const terminal = allRuns.has(state.rootId) && state.runs.every((r) => TERMINAL.has(r.status));
      if (!terminal || signature !== lastFamily) settledAt = null;
      lastFamily = signature;
      if (terminal) {
        settledAt ??= Date.now();
        if (Date.now() - settledAt >= settleMs) break;
      }
      await sleep(pollMs, undefined, { signal: controller.signal });
    }
    const pages = await api.get('/api/pages');
    state.pages = await Promise.all(pages.map((p) => api.get(`/api/pages/${p.id}`)));
    state.entries = await api.get(`/api/diary/${state.threadId}`);
    state.answer = state.entries.filter((e) => e.role === 'agent' && e.runId === state.rootId).map((e) => e.text).join('\n');
    if (streamError) throw streamError;
    checks.push({ ok: state.runs.every((r) => r.status === 'succeeded'), why: state.runs.map((r) => `${r.id}: ${r.status}${r.error ? ` (${r.error})` : ''}`).join('; ') });
    for (const check of [...testCase.checks, diaryLinks]) {
      try {
        const result = await check(state);
        if (typeof result?.ok !== 'boolean' || typeof result?.why !== 'string') throw new Error('Invalid check result');
        checks.push(result);
      } catch (err) { checks.push({ ok: false, why: `Check error: ${err.message}` }); }
    }
  } catch (err) {
    error = controller.signal.aborted ? controller.signal.reason.message : err.message;
    checks.push({ ok: false, why: error });
  } finally {
    clearTimeout(timeout);
    stopping = true;
    controller.abort();
    await streamTask;
    state.runs = runFamily(allRuns, state.rootId);
    // Best-effort cancellation keeps failed/timeout evals from spending indefinitely.
    if (error && state.rootId) {
      const active = new Set([state.rootId, ...state.runs.filter((r) => !TERMINAL.has(r.status)).map((r) => r.id)]);
      state.cleanupErrors = [];
      for (const id of active) {
        try { await api.request(`/api/runs/${id}/cancel`, { method: 'POST', body: {}, requestSignal: AbortSignal.timeout(3000) }); }
        catch (err) { state.cleanupErrors.push(err.message); }
      }
    }
  }
  return { name: testCase.name, pass: checks.length > 0 && checks.every((c) => c.ok), workspaceId: state.workspaceId,
    runId: state.rootId, threadId: state.threadId, checks, error, metrics: metrics(state, started),
    runs: state.runs, cleanupErrors: state.cleanupErrors ?? [] };
}

export function parseArgs(args) {
  const options = { base: 'http://localhost:8787', repeat: 1, names: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') { options.help = true; continue; }
    if (!['--base', '--case', '--repeat', '--json'].includes(arg) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid argument: ${arg}`);
    const value = args[++i];
    if (arg === '--case') options.names.push(value);
    else options[arg.slice(2)] = arg === '--repeat' ? Number(value) : value;
  }
  if (!Number.isSafeInteger(options.repeat) || options.repeat < 1) throw new Error('--repeat must be a positive integer');
  if (!['http:', 'https:'].includes(new URL(options.base).protocol)) throw new Error('--base must be HTTP(S)');
  for (const name of options.names) if (!cases.some((c) => c.name === name)) throw new Error(`Unknown case: ${name}`);
  return options;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log('node scripts/corpus/run.mjs [--base URL] [--case NAME] [--repeat N] [--json FILE]\nCases: ' + cases.map((c) => c.name).join(', '));
    return 0;
  }
  const results = [];
  for (let repetition = 1; repetition <= options.repeat; repetition++) {
    for (const testCase of cases.filter((c) => !options.names.length || options.names.includes(c.name))) {
      const result = { ...await runCase(testCase, options), repetition };
      results.push(result);
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} #${repetition}: ${result.checks.filter((c) => !c.ok).map((c) => c.why).join('; ') || 'all checks passed'}`);
    }
  }
  console.table(results.map((r) => ({ case: r.name, repeat: r.repetition, result: r.pass ? 'PASS' : 'FAIL',
    seconds: (r.metrics.wallMs / 1000).toFixed(1), steps: r.metrics.steps, failedTools: r.metrics.failedToolSteps,
    tokens: r.metrics.tokens ?? 'n/a', footprints: r.metrics.footprints, earlyInk: r.metrics.deltaBeforeFinal })));
  const passed = results.filter((r) => r.pass).length;
  const report = { at: new Date().toISOString(), base: options.base, passed, total: results.length, passRate: passed / results.length, results };
  console.log(`${passed}/${results.length} passed (${(report.passRate * 100).toFixed(1)}%)`);
  if (options.json) await writeFile(options.json, JSON.stringify(report, null, 2) + '\n');
  return passed === results.length ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }).catch((err) => { console.error(err.message); process.exitCode = 1; });
}
