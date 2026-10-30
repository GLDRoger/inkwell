import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isUntouchedSeed, TitleDraft, titleToSave } from "./title";

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

describe("TitleDraft", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const make = (server = "Old") => {
    const save = vi.fn();
    return { save, draft: new TitleDraft({ serverTitle: () => server, save, delay: 600 }) };
  };

  it("saves after a pause in typing", () => {
    const { save, draft } = make();
    draft.type("New");
    vi.advanceTimersByTime(599);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledWith("New");
  });

  it("saves what was typed when the page goes away before the pause ends (browser Back)", () => {
    const { save, draft } = make();
    draft.type("Renamed in a hurry");
    draft.flush(); // what the field does when it unmounts
    vi.advanceTimersByTime(5000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("Renamed in a hurry");
  });

  it("saves nothing on leave if nothing was typed, so an agent's rename isn't overwritten", () => {
    const { save, draft } = make();
    draft.flush();
    expect(save).not.toHaveBeenCalled();
  });
});
