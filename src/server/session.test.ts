// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServices, type Services } from "./services.ts";
import { createSessionMiddleware, type AppEnv } from "./session.ts";

let services: Services;
let app: Hono<AppEnv>;
let dir: string;
const env = (ip = "192.0.2.1") => ({ incoming: { socket: { remoteAddress: ip } } });
const count = () => (services.db.prepare("SELECT count(*) AS n FROM workspaces").get() as { n: number }).n;
const request = (url = "/api/me", headers: Record<string, string> = {}, ip?: string, method = "GET") =>
  app.request(url, { headers, method }, env(ip));

beforeEach(() => {
  vi.stubEnv("TRUST_PROXY", "0");
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "inkwell-session-"));
  services = createServices(dir);
  app = new Hono<AppEnv>();
  app.use("/api/*", createSessionMiddleware(services));
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.all("/api/*", (c) => c.json(c.get("ctx")));
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await services.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("anonymous session bootstrap", () => {
  it("only GET /api/me creates a workspace, including parallel first requests", async () => {
    const results = await Promise.all(["/api/me", "/api/map", "/api/events", "/api/pages", "/api/missing"].map((url) => request(url)));
    expect(results.map((r) => r.status)).toEqual([200, 401, 401, 401, 401]);
    expect(count()).toBe(1);
    for (const response of results.slice(1)) {
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.json()).toEqual({ error: "session required; open /api/me first" });
    }
    for (const method of ["POST", "HEAD", "OPTIONS"]) {
      expect((await request("/api/me", {}, undefined, method)).status).toBe(401);
    }
    expect(count()).toBe(1);
  });

  it("health probes never create sessions", async () => {
    const response = await request("/api/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(count()).toBe(0);
  });

  it("resumes cookies, rejects invalid ones outside bootstrap, and never shares sessions by IP/UA", async () => {
    const headers = { "User-Agent": "Same browser" };
    const a = await request("/api/me", headers);
    const b = await request("/api/me", headers);
    const sessionA = await a.json() as { workspaceId: string };
    expect((await b.json() as { workspaceId: string }).workspaceId).not.toBe(sessionA.workspaceId);
    const cookie = a.headers.get("set-cookie")!.split(";")[0]!;
    const resumed = await request("/api/map", { Cookie: cookie });
    expect(await resumed.json()).toEqual(sessionA);
    expect(resumed.headers.get("set-cookie")).toBeNull();
    expect((await request("/api/map", { Cookie: "inkwell_sid=invalid" })).status).toBe(401);
    expect(count()).toBe(2);
  });

  it("caps creation at 30/IP/hour, not existing sessions, and expires the bucket", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const first = await request();
    const cookie = first.headers.get("set-cookie")!.split(";")[0]!;
    for (let i = 1; i < 30; i++) expect((await request()).status).toBe(200);
    const denied = await request();
    expect(denied.status).toBe(429);
    expect(await denied.json()).toEqual({ error: "too many new workspaces; try again later" });
    expect(denied.headers.get("retry-after")).toBe("3600");
    expect(denied.headers.get("set-cookie")).toBeNull();
    expect(count()).toBe(30);
    expect((await request("/api/map", { Cookie: cookie })).status).toBe(200);
    expect((await request("/api/me", {}, "192.0.2.2")).status).toBe(200);
    vi.mocked(Date.now).mockReturnValue(1_000_000 + 3_600_000);
    expect((await request()).status).toBe(200);
    vi.restoreAllMocks();
  });

  it("ignores spoofed forwarding headers unless proxy trust is enabled", async () => {
    for (let i = 0; i < 30; i++) {
      expect((await request("/api/me", { "X-Forwarded-For": `198.51.100.${i}` })).status).toBe(200);
    }
    expect((await request("/api/me", { "X-Forwarded-For": "203.0.113.1" })).status).toBe(429);
  });

  it("uses the nearest forwarded IP only with TRUST_PROXY=1", async () => {
    vi.stubEnv("TRUST_PROXY", "1");
    // The leftmost entries are client-controlled when a single proxy appends its peer.
    for (let i = 0; i < 30; i++) {
      expect((await request("/api/me", { "X-Forwarded-For": `198.51.100.${i}, 203.0.113.1` })).status).toBe(200);
    }
    expect((await request("/api/me", { "X-Forwarded-For": "198.51.100.250, 203.0.113.1" })).status).toBe(429);
    expect((await request("/api/me", { "X-Forwarded-For": "203.0.113.2" })).status).toBe(200);
  });

  it.each([
    ["http://localhost/api/me", "0", undefined, false],
    ["https://localhost/api/me", "0", undefined, true],
    ["http://localhost/api/me", "0", "https", false],
    ["http://localhost/api/me", "1", "https", true],
    ["https://localhost/api/me", "0", "http", true],
  ])("cookie security for %s trust=%s forwarded=%s", async (url, trust, proto, secure) => {
    vi.stubEnv("TRUST_PROXY", trust);
    const response = await request(url, proto ? { "X-Forwarded-Proto": proto } : {});
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=31536000");
    expect(cookie).toContain("Path=/");
    expect(cookie.includes("Secure")).toBe(secure);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
