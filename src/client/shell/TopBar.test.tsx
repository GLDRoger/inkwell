import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { MapGraph } from "@shared/types";
import { keys } from "../lib/queries";
import { setUi } from "../lib/ui";
import { TopBar } from "./TopBar";

afterEach(() => {
  cleanup();
  setUi({ diaryOpen: false });
});

describe("the Diary pill", () => {
  it("stays named Diary and says whether the diary is open", () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, enabled: false } } });
    client.setQueryData<MapGraph>(keys.map, { pages: [], links: [], agents: [], runs: [] });
    client.setQueryData(keys.pages, []);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TopBar />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const pill = screen.getByRole("button", { name: "Diary" });
    expect(pill.getAttribute("aria-expanded")).toBe("false");
    expect(pill.getAttribute("aria-controls")).toBe("diary");
    act(() => setUi({ diaryOpen: true }));
    expect(screen.getByRole("button", { name: "Diary" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("button", { name: "Close the diary" })).toBeNull();
  });
});
