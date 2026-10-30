import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismiss, dismissForNavigation, getNotices, notify } from "./notices";

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
});
