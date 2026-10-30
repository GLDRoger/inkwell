import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { Page, ServerEvent } from "@shared/types";
import { keys } from "../lib/queries";
import { dismiss, getNotices, hold, release, close } from "../lib/notices";
import { createDeleteUndo, noticeIdFor, PendingDeletes, subtreeOf } from "./deleteUndo";

describe("PendingDeletes", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends the delete only after the undo window closes", () => {
    const d = new PendingDeletes(6000);
    const commit = vi.fn();
    d.schedule("a", ["a", "b"], commit);
    expect(d.isHidden("b")).toBe(true);
    vi.advanceTimersByTime(5999);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(d.isHidden("a")).toBe(false);
  });

  it("Undo inside the window means the server never hears about it", () => {
    const d = new PendingDeletes(6000);
    const commit = vi.fn();
    d.schedule("a", ["a"], commit);
    vi.advanceTimersByTime(3000);
    expect(d.cancel("a")).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(commit).not.toHaveBeenCalled();
    expect(d.isHidden("a")).toBe(false);
  });

  it("Undo after the delete went reports that it's too late", () => {
    const d = new PendingDeletes(10);
    d.schedule("a", ["a"], () => {});
    vi.advanceTimersByTime(10);
    expect(d.cancel("a")).toBe(false);
  });

  it("closing the tab sends every waiting delete at once, exactly once", () => {
    const d = new PendingDeletes(6000);
    const a = vi.fn();
    const b = vi.fn();
    d.schedule("a", ["a"], a);
    d.schedule("b", ["b"], b);
    d.flush();
    vi.advanceTimersByTime(6000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe("subtreeOf", () => {
  it("includes every page inside, however deep", () => {
    const pages = [
      { id: "root", parentId: null },
      { id: "kid", parentId: "root" },
      { id: "grandkid", parentId: "kid" },
      { id: "other", parentId: null },
    ];
    expect([...subtreeOf(pages, "root")].sort()).toEqual(["grandkid", "kid", "root"]);
  });
});

const pg = (id: string, parentId: string | null = null): Page => ({
  id, title: id.toUpperCase(), parentId, icon: null, position: "a", excerpt: "", x: null, y: null, coverUrl: null,
  createdAt: "", updatedAt: "", updatedBy: { kind: "person", id: "u", name: "U" },
});

/** A notebook with a parent P holding C, and an unrelated page O; the server starts with all three. */
function setup() {
  const client = new QueryClient();
  let server = [pg("p"), pg("c", "p"), pg("o")];
  client.setQueryData(keys.pages, server);
  const send = vi.fn(async (id: string, _keepalive: boolean) => {
    const gone = subtreeOf(server, id);
    server = server.filter((p) => !gone.has(p.id));
  });
  const navigate = vi.fn();
  const listeners = new Set<(e: ServerEvent) => void>();
  const d = createDeleteUndo({
    client,
    navigate,
    send,
    fetchPages: async () => server,
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    delay: 6000,
  });
  const shown = () => (client.getQueryData<Page[]>(keys.pages) ?? []).map((p) => p.id).sort();
  const notice = (id: string) => getNotices().find((n) => n.id === noticeIdFor(id));
  const agentDeletes = (id: string) => {
    const gone = subtreeOf(server, id);
    server = server.filter((p) => !gone.has(p.id));
    gone.forEach((pageId) => listeners.forEach((l) => l({ type: "page.deleted", pageId } as ServerEvent)));
  };
  return { client, d, send, navigate, shown, notice, agentDeletes, server: () => server.map((p) => p.id).sort() };
}

describe("delete with undo", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    getNotices().forEach((n) => dismiss(n.id));
    vi.useRealTimers();
  });

  it("hides the page and what's inside it at once, and only tells the server when the window closes", async () => {
    const t = setup();
    t.d.remove(pg("p"));
    expect(t.shown()).toEqual(["o"]);
    expect(t.notice("p")?.text).toBe("Deleted “P” and the page inside it.");
    vi.advanceTimersByTime(5999);
    expect(t.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.send).toHaveBeenCalledWith("p", false);
    expect(t.notice("p")).toBeUndefined();
  });

  it("Undo brings it back and opens it; the server never hears", async () => {
    const t = setup();
    t.d.remove(pg("p"));
    expect(await t.d.undo("p")).toBe(true);
    expect(t.shown()).toEqual(["c", "o", "p"]);
    expect(t.navigate).toHaveBeenCalledWith("/p/p");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.send).not.toHaveBeenCalled();
  });

  it("child, then parent, then Undo on the child: the child comes back, and so does the parent it lives in", async () => {
    const t = setup();
    t.d.remove(pg("c", "p"));
    t.d.remove(pg("p"));
    // The parent's notice doesn't count the child twice.
    expect(t.notice("p")?.text).toBe("Deleted “P”.");
    expect(t.shown()).toEqual(["o"]);
    expect(await t.d.undo("c")).toBe(true);
    expect(t.shown()).toEqual(["c", "o", "p"]);
    expect(t.notice("p")).toBeUndefined();
    expect(getNotices().some((n) => n.text === "Brought back “P” too, because “C” is inside it.")).toBe(true);
    expect(t.navigate).toHaveBeenLastCalledWith("/p/c");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.send).not.toHaveBeenCalled();
    expect(t.server()).toEqual(["c", "o", "p"]);
  });

  it("child, then parent, then Undo on the parent: the parent is back, the child's own delete still goes ahead", async () => {
    const t = setup();
    t.d.remove(pg("c", "p"));
    vi.advanceTimersByTime(1000);
    t.d.remove(pg("p"));
    await t.d.undo("p");
    expect(t.shown()).toEqual(["o", "p"]);
    expect(t.notice("c")).toBeDefined();
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.send).toHaveBeenCalledWith("c", false);
    expect(t.server()).toEqual(["o", "p"]);
  });

  it("when the parent's delete goes first, the child's Undo is withdrawn rather than left to fail", async () => {
    const t = setup();
    t.d.remove(pg("c", "p"));
    hold(noticeIdFor("c")); // someone is reading the child's notice, so its clock is stopped
    t.d.remove(pg("p"));
    await vi.advanceTimersByTimeAsync(6000);
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.send).toHaveBeenCalledWith("p", false);
    expect(t.notice("c")).toBeUndefined();
    expect(await t.d.undo("c")).toBe(false);
    expect(t.server()).toEqual(["o"]);
  });

  it("hiding or closing the tab sends every waiting delete at once, with keepalive, and clears their notices", async () => {
    const t = setup();
    t.d.remove(pg("c", "p"));
    t.d.remove(pg("o"));
    t.d.flush();
    expect(t.send).toHaveBeenCalledTimes(2);
    expect(t.send.mock.calls.every(([, keepalive]) => keepalive)).toBe(true);
    expect(getNotices()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.send).toHaveBeenCalledTimes(2);
  });

  it("stops the clock while the notice is being read, and closing the notice sends the delete straight away", async () => {
    const t = setup();
    t.d.remove(pg("o"));
    vi.advanceTimersByTime(4000);
    hold(noticeIdFor("o"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.send).not.toHaveBeenCalled();
    release(noticeIdFor("o"));
    await vi.advanceTimersByTimeAsync(1999);
    expect(t.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.send).toHaveBeenCalledTimes(1);

    t.d.remove(pg("c", "p"));
    close(noticeIdFor("c"));
    expect(t.send).toHaveBeenLastCalledWith("c", false);
  });

  it("an agent deleting the page during the window turns the Undo into an honest note, and nothing is sent", async () => {
    const t = setup();
    t.d.remove(pg("p"));
    t.agentDeletes("p");
    expect(t.notice("p")?.action).toBeUndefined();
    expect(t.notice("p")?.text).toBe("“P” was also deleted elsewhere, so it can't come back.");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.send).not.toHaveBeenCalled();
  });

  it("Undo checks the page still exists before opening it (the event saying otherwise never arrived)", async () => {
    const t = setup();
    t.d.remove(pg("c", "p"));
    // The server loses C behind this tab's back, e.g. while the live stream was down.
    await t.send("c", false);
    t.send.mockClear();
    expect(await t.d.undo("c")).toBe(false);
    expect(t.navigate).not.toHaveBeenCalledWith("/p/c");
    expect(getNotices().some((n) => n.tone === "error" && n.text === "“C” was also deleted elsewhere, so it can't come back.")).toBe(true);
  });

  it("the Undo notice survives a burst of other notices", async () => {
    const { notify } = await import("../lib/notices");
    const t = setup();
    t.d.remove(pg("o"));
    for (let i = 0; i < 6; i++) notify({ tone: "error", text: `Cover failed ${i}` });
    expect(t.notice("o")?.action?.label).toBe("Undo");
  });
});
