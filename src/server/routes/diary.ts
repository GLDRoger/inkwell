import { Hono } from "hono";
import { z } from "zod";
import {
  deleteDiaryEntry, getAgent, getAttachments, getDiaryThread, insertDiaryEntry, insertDiaryThread, listAgents,
} from "../db.ts";
import { ToolFailure } from "../agents/errors.ts";
import { pickAgent } from "../agents/route.ts";
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
    const agent = body.agentId ? getAgent(s.db, ws, body.agentId) : pickAgent(listAgents(s.db, ws), body.text);
    if (!agent) return c.json({ error: "That agent isn't in this notebook any more. Pick another one.", code: "agent_not_found" }, 404);
    if (body.threadId && !getDiaryThread(s.db, ws, body.threadId)) return c.json({ error: "That conversation no longer exists. Start a new one.", code: "thread_not_found" }, 404);
    if (body.pageId && !s.pages.getPage(ws, body.pageId)) return c.json({ error: "The open page was deleted. Close it and try again.", code: "page_not_found" }, 404);
    const attachmentIds = [...new Set(body.attachmentIds)];
    const attachments = getAttachments(s.db, ws, attachmentIds);
    if (attachments.length !== attachmentIds.length) return c.json({ error: "An attachment is missing. Attach it again.", code: "attachment_not_found" }, 404);
    const { entry, threadId } = s.db.transaction(() => {
      const threadId = body.threadId ?? insertDiaryThread(s.db, ws, body.text.slice(0, 80)).id;
      const entry = insertDiaryEntry(s.db, ws, { threadId, role: "person", text: body.text,
        attachments, pageIds: body.pageId ? [body.pageId] : [] });
      return { entry, threadId };
    })();
    let runId: string;
    try {
      runId = s.runtime.start({ workspaceId: ws, agentId: agent.id, threadId, prompt: body.text, pageId: body.pageId }).run.id;
    } catch (error) {
      // Nothing was answered, so keep nothing: a retry must not duplicate the entry.
      deleteDiaryEntry(s.db, ws, entry.id, threadId);
      if (s.runtime.isClosing) return c.json({ error: "Inkwell is restarting. Try again in a moment.", code: "restarting" }, 503);
      if (error instanceof ToolFailure) return c.json({ error: `The agent couldn't start: ${error.message}`, code: "agent_unavailable" }, 400);
      console.error("[inkwell] agent run failed to start", error);
      return c.json({ error: "Something went wrong starting the agent. Try again.", code: "internal" }, 500);
    }
    // Announced only once the run exists; the agent's reply placeholder may arrive first (clients sort by time).
    s.bus.publish(ws, { type: "diary.entry", entry });
    return c.json({ entry, runId, threadId }, 201);
  });
  return app;
}
