import { describe, expect, it } from "vitest";
import { decodeCamera, encodeCamera } from "./saved-camera";

describe("the map's saved camera", () => {
  it("comes back for the notebook it was saved in", () => {
    expect(decodeCamera(encodeCamera({ x: 1, y: 2, s: 0.5 }, "own"), "own")).toEqual({ x: 1, y: 2, s: 0.5 });
  });

  it("is ignored in the other notebook, so Try it yourself never lands on the demo's view", () => {
    expect(decodeCamera(encodeCamera({ x: 1, y: 2, s: 3 }, "demo"), "own")).toBeNull();
    expect(decodeCamera(encodeCamera({ x: 1, y: 2, s: 3 }, "own"), "demo")).toBeNull();
  });

  it("ignores untagged, broken or missing values", () => {
    expect(decodeCamera(JSON.stringify({ x: 1, y: 2, s: 1 }), "own")).toBeNull();
    expect(decodeCamera("{nope", "own")).toBeNull();
    expect(decodeCamera(null, "own")).toBeNull();
    expect(decodeCamera(JSON.stringify({ x: 1, y: "2", s: 1, nb: "own" }), "own")).toBeNull();
  });
});
