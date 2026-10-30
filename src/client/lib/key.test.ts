import { afterEach, describe, expect, it } from "vitest";
import { aiHeaders, cleanKey, forgetKey, getKeyState, KEY_STORAGE, MODEL_STORAGE, reloadKey, saveKey, textModelName, activeModelName } from "./key";

afterEach(() => {
  localStorage.clear();
  reloadKey();
});

describe("the visitor's Meta key", () => {
  it("is kept in this browser and sent only as AI headers", () => {
    expect(aiHeaders()).toEqual({});
    saveKey("  sk-abc123 ");
    expect(localStorage.getItem(KEY_STORAGE)).toBe("sk-abc123");
    expect(aiHeaders()).toEqual({ "X-Meta-Key": "sk-abc123", "X-Meta-Model": "muse-wonder-1.0" });
  });

  it("remembers the model choice, and falls back to Muse Wonder for anything unknown", () => {
    saveKey("sk-abc", "muse-spark-1.3-contributor");
    expect(localStorage.getItem(MODEL_STORAGE)).toBe("muse-spark-1.3-contributor");
    expect(aiHeaders()["X-Meta-Model"]).toBe("muse-spark-1.3-contributor");
    expect(activeModelName()).toBe("Muse Spark");
    localStorage.setItem(MODEL_STORAGE, "gpt-9");
    reloadKey();
    expect(getKeyState().model).toBe("muse-wonder-1.0");
  });

  it("forgets the key completely", () => {
    saveKey("sk-abc");
    forgetKey();
    expect(localStorage.getItem(KEY_STORAGE)).toBeNull();
    expect(getKeyState().key).toBeNull();
    expect(aiHeaders()).toEqual({});
    expect(activeModelName()).toBe("Muse Wonder");
  });

  it("tidies what people paste", () => {
    expect(cleanKey(' "Bearer sk-abc" \n')).toBe("sk-abc");
    expect(cleanKey("'sk-abc'")).toBe("sk-abc");
    expect(textModelName("muse-wonder-1.0")).toBe("Muse Wonder");
  });
});
