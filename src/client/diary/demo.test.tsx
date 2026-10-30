import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { Agent, DiaryEntry, MapGraph } from "@shared/types";
import { keys } from "../lib/queries";
import { emit } from "../lib/events";
import { initialDemo, setDemo } from "../lib/demo";
import { setUi } from "../lib/ui";
import { DiaryPanel } from "./DiaryPanel";

const wren: Agent = { id: "wren", name: "Wren", description: "Writes", instructions: "", color: "#3b7a58", model: "muse-wonder-1.0" };
const person: DiaryEntry = { id: "e1", threadId: "t1", role: "person", agentId: null, text: "Plan my 5 days in Lisbon", pageIds: [], attachments: [], runId: null, createdAt: "2026-10-30T10:00:00Z" };

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, enabled: false } } });
  client.setQueryData(keys.me, { workspaceId: "w", person: { kind: "person", id: "u", name: "You" }, metaConnected: false, demoWorkspaceId: "d" });
  client.setQueryData(keys.threads, []);
  client.setQueryData(keys.agents, [wren]);
  client.setQueryData<MapGraph>(keys.map, { pages: [], links: [], agents: [wren], runs: [] });
  client.setQueryData(keys.pages, []);
  client.setQueryData(keys.thread("t1"), [person]);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DiaryPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("min-width"), media: q, addEventListener() {}, removeEventListener() {} }));
  localStorage.setItem("inkwell-diary-introduced", "1");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setDemo(initialDemo("own"));
  setUi({ diaryOpen: false });
});

describe("the diary in the demo", () => {
  it("is read-only, with a calm explanation instead of the composer", () => {
    setDemo({ notebook: "demo" });
    setUi({ diaryOpen: true });
    show();
    expect(screen.queryByLabelText("Your request")).toBeNull();
    expect(screen.getByText("This is a recorded demo, so you can watch but not write.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Try it yourself/ })).toBeTruthy();
  });

  it("opens and follows the demo's conversation, writing the request in", () => {
    setDemo({ notebook: "demo" });
    show();
    act(() => emit({ type: "diary.entry", entry: person }));
    expect(document.querySelector(".entry-person[data-fresh] .written-in")).toBeTruthy();
    expect(screen.getByText("Plan my 5 days in Lisbon", { selector: ".sr-only" })).toBeTruthy();
    expect(document.querySelector(".diary")?.getAttribute("data-open")).toBe("true");
  });

  it("keeps the composer in the visitor's own notebook", () => {
    show();
    expect(screen.getByLabelText("Your request")).toBeTruthy();
    expect(screen.queryByText(/recorded demo/)).toBeNull();
  });
});
