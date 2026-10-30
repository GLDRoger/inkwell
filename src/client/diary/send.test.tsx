import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { Agent, MapGraph } from "@shared/types";
import { keys } from "../lib/queries";
import { getUi, setUi } from "../lib/ui";
import { reloadKey } from "../lib/key";
import { KeyDialog } from "../key/KeyDialog";
import { DiaryPanel } from "./DiaryPanel";

vi.mock("./recorder", () => ({
  canRecord: () => true,
  startRecording: async () => ({ stop: async () => new Blob(["x"], { type: "audio/wav" }), cancel() {} }),
}));

const wren: Agent = { id: "wren", name: "Wren", description: "Writes", instructions: "", color: "#3b7a58", model: "muse-wonder-1.0" };
const fetchMock = vi.fn();

function show(prepare?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, enabled: false } } });
  client.setQueryData(keys.me, { workspaceId: "w", person: { kind: "person", id: "u", name: "You" }, metaConnected: false, demoWorkspaceId: null });
  client.setQueryData(keys.threads, []);
  client.setQueryData(keys.agents, [wren]);
  client.setQueryData<MapGraph>(keys.map, { pages: [], links: [], agents: [wren], runs: [] });
  client.setQueryData(keys.pages, []);
  prepare?.(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DiaryPanel />
        <KeyDialog />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const diaryPosts = () => fetchMock.mock.calls.filter(([url, init]) => url === "/api/diary" && init?.method === "POST");

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("min-width"), media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  localStorage.clear();
  localStorage.setItem("inkwell-diary-introduced", "1");
  reloadKey();
  setUi({ diaryOpen: true, keyDialog: null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setUi({ diaryOpen: false, keyDialog: null });
  localStorage.clear();
  reloadKey();
});

describe("a request that needed a key", () => {
  it("sends itself once the key is saved", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ entry: { id: "e1", threadId: "t1", role: "person", agentId: null, text: "Plan my 5 days in Lisbon", pageIds: [], attachments: [], runId: null, createdAt: "2026-10-30T10:00:00Z" }, runId: "r1", threadId: "t1" }), { status: 200, headers: { "content-type": "application/json" } }));
    show();
    fireEvent.click(screen.getByRole("button", { name: /Plan my 5 days in Lisbon/ }));
    expect(getUi().keyDialog).toBeTruthy();
    expect(diaryPosts()).toHaveLength(0);
    expect((screen.getByLabelText("Your request") as HTMLTextAreaElement).value).toBe("Plan my 5 days in Lisbon");

    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-visitor" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(getUi().keyDialog).toBeNull();
    await vi.waitFor(() => expect(diaryPosts()).toHaveLength(1));
    expect(JSON.parse(diaryPosts()[0][1].body).text).toBe("Plan my 5 days in Lisbon");
    expect(new Headers(diaryPosts()[0][1].headers).get("X-Meta-Key")).toBe("sk-visitor");
  });

  it("stays in the composer when the dialog closes without a key", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /Plan my 5 days in Lisbon/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(getUi().keyDialog).toBeNull();
    expect(diaryPosts()).toHaveLength(0);
    expect((screen.getByLabelText("Your request") as HTMLTextAreaElement).value).toBe("Plan my 5 days in Lisbon");
  });
});

describe("voice", () => {
  it("says so when Muse Voice heard no words", async () => {
    localStorage.setItem("inkwell-meta-key", "sk-visitor");
    reloadKey();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ text: "  " }), { status: 200, headers: { "content-type": "application/json" } }));
    show();
    const mic = screen.getByRole("button", { name: "Speak your request" });
    await act(async () => {
      fireEvent.click(mic);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop and transcribe" }));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.getByText("Didn't catch that. Try again a little closer to the mic, or type instead.")).toBeTruthy();
  });
});

describe("replies from agents the diary doesn't know yet", () => {
  it("fetches the agents again (Watch again resets the demo's agents), so the reply isn't signed 'The agent'", () => {
    const spy = vi.fn();
    show((client) => {
      const original = client.invalidateQueries.bind(client);
      vi.spyOn(client, "invalidateQueries").mockImplementation((filters, options) => (spy(filters?.queryKey), original(filters, options)));
      client.setQueryData(keys.threads, [{ id: "t1", title: "Plan", updatedAt: "2026-10-30T10:00:00Z" }]);
      client.setQueryData(keys.thread("t1"), [
        { id: "e2", threadId: "t1", role: "agent", agentId: "wren-new", text: "On it.", pageIds: [], attachments: [], runId: null, createdAt: "2026-10-30T10:00:01Z" },
      ]);
    });
    expect(spy).toHaveBeenCalledWith(keys.agents);
  });
});
