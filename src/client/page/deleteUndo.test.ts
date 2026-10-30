import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PendingDeletes, subtreeOf } from "./deleteUndo";

describe("PendingDeletes", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends the delete only after the undo window closes", () => {
    const d = new PendingDeletes(6000);
    const commit = vi.fn();
    d.schedule("a", ["a", "b"], commit);
    expect(d.isHidden("b")).toBe(true);
    vi.advanceTimersByTime(5999);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(d.isHidden("a")).toBe(false);
  });

  it("Undo inside the window means the server never hears about it", () => {
    const d = new PendingDeletes(6000);
    const commit = vi.fn();
    d.schedule("a", ["a"], commit);
    vi.advanceTimersByTime(3000);
    expect(d.cancel("a")).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(commit).not.toHaveBeenCalled();
    expect(d.isHidden("a")).toBe(false);
  });

  it("Undo after the delete went reports that it's too late", () => {
    const d = new PendingDeletes(10);
    d.schedule("a", ["a"], () => {});
    vi.advanceTimersByTime(10);
    expect(d.cancel("a")).toBe(false);
  });

  it("closing the tab sends every waiting delete at once, exactly once", () => {
    const d = new PendingDeletes(6000);
    const a = vi.fn();
    const b = vi.fn();
    d.schedule("a", ["a"], a);
    d.schedule("b", ["b"], b);
    d.flush();
    vi.advanceTimersByTime(6000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe("subtreeOf", () => {
  it("includes every page inside, however deep", () => {
    const pages = [
      { id: "root", parentId: null },
      { id: "kid", parentId: "root" },
      { id: "grandkid", parentId: "kid" },
      { id: "other", parentId: null },
    ];
    expect([...subtreeOf(pages, "root")].sort()).toEqual(["grandkid", "kid", "root"]);
  });
});
