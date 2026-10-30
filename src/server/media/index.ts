import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../session.ts";
import type { Services } from "../services.ts";
import { createMetaClient, record, type MetaOptions } from "./meta.ts";
import { transcribe } from "./transcribe.ts";
import { illustratePage } from "./illustrate.ts";
import { importPhoto } from "./photo.ts";
import { NOT_CONNECTED, pickTextModel, serverMetaKey, visitorKey } from "../meta-access.ts";

/**
 * Mount behind the app's session middleware. Options only customize the Meta transport;
 * options.apiKey stands in for the server's own key. A visitor's X-Meta-Key wins and is
 * used for that request only (docs/DEMO-MODE.md).
 */
export function createMediaRoutes(services: Services, options: MetaOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const access = (c: Context<AppEnv>) => {
    const apiKey = visitorKey(c.req.header("x-meta-key")) ?? (options.apiKey !== undefined ? options.apiKey.trim() : serverMetaKey());
    if (!apiKey) return null;
    return { meta: createMetaClient({ ...options, apiKey }), model: pickTextModel(c.req.header("x-meta-model")) };
  };
  app.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
    // Do not log raw upstream errors: they can contain tokens or image data.
    return c.json({ error: "Something went wrong processing that file. Try again." }, 500);
  });
  app.post("/api/transcribe", bodyLimit({
    maxSize: 32 * 1024 * 1024,
    onError: (c) => c.json({ error: "Audio request exceeds the 32 MB limit" }, 413),
  }), async (c) => {
    const ai = access(c);
    if (!ai) return c.json(NOT_CONNECTED, 503);
    let audio: unknown;
    try { audio = (await c.req.parseBody()).audio; }
    catch { return c.json({ error: "The request didn't include any audio." }, 400); }
    if (!(audio instanceof File)) return c.json({ error: "The request didn't include any audio." }, 400);
    return c.json(await transcribe(audio, ai.meta));
  });
  app.post("/api/pages/:id/illustrate", async (c) => {
    const ai = access(c);
    if (!ai) {
      // A missing page is still a 404, whoever's key it would have been.
      if (!services.pages.getPage(c.get("ctx").workspaceId, c.req.param("id"))) return c.json({ error: "page not found" }, 404);
      return c.json(NOT_CONNECTED, 503);
    }
    return c.json(await illustratePage(services, c.get("ctx"), c.req.param("id"), ai.meta));
  });
  app.post("/api/import/photo", bodyLimit({
    maxSize: 4096,
    onError: (c) => c.json({ error: "Photo import request is too large" }, 413),
  }), async (c) => {
    let body: Record<string, unknown>;
    try { body = record(await c.req.json()); }
    catch { return c.json({ error: "Choose a photo to import." }, 400); }
    if (typeof body.attachmentId !== "string" || !body.attachmentId.trim()) {
      return c.json({ error: "Choose a photo to import." }, 400);
    }
    const ai = access(c);
    if (!ai) return c.json(NOT_CONNECTED, 503);
    return c.json(await importPhoto(services, c.get("ctx"), body.attachmentId, ai.meta, ai.model));
  });
  return app;
}
