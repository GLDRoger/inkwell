import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { AgentAvatar, DONE_MS } from "./AgentAvatar";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AgentAvatar", () => {
  it("animates as inline SVG in the agent's ink, and is decorative", () => {
    const { container } = render(<AgentAvatar name="Wren" color="#3b7a58" size={28} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-hidden")).toBe("true");
    const svg = root.querySelector("svg")!;
    expect(svg).not.toBeNull();
    expect(svg.style.getPropertyValue("--mo-head")).toBe("#3b7a58");
    expect(svg.querySelector(".mo-always")).not.toBeNull();
  });

  it("is a single still <img> when not animated", () => {
    const { container } = render(<AgentAvatar name="Atlas" color="#6b56a8" size={18} animate={false} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
  });

  it("turns its eyes to the page only while reading or writing", () => {
    const { container, rerender } = render(<AgentAvatar name="Scout" color="#c0602f" size={40} state="reading" look="left" />);
    const root = () => container.firstElementChild as HTMLElement;
    expect(root().dataset.look).toBe("left");
    rerender(<AgentAvatar name="Scout" color="#c0602f" size={40} state="thinking" look="left" />);
    expect(root().dataset.look).toBeUndefined();
  });

  it("is happy for a beat when it finishes, then rests", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<AgentAvatar name="Scout" color="#c0602f" size={40} state="writing" />);
    const root = () => container.firstElementChild as HTMLElement;
    rerender(<AgentAvatar name="Scout" color="#c0602f" size={40} state="idle" />);
    expect(root().dataset.state).toBe("done");
    act(() => vi.advanceTimersByTime(DONE_MS + 10));
    expect(root().dataset.state).toBe("idle");
  });
});
