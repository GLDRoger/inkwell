import type { Actor, Lens, Page, Widget, WidgetData } from "../shared/types.ts";
import { newId, nowIso, type Db } from "./db.ts";
import { markdownToPlainText } from "./editor-schema.ts";
import type { EventBus } from "./events.ts";
import type { CollabService } from "./collab.ts";
import { readView } from "./agents/page-edit.ts";

export interface SourcePage { id: string; markdown: string }

/** Pure: source order is preserved, including pages without any tasks/amounts. */
export function computeWidgetData(data: WidgetData, sources: SourcePage[]): WidgetData {
  if (data.kind === "progress") {
    const perPage = sources.map(({ id, markdown }) => {
      const tasks = [...markdown.matchAll(/^\s*[-*]\s+\[([ x])\]/gim)];
      return { pageId: id, done: tasks.filter(m => m[1]!.toLowerCase() === "x").length, total: tasks.length };
    });
    return { kind: "progress", done: perPage.reduce((n, p) => n + p.done, 0), total: perPage.reduce((n, p) => n + p.total, 0), perPage };
  }
  if (data.kind !== "total") return data;
  const symbol = data.currency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const number = "(\\d+(?:,\\d{3})*(?:\\.\\d+)?)";
  const pattern = new RegExp(`${symbol}\\s*${number}${data.currency === "€" ? `|${number}\\s*${symbol}` : ""}`, "g");
  const lines: Extract<WidgetData, { kind: "total" }>["lines"] = [];
  for (const source of sources) for (const line of source.markdown.split(/\r?\n/)) {
    const label = markdownToPlainText(line).replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|\[[ x]\]\s*)+/i, "").trim();
    if (/^total\b/i.test(label)) continue;
    for (const match of line.matchAll(pattern)) {
      const amount = Number((match[1] ?? match[2])!.replaceAll(",", ""));
      if (Number.isFinite(amount)) lines.push({ pageId: source.id, label: label.slice(0, 60), amount });
    }
  }
  return { kind: "total", currency: data.currency, amount: Math.round((lines.reduce((n, l) => n + l.amount, 0) + Number.EPSILON) * 100) / 100, lines };
}

interface WidgetRow { id: string; title: string; x: number; y: number; page_ids: string; data: string; created_by: string; created_at: string; updated_at: string }
const fromRow = (r: WidgetRow): Widget => ({ id: r.id, title: r.title, x: r.x, y: r.y, pageIds: JSON.parse(r.page_ids), data: JSON.parse(r.data), createdBy: JSON.parse(r.created_by), createdAt: r.created_at, updatedAt: r.updated_at });
export function listWidgets(db: Db, ws: string): Widget[] {
  return (db.prepare("SELECT * FROM widgets WHERE workspace_id = ? ORDER BY rowid").all(ws) as WidgetRow[]).map(fromRow);
}
export function getWidget(db: Db, ws: string, id: string): Widget | null {
  const row = db.prepare("SELECT * FROM widgets WHERE workspace_id = ? AND id = ?").get(ws, id) as WidgetRow | undefined;
  return row ? fromRow(row) : null;
}
export function saveWidget(db: Db, bus: EventBus, ws: string, widget: Widget): Widget {
  db.prepare(`INSERT INTO widgets (id, workspace_id, title, x, y, page_ids, data, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
    title=excluded.title, x=excluded.x, y=excluded.y, page_ids=excluded.page_ids, data=excluded.data,
    created_by=excluded.created_by, updated_at=excluded.updated_at WHERE widgets.workspace_id=excluded.workspace_id`)
    .run(widget.id, ws, widget.title, widget.x, widget.y, JSON.stringify(widget.pageIds), JSON.stringify(widget.data), JSON.stringify(widget.createdBy), widget.createdAt, widget.updatedAt);
  bus.publish(ws, { type: "widget.updated", widget });
  return widget;
}
export function deleteWidget(db: Db, bus: EventBus, ws: string, id: string): boolean {
  if (!db.prepare("DELETE FROM widgets WHERE workspace_id = ? AND id = ?").run(ws, id).changes) return false;
  bus.publish(ws, { type: "widget.deleted", widgetId: id });
  return true;
}
export function getLens(db: Db, ws: string): Lens | null {
  const row = db.prepare("SELECT lens FROM lenses WHERE workspace_id = ?").get(ws) as { lens: string } | undefined;
  return row ? JSON.parse(row.lens) : null;
}
export function saveLens(db: Db, bus: EventBus, ws: string, lens: Lens): Lens {
  db.prepare("INSERT INTO lenses (workspace_id, lens) VALUES (?, ?) ON CONFLICT(workspace_id) DO UPDATE SET lens=excluded.lens").run(ws, JSON.stringify(lens));
  bus.publish(ws, { type: "lens.shown", lens });
  return lens;
}
export function clearLens(db: Db, bus: EventBus, ws: string): void {
  db.prepare("DELETE FROM lenses WHERE workspace_id = ?").run(ws);
  bus.publish(ws, { type: "lens.cleared" });
}

