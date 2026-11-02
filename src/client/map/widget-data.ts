import type { Widget, WidgetData } from "@shared/types";

/**
 * What a widget shows, worked out from its data. Pure, so the countdown and
 * the money formatting can be tested without a clock or a browser.
 */

export const WIDGET_W = 300;
const MAX_ROWS = 5;

/** A widget's size on the map, world units. Fixed per kind and row count, so threads and the lens can plan around it. */
export function widgetSize(data: WidgetData): { w: number; h: number } {
  switch (data.kind) {
    case "countdown":
      return { w: WIDGET_W, h: 142 };
    case "progress":
      return { w: WIDGET_W, h: 176 + Math.min(MAX_ROWS, data.perPage.length) * 30 };
    case "total":
      return { w: WIDGET_W, h: 150 + Math.min(MAX_ROWS, data.lines.length) * 30 };
    case "facts":
      return { w: WIDGET_W, h: 70 + Math.max(1, Math.min(6, data.items.length)) * 34 };
  }
}

export const widgetRows = <T,>(rows: T[]) => ({ shown: rows.slice(0, MAX_ROWS), more: Math.max(0, rows.length - MAX_ROWS) });

export interface CountdownParts {
  past: boolean;
  /** Under a day to go: seconds tick. */
  close: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/**
 * Time left until `date`. A bare date (2026-11-04) counts to the start of that
 * day where you are.
 */
export function countdown(date: string, now: number): CountdownParts {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00`).getTime() : Date.parse(date);
  const left = Number.isFinite(at) ? at - now : 0;
  const past = left <= 0;
  const s = Math.max(0, Math.floor(left / 1000));
  return {
    past,
    close: !past && s < 86_400,
    days: Math.floor(s / 86_400),
    hours: Math.floor((s % 86_400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

/** "Wed 4 Nov", or with a time when the date has one. */
export function whenLabel(date: string): string {
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const d = bare ? new Date(`${date}T00:00:00`) : new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return bare ? day : `${day}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

const formatters = new Map<string, Intl.NumberFormat>();
/** An amount in its currency ("€1,284.50"). An unknown currency code is written after the number. */
export function money(amount: number, currency: string, whole = false): string {
  const key = `${currency}:${whole}`;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: whole ? 0 : 2, minimumFractionDigits: whole ? 0 : undefined });
    } catch {
      f = new Intl.NumberFormat("en-GB", { maximumFractionDigits: whole ? 0 : 2 });
      formatters.set(key, f);
      return `${f.format(amount)} ${currency}`;
    }
    formatters.set(key, f);
  }
  return f.format(amount);
}

/** The one number that matters, for the far view and for "it changed". */
export function headline(w: Pick<Widget, "data">): number | null {
  const d = w.data;
  if (d.kind === "progress") return d.done;
  if (d.kind === "total") return d.amount;
  return null;
}

/** Said to screen readers when a widget changes. */
export function describeWidget(w: Pick<Widget, "title" | "data">, now: number): string {
  const d = w.data;
  switch (d.kind) {
    case "countdown": {
      const c = countdown(d.date, now);
      if (c.past) return `${w.title}: ${d.label}, passed.`;
      return `${w.title}: ${c.days} days, ${c.hours} hours and ${c.minutes} minutes until ${d.label}.`;
    }
    case "progress":
      return `${w.title}: ${d.done} of ${d.total} done.`;
    case "total":
      return `${w.title}: ${money(d.amount, d.currency)} across ${d.lines.length} ${d.lines.length === 1 ? "item" : "items"}.`;
    case "facts":
      return `${w.title}: ${d.items.map((i) => `${i.label}, ${i.value}`).join("; ")}.`;
  }
}
