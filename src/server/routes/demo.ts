import { Hono } from "hono";
import { z } from "zod";
import type { Me } from "../../shared/types.ts";
import { DemoUnavailable } from "../demo/player.ts";
import { serverMetaKey, visitorKey } from "../meta-access.ts";
import type { Services } from "../services.ts";
import type { AppEnv } from "../session.ts";

const startBody = z.object({ scenario: z.string().max(64).optional() }).optional();

/** How long a key check may take before we give up on Meta. */
const KEY_CHECK_TIMEOUT_MS = 10_000;

/**
 * GET /api/me, the visitor's key check and demo playback (docs/DEMO-MODE.md).
 * Mount behind the session middleware.
 */
export function createDemoRoutes(s: Services, options: { fetch?: typeof globalThis.fetch } = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/api/me", (c) => {
    const ctx = c.get("ctx");
    // Always the visitor's own notebook; the demo notebook is named separately.
    const me: Me = {
      workspaceId: ctx.ownWorkspaceId ?? ctx.workspaceId,
      person: ctx.person,
      metaConnected: Boolean(serverMetaKey()),
      demoWorkspaceId: ctx.demoWorkspaceId ?? null,
    };
    return c.json(me);
  });

  app.post("/api/key/check", async (c) => {
    const key = visitorKey(c.req.header("x-meta-key"));
    if (!key) return c.json({ ok: false, error: "Paste your Meta API key first." });
    const base = (process.env.META_BASE_URL ?? "https://api.meta.ai/v1").replace(/\/+$/, "");
    try {
      // Listing models is authenticated and free. The key is sent once and dropped.
      const response = await (options.fetch ?? globalThis.fetch)(`${base}/models`, {
        headers: { Authorization: `Bearer ${key}` }, redirect: "error", signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
      });
      await response.body?.cancel();
      if (response.ok) return c.json({ ok: true });
      if (response.status === 401 || response.status === 403) return c.json({ ok: false, error: "Meta didn't accept that key. Check it and try again." });
      return c.json({ ok: false, error: `Meta couldn't check the key right now (HTTP ${response.status}). Try again in a moment.` });
    } catch {
      // Never surface fetch errors: they can carry request details.
      return c.json({ ok: false, error: "Couldn't reach Meta to check the key. Try again in a moment." });
    }
  });

  app.get("/api/demo", (c) => c.json(s.demo.state(c.get("ctx").demoWorkspaceId)));

  app.post("/api/demo/start", async (c) => {
    let raw: unknown;
    try { raw = c.req.header("content-type")?.includes("json") ? await c.req.json() : undefined; }
    catch { return c.json({ error: "The request wasn't valid JSON." }, 400); }
    const body = startBody.safeParse(raw);
    if (!body.success) return c.json({ error: "Unknown demo." }, 400);
    try {
      return c.json(await s.demo.start(c.get("ctx"), body.data?.scenario));
    } catch (error) {
      if (error instanceof DemoUnavailable) return c.json({ error: error.message, code: "demo_unavailable" }, 503);
      throw error;
    }
  });

  app.post("/api/demo/stop", async (c) => {
    await s.demo.stop(c.get("ctx").demoWorkspaceId);
    return c.body(null, 204);
  });

  return app;
}
