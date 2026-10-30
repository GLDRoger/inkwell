import { describe, expect, it } from "vitest";
import { settleSheet, snapHeight } from "./sheet";

describe("the peek's bottom sheet", () => {
  const vh = 800;
  const top = 66;
  it("rests half open or fully open below the bar", () => {
    expect(snapHeight("half", vh, top)).toBe(400);
    expect(snapHeight("full", vh, top)).toBe(734);
  });
  it("settles on the nearest snap", () => {
    expect(settleSheet(450, 0, vh, top)).toBe("half");
    expect(settleSheet(650, 0, vh, top)).toBe("full");
  });
  it("closes when pulled well down, or flicked down from half open", () => {
    expect(settleSheet(200, 0, vh, top)).toBe("closed");
    expect(settleSheet(360, 1, vh, top)).toBe("closed");
  });
  it("a flick down from full stops at half; a flick up opens fully", () => {
    expect(settleSheet(700, 1, vh, top)).toBe("half");
    expect(settleSheet(420, -1, vh, top)).toBe("full");
  });
});
