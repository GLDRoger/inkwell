import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Page } from "@shared/types";
import { CameraController } from "./camera";
import { CARD_KEYS_ID, MapCard } from "./map-card";

const page: Page = {
  id: "p1",
  title: "Photo notes",
  icon: null,
  parentId: null,
  excerpt: "Five notes",
  createdAt: "2026-10-30T10:00:00.000Z",
  updatedAt: "2026-10-30T10:00:00.000Z",
  updatedBy: { kind: "person", id: "u", name: "Sam" },
} as unknown as Page;

function card(patch: Partial<Parameters<typeof MapCard>[0]> = {}) {
  const onClick = vi.fn();
  const onOpen = vi.fn();
  render(
    <MapCard
      page={page}
      box={{ id: "p1", x: 0, y: 0, w: 280, h: 200, depth: 0, regionId: "r", pinned: false }}
      detail="mid"
      writing={null}
      freshAt={null}
      born={false}
      inkAt={0}
      touchedInk={null}
      crumb=""
      now={Date.parse(page.updatedAt) + 1000}
      you
      seeded={false}
      movable={false}
      camera={new CameraController()}
      onClick={onClick}
      onOpen={onOpen}
      onMove={() => {}}
      {...patch}
    />,
  );
  return { el: screen.getByRole("button"), onClick, onOpen };
}

afterEach(cleanup);

describe("a card on the map", () => {
  it("peeks with Space and opens with Enter, and says so to screen readers", () => {
    const { el, onClick, onOpen } = card();
    expect(el.getAttribute("aria-describedby")).toBe(CARD_KEYS_ID);
    fireEvent.keyDown(el, { key: " " });
    expect(onClick).toHaveBeenCalledWith("p1");
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(el, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("p1");
  });

  it("credits what a person did in the recorded demo to the demo, not to you", () => {
    expect(card({ readOnly: true }).el.getAttribute("aria-label")).toMatch(/Last edited by Demo/);
    cleanup();
    expect(card().el.getAttribute("aria-label")).toMatch(/Last edited by you/);
  });
});
