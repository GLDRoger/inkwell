import { tool } from "ai";
import { z } from "zod";
import type { Agent, Run, ServerEvent } from "../../shared/types.ts";
import { appendRunStep, getRun, updateRun } from "../db.ts";
import { PageStoreError } from "../pages.ts";
import type { Services } from "../services.ts";

export type AgentServices = Pick<Services, "db" | "pages" | "collab" | "bus" | "uploadsDir">;
export class ToolFailure extends Error {}

export interface ToolContext {
  services: AgentServices;
  workspaceId: string;
  run: Run;
  agent: Agent;
  presenceId: string;
  signal: AbortSignal;
  touched: Set<string>;
  budget: { remaining: number };
  withPageLock: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  askAgent: (name: string, request: string) => Promise<string>;
}

/** Tool calls in one model turn can be parallel. Serialize their movement and edits. */
export function createAgentTools(ctx: ToolContext) {
  const { services: s, workspaceId: ws, run, agent } = ctx;
  const actor = { kind: "agent" as const, id: agent.id, name: agent.name };
  let pending: Promise<unknown> = Promise.resolve();
  const check = () => ctx.signal.throwIfAborted();
  const publish = (event: ServerEvent) => s.bus.publish(ws, event);
  const page = (id: string) => {
    const found = s.pages.getPage(ws, id);
    if (!found) throw new ToolFailure("Page not found.");
    return found;
  };
  const move = async (id: string | null, action: "reading" | "writing" | "thinking") => {
    check();
    const from = getRun(s.db, ws, run.id)?.pageId ?? null;
    if (from && from !== id) await s.collab.hideAgent(from, ctx.presenceId);
    check();
    // Notebook-wide tools change the action, not the last physical stop.
    const updated = updateRun(s.db, ws, run.id, { pageId: id ?? from });
    if (updated) publish({ type: "run.updated", run: updated });
    publish({ type: "agent.moved", runId: run.id, agentId: agent.id, fromPageId: from, toPageId: id, action });
    if (id) {
      ctx.touched.add(id);
      if (action === "writing") {
        await s.collab.showAgent(id, ws, { ...agent, id: ctx.presenceId });
        check();
      }
    }
  };
  type Outcome = { text: string; summary: string; pageId?: string };
  const define = <S extends z.ZodType>(name: string, description: string, schema: S,
    fn: (input: z.output<S>) => Promise<Outcome>) => tool({
    description,
    inputSchema: schema,
    execute: async (input) => {
      const task = pending.then(async () => {
        let outcome: Outcome;
        let ok = true;
        try {
          check();
          if (ctx.budget.remaining-- <= 0) throw new ToolFailure("Tool budget reached. Summarise what you have done.");
          outcome = await fn(input as z.output<S>);
        } catch (error) {
          ok = false;
          const message = ctx.signal.aborted ? "Run stopped." :
            error instanceof ToolFailure || error instanceof PageStoreError ? error.message :
            "The tool couldn't complete. Try reading the page again.";
          outcome = { text: `Error: ${message}`, summary: `${name.replaceAll("_", " ")}: ${message}` };
          if (!ctx.signal.aborted) {
            const currentPage = getRun(s.db, ws, run.id)?.pageId ?? null;
            publish({ type: "agent.moved", runId: run.id, agentId: agent.id,
              fromPageId: currentPage, toPageId: currentPage, action: "thinking" });
          }
        }
        if (!ctx.signal.aborted) {
          const updated = appendRunStep(s.db, ws, run.id, {
            tool: name, summary: outcome.summary, pageId: outcome.pageId ?? null, ok,
          });
          if (updated) publish({ type: "run.updated", run: updated });
        }
        return outcome.text;
      });
      pending = task;
      return task;
    },
  });
  const id = z.string().min(1).max(200);
  const markdown = z.string().max(200_000);
  const write = async (pageId: string, fn: () => Promise<Outcome>) => ctx.withPageLock(pageId, async () => {
    check();
    page(pageId);
    await move(pageId, "writing");
    check();
    return fn();
  });
  const replace = async (pageId: string, body: string) => {
    check();
    if (!await s.collab.replaceMarkdown(pageId, ws, body, actor)) throw new ToolFailure("Page not found.");
    // The write's actor is the actual agent; presence is run-specific so concurrent
    // runs of the same agent cannot remove each other's carets.
    if (!ctx.signal.aborted) await s.collab.showAgent(pageId, ws, { ...agent, id: ctx.presenceId });
  };

  const tools = {
    list_pages: define("list_pages", "List the notebook tree (id, title, parentId).", z.object({}), async () => {
      await move(null, "thinking");
      const pages = s.pages.listPages(ws).map(({ id, title, parentId }) => ({ id, title, parentId }));
      return { text: JSON.stringify(pages), summary: `Listed ${pages.length} pages` };
    }),
    read_page: define("read_page", "Read live markdown. Continue with nextOffset when present (character offsets).",
      z.object({ pageId: id, offset: z.number().int().min(0).default(0) }), async ({ pageId, offset }) => {
        const target = page(pageId);
        await move(pageId, "reading");
        const body = await s.collab.readPageMarkdown(pageId, ws);
        if (body === null) throw new ToolFailure("Page not found.");
        const end = Math.min(body.length, offset + 16_000);
        return { text: JSON.stringify({ id: pageId, title: target.title, markdown: body.slice(offset, end),
          nextOffset: end < body.length ? end : null, totalCharacters: body.length }), summary: `Read ${target.title}`, pageId };
      }),
    search_pages: define("search_pages", "Search notebook titles and content.", z.object({ query: z.string().min(1).max(500) }), async ({ query }) => {
      await move(null, "thinking");
      const results = s.pages.searchPages(ws, query).slice(0, 30);
      return { text: JSON.stringify(results.map(({ page, snippet }) => ({ id: page.id, title: page.title, snippet }))), summary: `Searched for ${query}` };
    }),
    create_page: define("create_page", "Create a page, optionally nested under a parent.",
      z.object({ title: z.string().min(1).max(500), markdown: markdown.optional(), parentId: id.nullable().optional() }),
      async ({ title, markdown: body, parentId }) => {
        check();
        if (parentId) page(parentId);
        const created = s.pages.createPage(ws, actor, { title, parentId });
        ctx.touched.add(created.id);
        await write(created.id, async () => {
          if (body) await replace(created.id, body);
          return { text: "", summary: "" };
        });
        return { text: `Created [${title}](/p/${created.id}) (id: ${created.id}).`, summary: `Created ${title}`, pageId: created.id };
      }),
    append_to_page: define("append_to_page", "Append markdown to a page without replacing existing content.",
      z.object({ pageId: id, markdown }), ({ pageId, markdown: body }) => write(pageId, async () => {
        if (!await s.collab.appendMarkdown(pageId, ws, body, actor)) throw new ToolFailure("Page not found.");
        if (!ctx.signal.aborted) await s.collab.showAgent(pageId, ws, { ...agent, id: ctx.presenceId });
        return { text: "Appended markdown.", summary: `Added to ${page(pageId).title}`, pageId };
      })),
    edit_page: define("edit_page", "Replace one exact, unique substring. Read first; ambiguous matches are rejected.",
      z.object({ pageId: id, find: z.string().min(1).max(200_000), replace: markdown }),
      ({ pageId, find, replace: replacement }) => write(pageId, async () => {
        const body = await s.collab.readPageMarkdown(pageId, ws);
        if (body === null) throw new ToolFailure("Page not found.");
        const at = body.indexOf(find);
        if (at < 0) throw new ToolFailure("Text not found. Read the page and try again.");
        if (body.indexOf(find, at + 1) >= 0) throw new ToolFailure("Text matches more than once. Include more context.");
        await replace(pageId, body.slice(0, at) + replacement + body.slice(at + find.length));
        return { text: "Replaced the matching text.", summary: `Edited ${page(pageId).title}`, pageId };
      })),
    rewrite_page: define("rewrite_page", "Replace the page's full markdown. Prefer edit_page for small changes; read first.",
      z.object({ pageId: id, markdown }), ({ pageId, markdown: body }) => write(pageId, async () => {
        await replace(pageId, body);
        const paragraphs = body.split(/\n\s*\n/).filter(Boolean).length;
        return { text: "Updated page markdown.", summary: `Wrote ${paragraphs} paragraphs on ${page(pageId).title}`, pageId };
      })),
    rename_page: define("rename_page", "Change a page title.", z.object({ pageId: id, title: z.string().min(1).max(500) }),
      ({ pageId, title }) => write(pageId, async () => {
        s.pages.updatePage(ws, actor, pageId, { title });
        return { text: `Renamed to ${title}.`, summary: `Renamed ${title}`, pageId };
      })),
    move_page: define("move_page", "Move a page under a parent (null = notebook root).",
      z.object({ pageId: id, parentId: id.nullable() }), ({ pageId, parentId }) => write(pageId, async () => {
        if (parentId) page(parentId);
        s.pages.updatePage(ws, actor, pageId, { parentId });
        return { text: "Moved page.", summary: `Moved ${page(pageId).title}`, pageId };
      })),
    delete_page: define("delete_page", "Soft-delete a page and its descendants only when the person explicitly requests deletion.",
      z.object({ pageId: id }), ({ pageId }) => write(pageId, async () => {
        const title = page(pageId).title;
        const descendants = s.pages.getDescendantIds(ws, pageId);
        s.pages.deletePage(ws, pageId);
        descendants.forEach((id) => ctx.touched.add(id));
        return { text: `Soft-deleted ${title} and ${descendants.length} child pages.`, summary: `Deleted ${title}`, pageId };
      })),
    ask_agent: define("ask_agent", "Ask another notebook agent to do a focused task; wait for their reply.",
      z.object({ agentName: z.string().min(1).max(120), request: z.string().min(1).max(20_000) }), async ({ agentName, request }) => {
        await move(null, "thinking");
        return { text: await ctx.askAgent(agentName, request), summary: `Asked ${agentName} for help` };
      }),
  };
  return { tools, drain: () => pending };
}