export function removePageSources(db: Db, bus: EventBus, ws: string, deletedIds: string[]): void {
  const deleted = new Set(deletedIds);
  for (const widget of listWidgets(db, ws)) {
    const pageIds = widget.pageIds.filter(id => !deleted.has(id));
    if (pageIds.length === widget.pageIds.length) continue;
    if (!pageIds.length && widget.data.kind !== "facts" && widget.data.kind !== "countdown") {
      deleteWidget(db, bus, ws, widget.id);
    } else {
      // Stored bodies are current at deletion; the live reactor refines surviving sources.
      const sources = pageIds.map(id => db.prepare("SELECT id, markdown FROM pages WHERE workspace_id=? AND id=? AND deleted_at IS NULL").get(ws, id) as SourcePage).filter(Boolean);
      saveWidget(db, bus, ws, { ...widget, pageIds, data: computeWidgetData(widget.data, sources), updatedAt: nowIso() });
    }
  }
  const lens = getLens(db, ws);
  if (lens && lens.groups.some(g => g.pageIds.some(id => deleted.has(id)))) {
    saveLens(db, bus, ws, { ...lens, groups: lens.groups.map(g => ({ ...g, pageIds: g.pageIds.filter(id => !deleted.has(id)) })) });
  }
}

export async function liveWidgetData(collab: Pick<CollabService, "getPageJSON">, ws: string, data: WidgetData, pageIds: string[]): Promise<WidgetData> {
  const sources: SourcePage[] = [];
  for (const id of pageIds) {
    const json = await collab.getPageJSON(id, ws);
    if (json) sources.push({ id, markdown: readView(json).markdown });
  }
  return computeWidgetData(data, sources);
}

/** Both collab onChange and persisted body edits feed this per-widget debounce. */
export function createWidgetReactor(db: Db, bus: EventBus, collab: Pick<CollabService, "getPageJSON">) {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const active = new Set<Promise<void>>();
  let closed = false;
  return {
    changed(ws: string, pageId: string) {
      if (closed) return;
      for (const widget of listWidgets(db, ws)) {
        if (!widget.pageIds.includes(pageId) || !["progress", "total"].includes(widget.data.kind)) continue;
        clearTimeout(pending.get(widget.id));
        const timer = setTimeout(() => {
          pending.delete(widget.id);
          const task = (async () => {
            const current = getWidget(db, ws, widget.id);
            if (!current) return;
            const data = await liveWidgetData(collab, ws, current.data, current.pageIds);
            // Never resurrect a removed/replaced widget after an async read.
            const latest = getWidget(db, ws, widget.id);
            if (!latest || JSON.stringify(latest) !== JSON.stringify(current)) return;
            if (JSON.stringify(data) !== JSON.stringify(current.data)) saveWidget(db, bus, ws, { ...current, data, updatedAt: nowIso() });
          })().catch(error => console.error("[inkwell] widget recompute failed", error));
          active.add(task); void task.finally(() => active.delete(task));
        }, 300);
        timer.unref(); pending.set(widget.id, timer);
      }
    },
    async close() { closed = true; for (const timer of pending.values()) clearTimeout(timer); pending.clear(); await Promise.all(active); },
  };
}

export function widgetPosition(sources: Page[], others: Widget[]): { x: number; y: number } {
  const placed = sources.filter(p => p.x !== null && p.y !== null);
  const x = placed.length ? Math.max(...placed.map(p => p.x!)) + 360 : 0;
  let y = placed.length ? placed.reduce((n, p) => n + p.y!, 0) / placed.length : 0;
  while (others.some(w => x < w.x + 300 && x + 300 > w.x && y < w.y + 200 && y + 200 > w.y)) y += 220;
  return { x, y };
}
export function newWidget(actor: Actor, title: string, pageIds: string[], data: WidgetData, position: { x: number; y: number }): Widget {
  const now = nowIso();
  return { id: newId(), title, pageIds, data, ...position, createdBy: actor, createdAt: now, updatedAt: now };
}
export function widgetValue(widget: Widget): string {
  const d = widget.data;
  return `${widget.title}: ${d.kind === "progress" ? `${d.done} of ${d.total} tasks done` : d.kind === "total" ? `${d.currency}${d.amount.toFixed(2)}` : d.kind === "countdown" ? `${d.label || "Countdown"} to ${d.date}` : d.items.map(i => `${i.label}: ${i.value}`).join(", ")}`;
}
