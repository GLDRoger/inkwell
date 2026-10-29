import { Hono } from "hono";
import { z } from "zod";
import {
  getAgent, getAttachments, getDiaryThread, insertDiaryEntry, insertDiaryThread, listAgents,
} from "../db.ts";
import type { Services } from "../services.ts";
import type { AppEnv } from "../session.ts";
import { parseJsonBody } from "./pages.ts";

const bodySchema = z.object({
  threadId: z.string().min(1).max(200).optional(),
  text: z.string().trim().min(1).max(20_000),
  agentId: z.string().min(1).max(200).optional(),
  attachmentIds: z.array(z.string().min(1).max(200)).max(10).default([]),
  pageId: z.string().min(1).max(200).optional(),
});

export function createDiaryRoutes(s: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  // GET routes already live in routes/map.ts.
  app.post("/api/diary", async (c) => {
    const parsed = await parseJsonBody(c, bodySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const { workspaceId: ws } = c.get("ctx");
    const agent = body.agentId ? getAgent(s.db, ws, body.agentId) : listAgents(s.db, ws)[0];
    if (!agent) return c.json({ error: "agent not found" }, 404);
    if (body.threadId && !getDiaryThread(s.db, ws, body.threadId)) return c.json({ error: "diary thread not found" }, 404);
    if (body.pageId && !s.pages.getPage(ws, body.pageId)) return c.json({ error: "page not found" }, 404);
    const attachmentIds = [...new Set(body.attachmentIds)];
    const attachments = getAttachments(s.db, ws, attachmentIds);
    if (attachments.length !== attachmentIds.length) return c.json({ error: "attachment not found" }, 404);
    const { entry, threadId } = s.db.transaction(() => {
      const threadId = body.threadId ?? insertDiaryThread(s.db, ws, body.text.slice(0, 80)).id;
      const entry = insertDiaryEntry(s.db, ws, { threadId, role: "person", text: body.text,
        attachments, pageIds: body.pageId ? [body.pageId] : [] });
      return { entry, threadId };
    })();
    s.bus.publish(ws, { type: "diary.entry", entry });
    const { run } = s.runtime.start({ workspaceId: ws, agentId: agent.id, threadId, prompt: body.text, pageId: body.pageId });
    return c.json({ entry, runId: run.id, threadId }, 201);
  });
  return app;
}
