import { describe, expect, it } from "vitest";
import { isUntouchedSeed, titleToSave } from "./title";

describe("titleToSave", () => {
  it("saves nothing on blur when the person didn't type, so an agent's rename survives", () => {
    // The field still shows the old title; the server already has the agent's new one.
    expect(titleToSave({ edited: false, value: "Lisbon", serverTitle: "Trip to Lisbon" })).toBeNull();
  });
  it("saves what the person typed", () => {
    expect(titleToSave({ edited: true, value: "Lisbon, May", serverTitle: "Lisbon" })).toBe("Lisbon, May");
  });
  it("skips a save that wouldn't change anything", () => {
    expect(titleToSave({ edited: true, value: "Lisbon", serverTitle: "Lisbon" })).toBeNull();
  });
});

describe("isUntouchedSeed", () => {
  const atlas = { kind: "agent" as const, id: "a", name: "Atlas" };
  const t0 = "2026-10-30T10:00:00.000Z";
  const pages = [{ createdAt: t0 }, { createdAt: "2026-10-30T10:00:00.400Z" }, { createdAt: "2026-10-30T11:00:00.000Z" }];
  it("recognises a demo page nobody has edited since the notebook was made", () => {
    expect(isUntouchedSeed({ createdAt: t0, updatedAt: t0, updatedBy: atlas }, pages)).toBe(true);
  });
  it("treats an edited page, or one made later, as a normal page", () => {
    expect(isUntouchedSeed({ createdAt: t0, updatedAt: "2026-10-30T10:05:00.000Z", updatedBy: atlas }, pages)).toBe(false);
    const later = "2026-10-30T11:00:00.000Z";
    expect(isUntouchedSeed({ createdAt: later, updatedAt: later, updatedBy: atlas }, pages)).toBe(false);
    expect(isUntouchedSeed({ createdAt: t0, updatedAt: t0, updatedBy: { kind: "person", id: "u", name: "You" } }, pages)).toBe(false);
  });
});
