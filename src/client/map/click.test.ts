import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClickIntent, DOUBLE_MS, opensOnClick } from "./click";

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

describe("opening with a second click or tap", () => {
  it("opens the card that was brought close, at the zoom it was brought to", () => {
    expect(opensOnClick(null, "a", 0.85)).toBe(false);
    expect(opensOnClick({ id: "a", s: 0.85 }, "a", 0.85)).toBe(true);
    expect(opensOnClick({ id: "a", s: 0.85 }, "b", 0.85)).toBe(false);
    // Zoomed well away since: bring it close again first.
    expect(opensOnClick({ id: "a", s: 0.85 }, "a", 0.3)).toBe(false);
  });
});
