import { describe, expect, it } from "vitest";
import { shortcutFor } from "./shortcuts";

const key = (k: string, mod = true) => ({ key: k, metaKey: mod, ctrlKey: false, shiftKey: false, altKey: false });
const ctx = { welcome: false, diaryOpen: false, paletteOpen: false, inDiary: false };

describe("global shortcuts", () => {
  it("opens the palette with Cmd+K and the diary with Cmd+J", () => {
    expect(shortcutFor(key("k"), ctx)).toBe("palette");
    expect(shortcutFor({ ...key("j", false), ctrlKey: true }, ctx)).toBe("diary");
    expect(shortcutFor(key("k", false), ctx)).toBeNull();
  });

  it("does nothing while the welcome is showing", () => {
    const welcome = { ...ctx, welcome: true };
    expect(shortcutFor(key("k"), welcome)).toBeNull();
    expect(shortcutFor(key("j"), welcome)).toBeNull();
    expect(shortcutFor(key("Escape", false), { ...welcome, diaryOpen: true, inDiary: true })).toBeNull();
  });

  it("closes the diary with Escape only from inside it, and not over the palette", () => {
    expect(shortcutFor(key("Escape", false), { ...ctx, diaryOpen: true, inDiary: true })).toBe("close-diary");
    expect(shortcutFor(key("Escape", false), { ...ctx, diaryOpen: true, inDiary: false })).toBeNull();
    expect(shortcutFor(key("Escape", false), { ...ctx, diaryOpen: true, inDiary: true, paletteOpen: true })).toBeNull();
  });
});
