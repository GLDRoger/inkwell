import { describe, expect, it } from "vitest";
import { hasSeenWelcome, markWelcomeSeen, shouldShowWelcome, WELCOME_KEY, withoutWelcomeParam } from "./show";

describe("shouldShowWelcome", () => {
  const first = { pathname: "/", search: "", seen: false };

  it("greets a first visit to the map", () => {
    expect(shouldShowWelcome(first)).toBe(true);
  });

  it("stays away once seen", () => {
    expect(shouldShowWelcome({ ...first, seen: true })).toBe(false);
  });

  it("never covers a deep link", () => {
    expect(shouldShowWelcome({ ...first, pathname: "/p/abc123" })).toBe(false);
    expect(shouldShowWelcome({ ...first, search: "?focus=abc123" })).toBe(false);
  });

  it("re-opens with ?welcome, even when seen, on a deep link, or automated", () => {
    expect(shouldShowWelcome({ pathname: "/", search: "?welcome", seen: true })).toBe(true);
    expect(shouldShowWelcome({ pathname: "/p/x", search: "?welcome=1", seen: true, automated: true })).toBe(true);
  });

  it("skips automated browsers unless asked", () => {
    expect(shouldShowWelcome({ ...first, automated: true })).toBe(false);
  });
});

describe("welcome storage", () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };

  it("remembers that the welcome was seen", () => {
    const s = store();
    expect(hasSeenWelcome(s)).toBe(false);
    markWelcomeSeen(s);
    expect(s.m.get(WELCOME_KEY)).toBe("1");
    expect(hasSeenWelcome(s)).toBe(true);
  });

  it("treats blocked storage as seen and doesn't throw", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(hasSeenWelcome(blocked)).toBe(true);
    expect(() => markWelcomeSeen(blocked)).not.toThrow();
  });
});

describe("withoutWelcomeParam", () => {
  it("drops welcome and keeps the rest", () => {
    expect(withoutWelcomeParam("?welcome")).toBe("");
    expect(withoutWelcomeParam("?welcome=1&focus=a")).toBe("?focus=a");
  });
});
