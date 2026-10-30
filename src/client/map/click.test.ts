import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClickIntent, DOUBLE_MS } from "./click";

describe("ClickIntent", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opens on a double-click and never focuses first", () => {
    const single = vi.fn();
    const double = vi.fn();
    const c = new ClickIntent(single, double);
    c.click("a", 1000);
    c.click("a", 1000 + DOUBLE_MS - 40);
    vi.runAllTimers();
    expect(double).toHaveBeenCalledWith("a");
    expect(single).not.toHaveBeenCalled();
  });

  it("focuses on a single click, once the double-click window has passed", () => {
    const single = vi.fn();
    const double = vi.fn();
    const c = new ClickIntent(single, double);
    c.click("a", 1000);
    vi.advanceTimersByTime(DOUBLE_MS - 1);
    expect(single).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(single).toHaveBeenCalledWith("a");
    expect(double).not.toHaveBeenCalled();
  });

  it("treats quick clicks on two different cards as a single click on the second", () => {
    const single = vi.fn();
    const double = vi.fn();
    const c = new ClickIntent(single, double);
    c.click("a", 1000);
    c.click("b", 1100);
    vi.runAllTimers();
    expect(double).not.toHaveBeenCalled();
    expect(single).toHaveBeenCalledTimes(1);
    expect(single).toHaveBeenCalledWith("b");
  });

  it("treats two slow clicks as two single clicks", () => {
    const single = vi.fn();
    const double = vi.fn();
    const c = new ClickIntent(single, double);
    c.click("a", 1000);
    vi.advanceTimersByTime(DOUBLE_MS + 10);
    c.click("a", 1000 + DOUBLE_MS + 400);
    vi.runAllTimers();
    expect(single).toHaveBeenCalledTimes(2);
    expect(double).not.toHaveBeenCalled();
  });
});
