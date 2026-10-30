import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Welcome } from "./Welcome";

beforeEach(() => {
  // Reduced motion: no logo beat, so the buttons are reachable straight away.
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Welcome", () => {
  it("keeps Tab on its two buttons, so focus can't wander to the map behind it", () => {
    render(
      <>
        <Welcome onLeave={() => {}} onDone={() => {}} />
        <button>Behind</button>
      </>,
    );
    const watch = screen.getByRole("button", { name: /Watch it work/ });
    const own = screen.getByRole("button", { name: /Try it yourself/ });
    fireEvent.keyDown(document.activeElement ?? window, { key: "Tab" });
    expect(document.activeElement).toBe(watch);
    fireEvent.keyDown(watch, { key: "Tab" });
    expect(document.activeElement).toBe(own);
    fireEvent.keyDown(own, { key: "Tab" });
    expect(document.activeElement).toBe(watch);
    fireEvent.keyDown(watch, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(own);
  });

  it("says which way the visitor chose", () => {
    const onLeave = vi.fn();
    render(<Welcome onLeave={onLeave} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Watch it work/ }));
    expect(onLeave).toHaveBeenCalledWith("watch");
    cleanup();
    const again = vi.fn();
    render(<Welcome onLeave={again} onDone={() => {}} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(again).toHaveBeenCalledWith("try");
  });
});
