import { describe, expect, it } from "vitest";
import { OFFLINE_GRACE_MS, SLOW_CONNECT_MS, STUCK_AFTER_MS, offlineMessage, syncView, type SyncInput } from "./syncState";

const base: SyncInput = { status: "connected", synced: true, everSynced: true, unsynced: 0, pendingSince: null, connectingSince: 0, now: 100_000 };
const view = (patch: Partial<SyncInput>) => syncView({ ...base, ...patch });

describe("syncView", () => {
  it("says Saved when the server has everything", () => {
    expect(view({})).toMatchObject({ tone: "quiet", label: "Saved" });
  });

  it("says Saving… while a change is on its way", () => {
    expect(view({ unsynced: 1, pendingSince: base.now - 500 })).toMatchObject({ tone: "busy", label: "Saving…" });
  });

  it("stops saying Saving… and reports an error when the server keeps rejecting changes", () => {
    const v = view({ unsynced: 2, pendingSince: base.now - STUCK_AFTER_MS - 1 });
    expect(v).toMatchObject({ tone: "bad", label: "Not saving" });
    expect(v.detail).toMatch(/reload/i);
  });

  it("says Connecting… on first load, then a problem if it takes too long", () => {
    const first = { everSynced: false, synced: false, status: "connecting" as const, connectingSince: base.now - 1000 };
    expect(view(first)).toMatchObject({ tone: "busy", label: "Connecting…" });
    expect(view({ ...first, connectingSince: base.now - SLOW_CONNECT_MS - 1 })).toMatchObject({ tone: "bad", label: "Can't connect" });
  });

  it("gives a dropped connection a moment, then says it can't reach the notebook", () => {
    const dropped = { status: "connecting" as const, synced: false };
    expect(view({ ...dropped, connectingSince: base.now - 500 })).toMatchObject({ tone: "busy", label: "Reconnecting…" });
    const off = view({ ...dropped, connectingSince: base.now - OFFLINE_GRACE_MS - 1 });
    expect(off).toMatchObject({ tone: "bad", label: "Not connected" });
    expect(off.detail).toBe(offlineMessage("unreachable", "page"));
    expect(view({ ...dropped, unsynced: 3, connectingSince: 0 }).label).toBe("Not connected, not saved yet");
  });

  it("believes the browser when it says it's offline, even before the socket notices", () => {
    // The socket still looks connected and a change is waiting: that's not "Saving…".
    const v = view({ browserOnline: false, unsynced: 1, pendingSince: base.now - 100 });
    expect(v).toMatchObject({ tone: "bad", label: "Offline, not saved yet" });
    expect(v.detail).toBe(offlineMessage("offline", "page"));
    expect(view({ browserOnline: false }).label).toBe("Offline");
  });

  it("tells one story: the save status and the connection notice use the same words", () => {
    for (const kind of ["offline", "unreachable"] as const) {
      const page = offlineMessage(kind, "page");
      expect(page).toMatch(/Keep this tab open/);
      expect(page).toMatch(/will save when/);
      expect(page).not.toMatch(/sync|Saving/);
    }
    expect(offlineMessage("offline", "map")).not.toMatch(/edits/);
  });

  it("goes back to Saved once the connection is back and synced (e.g. after a server restart)", () => {
    expect(view({ status: "connected", synced: true, connectingSince: base.now - 60_000 })).toMatchObject({ label: "Saved" });
  });

  it("reports a rejected connection as no access", () => {
    expect(view({ status: "denied" })).toMatchObject({ tone: "bad", label: "Can't open" });
  });
});
