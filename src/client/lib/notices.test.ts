import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { close, dismiss, dismissForNavigation, getNotices, hold, notify, release } from "./notices";

describe("notices", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    getNotices().forEach((n) => dismiss(n.id));
    vi.useRealTimers();
  });

  it("shows the same error once, however often it happens", () => {
    for (let i = 0; i < 5; i++) notify({ tone: "error", text: "Couldn't make a cover." });
    expect(getNotices()).toHaveLength(1);
  });

  it("never stacks more than three, dropping the oldest finished one first", () => {
    notify({ tone: "busy", text: "Reading your notes…", id: "photo" });
    for (let i = 0; i < 5; i++) notify({ tone: "error", text: `Error ${i}` });
    expect(getNotices().map((n) => n.text)).toEqual(["Reading your notes…", "Error 3", "Error 4"]);
  });

  it("dismisses errors by themselves", () => {
    notify({ tone: "error", text: "Oops" });
    vi.advanceTimersByTime(8000);
    expect(getNotices()).toHaveLength(0);
  });

  it("clears finished notices on navigation, but keeps busy work and Undo", () => {
    notify({ tone: "error", text: "From the last screen" });
    notify({ tone: "busy", text: "Still reading", id: "busy" });
    notify({ tone: "done", text: "Deleted “X”.", persist: true, action: { label: "Undo", run() {} } });
    dismissForNavigation();
    expect(getNotices().map((n) => n.text)).toEqual(["Still reading", "Deleted “X”."]);
  });

  it("never pushes out a notice with an Undo button, however many arrive after it", () => {
    notify({ tone: "done", text: "Deleted “A”.", sticky: true, persist: true, action: { label: "Undo", run() {} } });
    notify({ tone: "done", text: "Deleted “B”.", sticky: true, persist: true, action: { label: "Undo", run() {} } });
    for (let i = 0; i < 5; i++) notify({ tone: "error", text: `Error ${i}` });
    const texts = getNotices().map((n) => n.text);
    expect(texts).toContain("Deleted “A”.");
    expect(texts).toContain("Deleted “B”.");
    expect(texts).toHaveLength(3);
  });

  it("keeps every Undo even past the limit, when nothing else can make room", () => {
    for (const t of ["A", "B", "C", "D"]) notify({ tone: "done", text: t, sticky: true, action: { label: "Undo", run() {} } });
    expect(getNotices()).toHaveLength(4);
  });

  it("pauses its clock while hovered or focused, then gets the time it had left", () => {
    const id = notify({ tone: "done", text: "Saved a cover", duration: 5000 });
    vi.advanceTimersByTime(3000);
    hold(id); // pointer arrives
    hold(id); // and focus
    vi.advanceTimersByTime(60_000);
    expect(getNotices()).toHaveLength(1);
    release(id);
    vi.advanceTimersByTime(60_000);
    expect(getNotices()).toHaveLength(1); // focus is still inside
    release(id);
    vi.advanceTimersByTime(1999);
    expect(getNotices()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(getNotices()).toHaveLength(0);
  });

  it("tells its owner when it's held, released and closed", () => {
    const onHold = vi.fn();
    const onRelease = vi.fn();
    const onClose = vi.fn();
    const id = notify({ tone: "done", text: "Deleted “X”.", sticky: true, onHold, onRelease, onClose, action: { label: "Undo", run() {} } });
    hold(id);
    release(id);
    expect(onHold).toHaveBeenCalledTimes(1);
    expect(onRelease).toHaveBeenCalledTimes(1);
    close(id);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(getNotices()).toHaveLength(0);
  });

  it("a sticky notice stays until its owner dismisses it", () => {
    const id = notify({ tone: "done", text: "Deleted “X”.", sticky: true });
    vi.advanceTimersByTime(60_000);
    expect(getNotices()).toHaveLength(1);
    dismiss(id);
    expect(getNotices()).toHaveLength(0);
  });
});
