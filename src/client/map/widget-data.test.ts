import { describe, expect, it } from "vitest";
import { countdown, money, widgetSize } from "./widget-data";

describe("money", () => {
  it("reads the server's symbols and ISO codes alike", () => {
    expect(money(1284.5, "€")).toBe("€1,284.50");
    expect(money(1284.5, "EUR")).toBe("€1,284.50");
    expect(money(99, "$")).toBe("$99.00");
    expect(money(1027.4, "£", true)).toBe("£1,027");
  });
  it("writes an unknown currency as given, before the number", () => {
    expect(money(12, "CHF ")).toMatch(/^CHF\s12\.00$/);
    expect(money(12, "kr")).toBe("kr12.00");
  });
});

describe("countdown", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  it("splits the time left into days, hours, minutes and seconds", () => {
    expect(countdown("2026-11-04T17:30:05Z", now)).toEqual({ past: false, close: false, days: 2, hours: 5, minutes: 30, seconds: 5 });
  });
  it("ticks seconds once under a day is left", () => {
    expect(countdown("2026-11-02T20:00:00Z", now).close).toBe(true);
  });
  it("says when the date has passed", () => {
    expect(countdown("2026-11-01T00:00:00Z", now).past).toBe(true);
  });
});

describe("widgetSize", () => {
  it("grows with rows up to a cap", () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ pageId: `p${i}`, done: 1, total: 2 }));
    const h = (n: number) => widgetSize({ kind: "progress", done: 1, total: 2, perPage: rows(n) }).h;
    expect(h(3)).toBeGreaterThan(h(1));
    expect(h(9)).toBe(h(5));
  });
});
