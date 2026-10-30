import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { DemoScenario } from "@shared/types";
import { getDemo, initialDemo, setDemo } from "./demo";
import { MAP_CAMERA_KEY, demoBarDocked, getDemoBarRoom, leaveDemo, measureDemoBar, startDemo, stopDemo, syncDemo, tryItYourself, watchDemoBar } from "./demo-flow";
import { keys } from "./queries";
import { getUi, setUi } from "./ui";
import { GUIDED_KEY } from "../guide/seen";

const scenario: DemoScenario = {
  id: "lisbon",
  title: "Inkwell",
  recordedFrom: "rehearsal",
  steps: [
    { id: "a", caption: "Wren is planning your trip." },
    { id: "b", caption: "Scout summarises your reading." },
  ],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const me = { workspaceId: "w", person: { kind: "person", id: "u", name: "You" }, metaConnected: false, demoWorkspaceId: null };
const fetchMock = vi.fn();
const calls = () => fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit)?.method ?? "GET"} ${url} ${new Headers((init as RequestInit)?.headers).get("X-Inkwell-Notebook") ?? "own"}`);

let client: QueryClient;
beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(keys.me, me);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setDemo(initialDemo("own"));
  setUi({ guideOpen: false });
});

describe("starting the demo", () => {
  it("resets it on the server, switches to the demo notebook and shows the first caption", async () => {
    client.setQueryData(keys.pages, [{ id: "mine" }]);
    sessionStorage.setItem(MAP_CAMERA_KEY, JSON.stringify({ x: 1, y: 2, s: 1 }));
    fetchMock.mockImplementation(async () => json({ scenario }));
    expect(await startDemo(client)).toBe(true);
    expect(calls()).toEqual(["POST /api/demo/start own"]);
    expect(getDemo()).toMatchObject({ notebook: "demo", playing: true, index: 0, step: scenario.steps[0], starting: false });
    // The map's saved camera belonged to the other notebook's pages.
    expect(sessionStorage.getItem(MAP_CAMERA_KEY)).toBeNull();
    // Nothing from the visitor's own notebook stays cached; who they are does.
    expect(client.getQueryData(keys.pages)).toBeUndefined();
    expect(client.getQueryData(keys.me)).toEqual(me);
  });

  it("stays put and says so when the server can't start it", async () => {
    fetchMock.mockImplementation(async () => json({ error: "nope" }, 500));
    expect(await startDemo(client)).toBe(false);
    expect(getDemo()).toMatchObject({ notebook: "own", starting: false });
  });
});

describe("leaving the demo", () => {
  it("Stop keeps the demo notebook on screen and tells the server", async () => {
    setDemo({ notebook: "demo", playing: true, scenario, index: 0 });
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    await stopDemo();
    expect(getDemo()).toMatchObject({ notebook: "demo", playing: false, ended: "stopped" });
    expect(calls()).toEqual(["POST /api/demo/stop demo"]);
  });

  it("Try it yourself stops playback, goes back to the own notebook and opens the guide the first time", () => {
    setDemo({ notebook: "demo", playing: true, scenario, index: 1 });
    client.setQueryData(keys.map, { pages: [{ id: "demo-page" }] });
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    tryItYourself(client);
    expect(calls()).toEqual(["POST /api/demo/stop demo"]);
    expect(getDemo()).toMatchObject({ notebook: "own", scenario: null, index: -1 });
    expect(client.getQueryData(keys.map)).toBeUndefined();
    expect(getUi().guideOpen).toBe(true);

    setUi({ guideOpen: false });
    localStorage.setItem(GUIDED_KEY, "1");
    setDemo({ notebook: "demo" });
    tryItYourself(client);
    expect(getUi().guideOpen).toBe(false);
  });

  it("doesn't stop anything when the demo had already ended", () => {
    setDemo({ notebook: "demo", playing: false, ended: "finished", scenario });
    leaveDemo(client);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getDemo().notebook).toBe("own");
  });
});

describe("a reload mid-demo", () => {
  it("restores the step from GET /api/demo", async () => {
    setDemo({ notebook: "demo" });
    fetchMock.mockImplementation(async () => json({ playing: true, scenario, stepIndex: 1 }));
    await syncDemo(client);
    expect(calls()).toEqual(["GET /api/demo demo"]);
    expect(getDemo()).toMatchObject({ notebook: "demo", playing: true, index: 1, step: scenario.steps[1] });
  });

  it("goes back to the own notebook when there's no demo any more", async () => {
    setDemo({ notebook: "demo" });
    fetchMock.mockImplementation(async () => json({ playing: false, scenario: null, stepIndex: -1 }));
    await syncDemo(client);
    expect(getDemo().notebook).toBe("own");
  });
});

describe("room for the demo's caption bar", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-demo-dock");
    document.documentElement.style.removeProperty("--peek-cover-right");
    measureDemoBar();
  });

  it("docks along the bottom on phones, over a bottom sheet, or when the free map is too narrow", () => {
    expect(demoBarDocked({ vw: 375, diary: 0, peek: 0, sheet: false })).toBe(true);
    expect(demoBarDocked({ vw: 768, diary: 0, peek: 0, sheet: true })).toBe(true);
    // 768 with the diary open leaves 316px of map: too narrow to float in.
    expect(demoBarDocked({ vw: 768, diary: 452, peek: 0, sheet: false })).toBe(true);
    expect(demoBarDocked({ vw: 1280, diary: 0, peek: 572, sheet: false })).toBe(false);
    expect(demoBarDocked({ vw: 1280, diary: 452, peek: 0, sheet: false })).toBe(false);
  });

  it("publishes where the bar is on <html>, and clears it once the bar has gone", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    document.body.innerHTML = `<div class="app" data-diary="closed"><section class="demo-bar"></section><aside class="peek" data-mode="sheet"></aside></div>`;
    measureDemoBar();
    const root = document.documentElement;
    expect(root.hasAttribute("data-demo-dock")).toBe(true);
    expect(root.style.getPropertyValue("--demo-bar-space")).toMatch(/^\d+px$/);
    expect(getDemoBarRoom()).toMatchObject({ docked: true });
    document.querySelector(".peek")!.remove();
    measureDemoBar();
    expect(root.hasAttribute("data-demo-dock")).toBe(false);
    document.body.innerHTML = "";
    measureDemoBar();
    expect(root.style.getPropertyValue("--demo-bar-space")).toBe("");
    expect(getDemoBarRoom()).toEqual({ space: 0, docked: false });
  });
});

describe("watching the caption bar", () => {
  it("leaves nothing docked once the last watcher stops", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    document.body.innerHTML = `<section class="demo-bar"></section>`;
    const a = watchDemoBar();
    const b = watchDemoBar();
    expect(document.documentElement.hasAttribute("data-demo-dock")).toBe(true);
    a();
    expect(document.documentElement.hasAttribute("data-demo-dock")).toBe(true);
    b();
    expect(document.documentElement.hasAttribute("data-demo-dock")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--demo-bar-space")).toBe("");
    document.body.innerHTML = "";
  });
});
