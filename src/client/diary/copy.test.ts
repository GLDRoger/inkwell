import { describe, expect, it } from "vitest";
import { COPY, composerPlaceholder, modelName } from "./copy";
import { shouldIntroduce } from "./intro";

describe("diary copy", () => {
  it("calls diary threads conversations, never pages", () => {
    expect(COPY.newConversation).toBe("New conversation");
    expect(COPY.conversations).toBe("Conversations");
    for (const value of Object.values(COPY)) expect(value).not.toMatch(/\bpage\b/i);
  });

  it("asks the agents by name in one prompt", () => {
    const crew = [{ name: "Scout" }, { name: "Wren" }, { name: "Atlas" }];
    expect(composerPlaceholder(crew)).toBe("Ask Scout, Wren or Atlas…");
    expect(composerPlaceholder(crew, { name: "Wren" })).toBe("Ask Wren…");
    expect(composerPlaceholder([])).toBe("Ask the agents…");
  });

  it("is honest about Any agent", () => {
    expect(COPY.anyAgentDetail).toBe("Inkwell picks who's best");
  });

  it("names the Meta models as people say them", () => {
    expect(modelName("muse-spark-1.3")).toBe("Muse Spark");
    expect(modelName("muse-wonder-1.0")).toBe("Muse Wonder");
    expect(modelName(undefined)).toBe("Muse Spark");
  });
});

describe("shouldIntroduce", () => {
  const base = { pathname: "/", search: "", introduced: false, automated: false, welcomed: false };
  it("introduces once, on the bare map", () => {
    expect(shouldIntroduce(base)).toBe(true);
    expect(shouldIntroduce({ ...base, introduced: true })).toBe(false);
    expect(shouldIntroduce({ ...base, pathname: "/p/abc" })).toBe(false);
    expect(shouldIntroduce({ ...base, search: "?focus=a" })).toBe(false);
  });
  it("leaves scripted browsers alone unless the welcome played", () => {
    expect(shouldIntroduce({ ...base, automated: true })).toBe(false);
    expect(shouldIntroduce({ ...base, automated: true, welcomed: true })).toBe(true);
  });
});
