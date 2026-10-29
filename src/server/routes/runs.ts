import { Hono } from "hono";
import { getRun } from "../db.ts";
import type { Services } from "../services.ts";
import type { AppEnv } from "../session.ts";

export function createRunRoutes(s: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/api/runs/:id", (c) => {
    const run = getRun(s.db, c.get("ctx").workspaceId, c.req.param("id"));
    return run ? c.json(run) : c.json({ error: "run not found" }, 404);
  });
  app.post("/api/runs/:id/cancel", async (c) => {
    const run = await s.runtime.cancel(c.get("ctx").workspaceId, c.req.param("id"));
    return run ? c.json(run) : c.json({ error: "run not found" }, 404);
  });
  return app;
}
