import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { keys } from "../lib/queries";
import { getUi, setUi } from "../lib/ui";
import { forgetKey, saveKey } from "../lib/key";
import { Guide, GUIDE_STEPS } from "./Guide";
import { GUIDED_KEY, hasBeenGuided } from "./seen";
import { placeCard } from "./CoachMark";

function show(metaConnected = false) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, enabled: false } } });
  client.setQueryData(keys.me, { workspaceId: "w", person: { kind: "person", id: "u", name: "You" }, metaConnected, demoWorkspaceId: null });
  return render(
    <QueryClientProvider client={client}>
      <button className="quill-button">Diary</button>
      <button className="brand">Inkwell</button>
      <Guide />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  localStorage.clear();
  forgetKey();
  setUi({ guideOpen: true, keyDialog: null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setUi({ guideOpen: false, keyDialog: null });
});

describe("the guide", () => {
  it("says tap on touch screens, click with a mouse", () => {
    show();
    expect(screen.getByText(/Click one to peek inside, double-click to open it/)).toBeTruthy();
    cleanup();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("hover: none"), media: q, addEventListener() {}, removeEventListener() {} }));
    show();
    expect(screen.getByText("Each card is a page. Tap one to peek inside, double-tap to open it, and drag to look around.")).toBeTruthy();
  });

  it("walks through four steps with Next and Back, and Done remembers it", () => {
    saveKey("sk-visitor");
    show();
    expect(screen.getByRole("dialog", { name: GUIDE_STEPS[0].title })).toBeTruthy();
    expect(screen.getByText("1 of 4")).toBeTruthy();
    // Focus moves to the mark, so screen readers and keyboards land on it.
    expect(document.activeElement?.textContent).toBe(GUIDE_STEPS[0].title);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Ask in the diary" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: GUIDE_STEPS[0].title })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("4 of 4")).toBeTruthy();
    // A key is already here: the last step just says so.
    expect(screen.getByText(/ready to use/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(getUi().guideOpen).toBe(false);
    expect(hasBeenGuided()).toBe(true);
  });

  it("closes on Escape and counts as seen", () => {
    show();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(getUi().guideOpen).toBe(false);
    expect(localStorage.getItem(GUIDED_KEY)).toBe("1");
  });

  it("keeps Tab inside the mark", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const buttons = screen.getAllByRole("button").filter((b) => b.closest(".coach"));
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(buttons.at(-1));
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("ends by opening the key dialog when no key works yet", () => {
    show(false);
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Add your Meta API key" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add your key" }));
    expect(getUi().guideOpen).toBe(false);
    expect(getUi().keyDialog).toBeTruthy();
  });

  it("offers Later instead of opening the dialog", () => {
    show(false);
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    act(() => fireEvent.click(screen.getByRole("button", { name: "Later" })));
    expect(getUi().guideOpen).toBe(false);
    expect(getUi().keyDialog).toBeNull();
  });
});

describe("placing a coach mark", () => {
  const view = { width: 1280, height: 800 };
  const card = { width: 320, height: 180 };
  it("goes below its target, kept on screen", () => {
    expect(placeCard({ top: 10, left: 1200, width: 70, height: 38 }, card, view)).toEqual({ top: 60, left: 1280 - 320 - 12, side: "below" });
  });
  it("goes above when there's no room below", () => {
    expect(placeCard({ top: 740, left: 20, width: 140, height: 44 }, card, view)).toMatchObject({ top: 740 - 12 - 180, left: 12, side: "above" });
  });
});
