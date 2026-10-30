import { describe, expect, it } from "vitest";
import { openDuringNudge, sendThreadId, shouldIntroduce, showNudge } from "./intro";

describe("the phone nudge", () => {
  it("shows on the map only, not over a page", () => {
    expect(showNudge({ phase: "nudge", open: false, onMap: true })).toBe(true);
    expect(showNudge({ phase: "nudge", open: false, onMap: false })).toBe(false);
    expect(showNudge({ phase: "nudge", open: true, onMap: true })).toBe(false);
    expect(showNudge({ phase: "done", open: false, onMap: true })).toBe(false);
  });
  it("gives way to the page's conversation when the diary opens on a page", () => {
    expect(openDuringNudge(true)).toBe("dismiss");
    expect(openDuringNudge(false)).toBe("reveal");
  });
});

describe("sendThreadId", () => {
  it("starts a new conversation for the first real request under the welcome note", () => {
    expect(sendThreadId({ threadId: "w", title: "Welcome to Inkwell", retry: false })).toBeUndefined();
  });
  it("keeps a Try again, and any other conversation, where it is", () => {
    expect(sendThreadId({ threadId: "w", title: "Welcome to Inkwell", retry: true })).toBe("w");
    expect(sendThreadId({ threadId: "t", title: "Plan my 5 days in Lisbon", retry: false })).toBe("t");
    expect(sendThreadId({ threadId: null, title: undefined, retry: false })).toBeUndefined();
  });
});

describe("shouldIntroduce", () => {
  it("skips deep links", () => {
    expect(shouldIntroduce({ pathname: "/p/1", search: "", introduced: false, automated: false, welcomed: false })).toBe(false);
    expect(shouldIntroduce({ pathname: "/", search: "", introduced: false, automated: false, welcomed: false })).toBe(true);
  });
});
