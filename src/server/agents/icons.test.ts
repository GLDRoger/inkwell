// @vitest-environment node
import { expect, it } from "vitest";
import { pickIcon } from "./icons.ts";

it("uses the model's emoji, else guesses from the title, else the parent's", () => {
  expect(pickIcon("🧭", "Anything")).toBe("🧭");
  expect(pickIcon("not an emoji", "Packing checklist: Trip to Lisbon")).toBe("🧳");
  expect(pickIcon(undefined, "Summary: Reading notes")).toBe("📝");
  expect(pickIcon(undefined, "Zebra", "🍳")).toBe("🍳");
  expect(pickIcon(undefined, "Zebra")).toBe("📄");
  expect(pickIcon("👩🏽‍💻", "x")).toBe("👩🏽‍💻");
});
