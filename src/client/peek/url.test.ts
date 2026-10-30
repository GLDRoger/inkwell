import { describe, expect, it } from "vitest";
import { peekFrom, peekHistory, withPeek } from "./url";

describe("peek in the URL", () => {
  it("reads the peeked page, ignoring an empty value", () => {
    expect(peekFrom("?peek=p1")).toBe("p1");
    expect(peekFrom("?focus=a&peek=p2")).toBe("p2");
    expect(peekFrom("?peek=")).toBeNull();
    expect(peekFrom("")).toBeNull();
    expect(peekFrom(new URLSearchParams("peek=p3"))).toBe("p3");
  });

  it("sets and clears the peek, keeping other parameters", () => {
    expect(withPeek("", "p1")).toBe("?peek=p1");
    expect(withPeek("?focus=a", "p1")).toBe("?focus=a&peek=p1");
    expect(withPeek("?focus=a&peek=p1", "p2")).toBe("?focus=a&peek=p2");
    expect(withPeek("?focus=a&peek=p1", null)).toBe("?focus=a");
    expect(withPeek("?peek=p1", null)).toBe("");
  });

  it("pushes opening a peek, replaces swaps and closes, and the demo never pushes", () => {
    expect(peekHistory(null, "a", "person")).toBe("push");
    expect(peekHistory("a", "b", "person")).toBe("replace");
    expect(peekHistory("a", null, "person")).toBe("replace");
    expect(peekHistory("a", "a", "person")).toBeNull();
    expect(peekHistory(null, "a", "demo")).toBe("replace");
  });
});
