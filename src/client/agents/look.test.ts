import { describe, expect, it } from "vitest";
import { _layout } from "blobatar";
import { castOf, inkPalette, mixOklab, runState } from "./look";

const step = (tool: string, ok = true) => ({ at: "", tool, summary: "", pageId: null, ok });

describe("castOf", () => {
  it("gives Scout, Wren and Atlas three different silhouettes", () => {
    const shapes = ["Scout", "Wren", "Atlas"].map((n) => _layout(n, { traits: castOf(n) }).shape);
    expect(shapes).toEqual(["organic", "droplet", "hexagon"]);
  });

  it("matches names however they're written, and leaves other names to the hash", () => {
    expect(castOf(" wren ")).toBe(castOf("Wren"));
    expect(castOf("Visitor 12")).toBeUndefined();
  });
});

describe("runState", () => {
  it("reads a run the way the map does", () => {
    expect(runState(null)).toBe("idle");
    expect(runState({ status: "queued", steps: [] })).toBe("thinking");
    expect(runState({ status: "running", steps: [step("read_page")] })).toBe("reading");
    expect(runState({ status: "running", steps: [step("read_page"), step("edit_page")] })).toBe("writing");
    expect(runState({ status: "succeeded", steps: [step("edit_page")] })).toBe("idle");
  });

  it("droops on a step that didn't work, and on a failed run", () => {
    expect(runState({ status: "running", steps: [step("edit_page", false)] })).toBe("failed");
    expect(runState({ status: "failed", steps: [] })).toBe("failed");
  });
});

describe("colour", () => {
  it("keeps the ink in light mode and lifts it like DESIGN.md in dark", () => {
    expect(inkPalette("#c0602f", false)).toEqual({ head: "#c0602f", eye: "#fbfaf7" });
    const dark = inkPalette("#c0602f", true);
    expect(dark.eye).toBe("#161513");
    // Lighter than the ink, still warm (red channel leads).
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(dark.head.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(0xc0);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it("mixes in oklab and refuses what isn't hex", () => {
    expect(mixOklab("#000000", "#ffffff", 1)).toBe("#000000");
    expect(mixOklab("#000000", "#ffffff", 0)).toBe("#ffffff");
    expect(mixOklab("var(--x)", "#fff", 0.5)).toBeNull();
    expect(inkPalette("var(--ink)", false).head).toBe("#8e8b84");
  });
});
