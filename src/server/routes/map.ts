import { Hono } from "hono";
import { z } from "zod";
import type { MapGraph } from "../../shared/types.ts";
import type { AppEnv } from "../session.ts";
import type { Services } from "../services.ts";
import {
  getDiaryThread,
  insertAgent,
  listAgents,
  listDiaryEntries,
  listDiaryThreads,
  listRecentRuns,
} from "../db.ts";
import { parseJsonBody } from "./pages.ts";

const createAgentBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).default(""),
  instructions: z.string().max(20_000).default(""),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "color must be a hex colour like #7a2e1d")
    .default("#7a2e1d"),
  model: z.string().max(120).optional(),
});

export function createMapRoutes(services: Services): Hono<AppEnv> {
  const { db, pages } = services;
  const app = new Hono<AppEnv>();

  app.get("/api/map", (c) => {
    const { workspaceId } = c.get("ctx");
    const graph: MapGraph = {
      pages: pages.listPages(workspaceId),
      links: pages.listLinks(workspaceId),
      agents: listAgents(db, workspaceId),
      runs: listRecentRuns(db, workspaceId),
    };
    return c.json(graph);
  });

  app.get("/api/agents", (c) => {
    return c.json(listAgents(db, c.get("ctx").workspaceId));
  });

  app.post("/api/agents", async (c) => {
    const { workspaceId } = c.get("ctx");
    const body = await parseJsonBody(c, createAgentBody);
    if (!body.ok) return body.response;
    const agent = insertAgent(db, workspaceId, body.data);
    return c.json(agent, 201);
  });

  app.get("/api/diary", (c) => {
    return c.json(listDiaryThreads(db, c.get("ctx").workspaceId));
  });

  app.get("/api/diary/:threadId", (c) => {
    const { workspaceId } = c.get("ctx");
    const threadId = c.req.param("threadId");
    if (!getDiaryThread(db, workspaceId, threadId)) {
      return c.json({ error: "diary thread not found" }, 404);
    }
    return c.json(listDiaryEntries(db, workspaceId, threadId));
  });

  return app;
}
