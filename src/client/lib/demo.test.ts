import { afterEach, describe, expect, it } from "vitest";
import type { DemoScenario } from "@shared/types";
import { applyDemoEvent, fromDemoState, getDemo, initialDemo, NOTEBOOK_KEY, setDemo, stepModelLabel } from "./demo";
import { emit } from "./events";

const scenario: DemoScenario = {
  id: "lisbon",
  title: "A week with Inkwell",
  recordedFrom: "rehearsal",
  steps: [
    { id: "plan", caption: "Wren is planning your trip.", model: "muse-spark" },
    { id: "voice", caption: "You ask out loud.", model: "muse-voice" },
    { id: "photo", caption: "A photo becomes cards.", model: "sam-3.1+muse-spark" },
  ],
};

afterEach(() => setDemo(initialDemo("own")));

describe("the demo store", () => {
  it("follows demo.step and demo.ended events, but only while showing the demo", () => {
    applyDemoEvent({ type: "demo.step", index: 0, step: scenario.steps[0], focus: { pageId: "p1" } });
    expect(getDemo().step).toBeNull();

    setDemo({ notebook: "demo", scenario });
    emit({ type: "demo.step", index: 1, step: scenario.steps[1], focus: { agentId: "scout", pageId: "p2" } });
    expect(getDemo()).toMatchObject({ playing: true, index: 1, step: scenario.steps[1], focus: { agentId: "scout", pageId: "p2" }, ended: null });

    // A late event from an earlier step doesn't move the demo backwards.
    emit({ type: "demo.step", index: 0, step: scenario.steps[0], focus: {} });
    expect(getDemo().index).toBe(1);

    emit({ type: "demo.ended", reason: "finished" });
    expect(getDemo()).toMatchObject({ playing: false, ended: "finished" });
  });

  it("restores from a server snapshot", () => {
    expect(fromDemoState({ playing: true, scenario, stepIndex: 2 })).toMatchObject({ index: 2, step: scenario.steps[2], ended: null });
    expect(fromDemoState({ playing: false, scenario, stepIndex: 2 }).ended).toBe("finished");
    expect(fromDemoState({ playing: false, scenario, stepIndex: 0 }).ended).toBe("stopped");
    expect(fromDemoState({ playing: false, scenario: null, stepIndex: -1 })).toMatchObject({ index: -1, step: null, ended: null });
  });

  it("remembers the demo notebook for this tab, so a reload comes back to it", () => {
    setDemo({ notebook: "demo" });
    expect(sessionStorage.getItem(NOTEBOOK_KEY)).toBe("demo");
    setDemo({ notebook: "own" });
    expect(sessionStorage.getItem(NOTEBOOK_KEY)).toBeNull();
  });

  it("names each step's models as a chip; recorded text runs are Muse Wonder", () => {
    expect(stepModelLabel("muse-spark")).toBe("Muse Wonder");
    expect(stepModelLabel("muse-wonder")).toBe("Muse Wonder");
    expect(stepModelLabel("muse-voice")).toBe("Muse Voice");
    expect(stepModelLabel("sam-3.1+muse-spark")).toBe("SAM 3.1 + Muse Wonder");
    expect(stepModelLabel("muse-image")).toBe("Muse Image");
    expect(stepModelLabel(undefined)).toBeNull();
  });
});
