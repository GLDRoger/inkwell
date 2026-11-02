#!/usr/bin/env node
/** End-to-end replay check through public HTTP/SSE (no model calls). Server must be running. */
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, readSSE } from '../corpus/run.mjs';

const base = process.argv[2] ?? 'http://localhost:8787';
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(new Error('Demo replay exceeded 150 seconds')), 150_000);
const api = createClient(base, controller.signal);
const events = [];
let streamTask;
const began = Date.now();
try {
  await api.get('/api/me');
  const stream = await api.request('/api/events?notebook=demo', { stream: true });
  streamTask = readSSE(stream.body, event => events.push(event), controller.signal);
  const started = await api.post('/api/demo/start', {});
  assert.equal(started.playing, true);
  while (!events.some(e => e.type === 'demo.ended')) {
    controller.signal.throwIfAborted();
    await sleep(100, undefined, { signal: controller.signal });
  }
  const elapsedMs = Date.now() - began;
  const steps = [...new Set(events.filter(e => e.type === 'demo.step').map(e => e.step.id))];
  assert.deepEqual(steps, ['plan', 'voice', 'handoff', 'photo', 'cover', 'tidy', 'lens', 'tick', 'cost', 'price']);
  assert(events.some(e => e.type === 'lens.shown' && e.lens.groups.length >= 2));
  assert(events.some(e => e.type === 'lens.cleared'));
  assert(events.some(e => e.type === 'demo.step' && e.step.id === 'cost' && e.focus.circledPageIds?.length === 3));
  const updates = events.filter(e => e.type === 'widget.updated').map(e => e.widget);
  const progress = updates.filter(w => w.data.kind === 'progress');
  assert(progress.some(w => w.data.done === 5 && w.data.total === 13), 'Initial launch progress is 5/13');
  assert(progress.some(w => w.data.done === 6 && w.data.total === 13), 'Person tick changes progress to 6/13');
  const totals = updates.filter(w => w.data.kind === 'total');
  assert(totals.some(w => w.data.amount === 1027), 'Initial trip budget is €1027');
  assert(totals.some(w => w.data.amount === 1087), 'Apartment edit changes budget to €1087');
  const runs = new Map(events.filter(e => e.type === 'run.updated' && e.run.recorded).map(e => [e.run.id, e.run]));
  assert(runs.size >= 7, 'All recorded runs were announced');
  for (const run of runs.values()) {
    assert.equal(run.status, 'succeeded', `${run.id}: ${run.error}`);
    assert(run.steps.every(step => step.ok), `Every tool in ${run.id} succeeded`);
  }
  const graph = await api.get('/api/map?notebook=demo');
  assert.equal(graph.lens, null);
  assert.equal(graph.widgets.length, 3);
  assert.equal(graph.widgets.find(w => w.data.kind === 'progress')?.data.done, 6);
  assert.equal(graph.widgets.find(w => w.data.kind === 'total')?.data.amount, 1087);
  console.log(JSON.stringify({ ok: true, elapsedMs, steps, recordedRuns: runs.size, widgetUpdates: updates.map(w => ({ id: w.id, title: w.title, data: w.data })) }, null, 2));
} finally {
  clearTimeout(timer);
  controller.abort();
  await streamTask?.catch(() => {});
}
