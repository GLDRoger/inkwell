import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { Page } from "@shared/types";

const updatePage = vi.fn(async (id: string, patch: Partial<Page>) => ({ ...page, id, ...patch }));
vi.mock("../lib/api", async (orig) => {
  const real = await orig<typeof import("../lib/api")>();
  return { ...real, api: { ...real.api, updatePage: (id: string, patch: Partial<Page>) => updatePage(id, patch) } };
});

const { TitleField } = await import("./PageView");

const page: Page = {
  id: "p1", title: "Trip", parentId: null, icon: null, position: "a", excerpt: "", x: null, y: null, coverUrl: null,
  createdAt: "", updatedAt: "", updatedBy: { kind: "person", id: "u", name: "U" },
};

afterEach(() => {
  cleanup();
  updatePage.mockClear();
});

describe("TitleField", () => {
  it("saves a title typed just before leaving the page (browser Back unmounts it mid-pause)", async () => {
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TitleField page={page} onEnter={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Page title"), { target: { value: "Trip to Lisbon" } });
    expect(updatePage).not.toHaveBeenCalled();
    await act(async () => view.unmount());
    expect(updatePage).toHaveBeenCalledWith("p1", { title: "Trip to Lisbon" });
  });
});
