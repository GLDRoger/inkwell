import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Welcome } from "./Welcome";

beforeEach(() => {
  // Reduced motion: no logo beat, so the button is reachable straight away.
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Welcome", () => {
  it("keeps Tab on its button, so focus can't wander to the map behind it", () => {
    render(
      <>
        <Welcome onLeave={() => {}} onDone={() => {}} />
        <button>Behind</button>
      </>,
    );
    const cta = screen.getByRole("button", { name: /Open your notebook/ });
    fireEvent.keyDown(document.activeElement ?? window, { key: "Tab" });
    expect(document.activeElement).toBe(cta);
    fireEvent.keyDown(cta, { key: "Tab" });
    expect(document.activeElement).toBe(cta);
    fireEvent.keyDown(cta, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cta);
  });
});
