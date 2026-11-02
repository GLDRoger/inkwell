// @vitest-environment node
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { computeWidgetData, getLens, getWidget, listWidgets, newWidget, saveLens, saveWidget, widgetPosition } from "./widgets.ts";
import { createFixture } from "./agents/testing.ts";
import type { Services } from "./services.ts";
import { newId, nowIso, purgeWorkspaceContent } from "./db.ts";
import { applyJSONToYDoc, markdownToTiptapJSON } from "./editor-schema.ts";

const fixtures: { services: Services; dir: string }[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) { await f.services.close(); fs.rmSync(f.dir, { recursive: true, force: true }); } });
const progress = { kind: "progress" as const, done: 0, total: 0, perPage: [] };
describe("widget computation", () => {
  it("counts task markers and preserves source order", () => {
    expect(computeWidgetData(progress, [{ id: "b", markdown: "- [x] done\n* [X] DONE\n  - [ ] open\nnot - [x] a task" }, { id: "a", markdown: "No tasks" }])).toEqual({ kind: "progress", done: 2, total: 3, perPage: [{ pageId: "b", done: 2, total: 3 }, { pageId: "a", done: 0, total: 0 }] });
  });
  it.each(["€12", "€ 12", "12€", "12 €", "€12–15", "€12-15"])("reads %s without counting the range twice", amount => {
    expect(computeWidgetData({ kind: "total", currency: "€", amount: 0, lines: [] }, [{ id: "p", markdown: `- **Dinner** ${amount}` }])).toMatchObject({ amount: 12, lines: [{ pageId: "p", label: expect.stringContaining("Dinner"), amount: 12 }] });
  });
  it.each(["$", "£"])("reads symbol-first %s amounts only", currency => {
    expect(computeWidgetData({ kind: "total", currency, amount: 0, lines: [] }, [{ id: "p", markdown: `${currency}12 + ${currency} 12.50 + ${currency}1,200; 20${currency}; €50` }])).toMatchObject({ amount: 1224.5, lines: expect.any(Array) });
  });
  it("skips total lines after markdown/list markers; sums and rounds cents", () => {
    const d = computeWidgetData({ kind: "total", currency: "€", amount: 0, lines: [] }, [{ id: "p", markdown: "- **TOTAL**: €900\n* Total €100\n1. **Total** €200\n€1,200\n€12.50\n€0.10 + €0.20\n€1.005\n" + "a".repeat(80) + " €2" }]);
    expect(d).toMatchObject({ amount: 1215.81 });
    if (d.kind === "total") expect(d.lines.at(-1)?.label).toHaveLength(60);
  });
  it("leaves static data unchanged", () => {
    for (const data of [{ kind: "countdown" as const, date: "2026-12-04", label: "Launch" }, { kind: "facts" as const, items: [{ label: "A", value: "B" }] }]) expect(computeWidgetData(data, [])).toBe(data);
  });
});

it("removes deleted sources from widgets/lens and purges notebook state", () => {
  const f = createFixture(fixtures);
  const { db, bus, pages } = f.services;
  const other = pages.createPage(f.ws, f.session.person, { title: "Other", markdown: "- [x] yes" });
  const widget = newWidget(f.session.person, "Progress", [f.page.id, other.id], progress, { x: 0, y: 0 });
  saveWidget(db, bus, f.ws, widget);
  const staticWidget = newWidget(f.session.person, "Date", [other.id], { kind: "countdown", date: "2026-12-04", label: "Launch" }, { x: 0, y: 220 });
  saveWidget(db, bus, f.ws, staticWidget);
  saveLens(db, bus, f.ws, { id: newId(), title: "State", kind: "columns", groups: [{ label: "Work", pageIds: [f.page.id, other.id] }], agentId: null, runId: null, createdAt: nowIso() });
  pages.deletePage(f.ws, f.page.id);
  expect(getWidget(db, f.ws, widget.id)?.pageIds).toEqual([other.id]);
  expect(getLens(db, f.ws)?.groups[0]?.pageIds).toEqual([other.id]);
  pages.deletePage(f.ws, other.id);
  expect(getWidget(db, f.ws, widget.id)).toBeNull();
  expect(getWidget(db, f.ws, staticWidget.id)?.pageIds).toEqual([]);
  db.transaction(() => purgeWorkspaceContent(db, f.ws))();
  expect(listWidgets(db, f.ws)).toEqual([]); expect(getLens(db, f.ws)).toBeNull();
});

it("recomputes from a live person's collab edit and emits only changed data", async () => {
  const f = createFixture(fixtures);
  const { db, bus, collab } = f.services;
  const widget = newWidget(f.session.person, "Progress", [f.page.id], progress, { x: 0, y: 0 });
  saveWidget(db, bus, f.ws, widget);
  const conn = await collab.openDirect(f.page.id, f.ws, f.session.person);
  await conn.transact(doc => applyJSONToYDoc(doc, markdownToTiptapJSON("- [ ] Task")));
  await expect.poll(() => getWidget(db, f.ws, widget.id)?.data).toMatchObject({ total: 1, done: 0 });
  f.events.length = 0;
  await conn.transact(doc => applyJSONToYDoc(doc, markdownToTiptapJSON("- [x] Task")));
  await expect.poll(() => getWidget(db, f.ws, widget.id)?.data).toMatchObject({ total: 1, done: 1 });
  expect(f.events.filter(e => e.type === "widget.updated")).toHaveLength(1);
  await conn.transact(doc => applyJSONToYDoc(doc, markdownToTiptapJSON("- [x] Renamed task")));
  await new Promise(r => setTimeout(r, 500));
  expect(f.events.filter(e => e.type === "widget.updated")).toHaveLength(1);
  await conn.disconnect();
});

it("nudges placement clear of all existing widget boxes", () => {
  const f = createFixture(fixtures);
  const source = { ...f.page, x: 20, y: 10 };
  const widget = newWidget(f.session.person, "A", [], progress, { x: 380, y: 10 });
  expect(widgetPosition([source], [widget])).toEqual({ x: 380, y: 230 });
  expect(widgetPosition([], [])).toEqual({ x: 0, y: 0 });
});
