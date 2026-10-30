import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DemoScenario } from "@shared/types";
import { emit } from "../lib/events";
import { getDemo, initialDemo, setDemo } from "../lib/demo";
import { DemoBar } from "./DemoBar";

const scenario: DemoScenario = {
  id: "lisbon",
  title: "Inkwell",
  recordedFrom: "rehearsal",
  steps: [
    { id: "a", caption: "Wren is planning your trip. Watch her walk the map.", model: "muse-spark" },
    { id: "b", caption: "You ask out loud for a summary.", model: "muse-voice" },
    { id: "c", caption: "A photo of sticky notes becomes cards.", model: "sam-3.1+muse-spark" },
  ],
};

function show() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <DemoBar />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setDemo(initialDemo("own"));
});

describe("the demo caption bar", () => {
  it("isn't there in the visitor's own notebook", () => {
    show();
    expect(screen.queryByRole("region", { name: "Recorded demo" })).toBeNull();
  });

  it("is labelled as recorded, captions each step with its model and shows progress", () => {
    setDemo({ notebook: "demo", scenario, playing: true });
    show();
    act(() => emit({ type: "demo.step", index: 0, step: scenario.steps[0], focus: { pageId: "p1" } }));
    expect(screen.getByRole("region", { name: "Recorded demo" })).toBeTruthy();
    expect(screen.getByText(scenario.steps[0].caption)).toBeTruthy();
    expect(screen.getByText("Muse Wonder")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Step 1 of 3" })).toBeTruthy();

    act(() => emit({ type: "demo.step", index: 2, step: scenario.steps[2], focus: {} }));
    expect(screen.getByText("SAM 3.1 + Muse Wonder")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Step 3 of 3" })).toBeTruthy();
  });

  it("ends with the invitation to try it, and offers to watch again", () => {
    setDemo({ notebook: "demo", scenario, playing: true, index: 2, step: scenario.steps[2] });
    show();
    act(() => emit({ type: "demo.ended", reason: "finished" }));
    expect(screen.getByText("That's Inkwell. Try it with your own notebook.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Try it yourself/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Watch again/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("Stop stops the demo where it is", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    setDemo({ notebook: "demo", scenario, playing: true, index: 0, step: scenario.steps[0] });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(getDemo()).toMatchObject({ notebook: "demo", playing: false, ended: "stopped" });
    expect(screen.getByText(/Demo stopped/)).toBeTruthy();
  });
});
