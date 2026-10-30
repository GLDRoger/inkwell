import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, isNotConnected } from "./api";
import { initialDemo, setDemo } from "./demo";
import { forgetKey, saveKey } from "./key";
import { eventsUrl } from "./events";
import { collabUrl } from "../page/collab";

const fetchMock = vi.fn();
const sent = () => new Headers((fetchMock.mock.calls.at(-1)![1] as RequestInit).headers);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setDemo(initialDemo("own"));
  forgetKey();
});

describe("which notebook a request is for", () => {
  it("sends no notebook header for the visitor's own notebook", async () => {
    await api.pages();
    expect(sent().get("X-Inkwell-Notebook")).toBeNull();
    expect(eventsUrl("own")).toBe("/api/events");
    expect(collabUrl()).toMatch(/\/collab$/);
  });

  it("picks the demo notebook on HTTP, the event stream and collab", async () => {
    setDemo({ notebook: "demo" });
    await api.map();
    expect(sent().get("X-Inkwell-Notebook")).toBe("demo");
    expect(eventsUrl("demo")).toBe("/api/events?notebook=demo");
    expect(collabUrl()).toMatch(/\/collab\?notebook=demo$/);
  });

  it("never asks the server to change the demo notebook, and says why calmly", async () => {
    setDemo({ notebook: "demo" });
    await expect(api.createPage({ title: "x" })).rejects.toMatchObject({ status: 403, code: "demo_read_only", message: expect.stringMatching(/recorded demo/) });
    await expect(api.writeDiary({ text: "hi" })).rejects.toMatchObject({ code: "demo_read_only" });
    expect(fetchMock).not.toHaveBeenCalled();
    // Presence and the demo's own controls still go through.
    await api.presence(null);
    await api.stopDemo();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("the visitor's key on AI requests", () => {
  it("rides on diary, transcribe, photo and cover requests, and nothing else", async () => {
    saveKey("sk-visitor", "muse-spark-1.3-contributor");
    await api.writeDiary({ text: "Plan my week" });
    expect(sent().get("X-Meta-Key")).toBe("sk-visitor");
    expect(sent().get("X-Meta-Model")).toBe("muse-spark-1.3-contributor");
    await api.transcribe(new Blob(["x"]));
    expect(sent().get("X-Meta-Key")).toBe("sk-visitor");
    await api.importPhoto("a1");
    expect(sent().get("X-Meta-Key")).toBe("sk-visitor");
    await api.illustrate("p1");
    expect(sent().get("X-Meta-Key")).toBe("sk-visitor");
    await api.pages();
    expect(sent().get("X-Meta-Key")).toBeNull();
    await api.map();
    expect(sent().get("X-Meta-Model")).toBeNull();
  });

  it("is left off when there's no key", async () => {
    await api.writeDiary({ text: "Plan my week" });
    expect(sent().get("X-Meta-Key")).toBeNull();
    expect(sent().get("content-type")).toBe("application/json");
  });

  it("checks a key by sending it once, in the header", async () => {
    await api.checkKey("sk-check");
    expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/key/check");
    expect(sent().get("X-Meta-Key")).toBe("sk-check");
  });

  it("recognises the server's 'not connected' answer", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "No Meta key.", code: "meta_not_connected" }), { status: 503 }));
    const e = await api.writeDiary({ text: "hi" }).catch((x) => x);
    expect(isNotConnected(e)).toBe(true);
    expect(isNotConnected(new ApiError(503, "Meta API key isn't configured"))).toBe(true);
    expect(isNotConnected(new ApiError(503, "Restarting", "restarting"))).toBe(false);
  });
});
