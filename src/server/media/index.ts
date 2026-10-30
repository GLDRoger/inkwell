import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../session.ts";
import type { Services } from "../services.ts";
import { createMetaClient, record, type MetaOptions } from "./meta.ts";
import { transcribe } from "./transcribe.ts";
import { illustratePage } from "./illustrate.ts";
import { importPhoto } from "./photo.ts";

/** Mount behind the app's session middleware. Options only customize the Meta transport. */
export function createMediaRoutes(services: Services, options: MetaOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const meta = createMetaClient(options);
  app.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
    // Do not log raw upstream errors: they can contain tokens or image data.
    return c.json({ error: "Something went wrong processing that file. Try again." }, 500);
  });
  app.post("/api/transcribe", bodyLimit({
    maxSize: 32 * 1024 * 1024,
    onError: (c) => c.json({ error: "Audio request exceeds the 32 MB limit" }, 413),
  }), async (c) => {
    meta.requireKey();
    let audio: unknown;
    try { audio = (await c.req.parseBody()).audio; }
    catch { return c.json({ error: "The request didn't include any audio." }, 400); }
    if (!(audio instanceof File)) return c.json({ error: "The request didn't include any audio." }, 400);
    return c.json(await transcribe(audio, meta));
  });
  app.post("/api/pages/:id/illustrate", async (c) =>
    c.json(await illustratePage(services, c.get("ctx"), c.req.param("id"), meta)));
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
    return c.json(await importPhoto(services, c.get("ctx"), body.attachmentId, meta));
  });
  return app;
}
