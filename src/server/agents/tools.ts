import { listWidgets, liveWidgetData, newWidget, saveWidget, deleteWidget, saveLens, widgetPosition, widgetValue } from "../widgets.ts";
import type { WidgetData } from "../../shared/types.ts";
import { tool } from "ai";
import { z } from "zod";
import type { Agent, Run, ServerEvent } from "../../shared/types.ts";
import { appendRunStep, getRun, updateRun, newId, nowIso } from "../db.ts";
import { appendJSONToYDoc, markdownToTiptapJSON } from "../editor-schema.ts";
import { PageStoreError } from "../pages.ts";
import type { Services } from "../services.ts";
import { ToolFailure } from "./errors.ts";
import { pickIcon } from "./icons.ts";
import { stripTitleHeading } from "./links.ts";
import { applyFind, applyRewrite, pageVersion, readView } from "./page-edit.ts";

export { ToolFailure } from "./errors.ts";
export type AgentServices = Pick<Services, "db" | "pages" | "collab" | "bus" | "uploadsDir">;

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

export const PAGE_NOT_FOUND = "Page not found. Get the id from search_pages or list_pages.";

/** A markdown link the model can paste into its reply. */
export const pageLink = (title: string, id: string) =>
  `[${(title || "Untitled").replace(/[[\]]/g, "\\$&")}](/p/${id})`;

/**
 * Tool calls in one model turn can be parallel. Movement and edits are
 * serialized in call order; ask_agent runs alongside them (the other agent's
 * writes still queue on the per-page locks).
 */
export function createAgentTools(ctx: ToolContext) {
  const { services: s, workspaceId: ws, run, agent } = ctx;
  const actor = { kind: "agent" as const, id: agent.id, name: agent.name };
  let pending: Promise<unknown> = Promise.resolve();
  const inFlight = new Set<Promise<unknown>>();
  const check = () => ctx.signal.throwIfAborted();
  const publish = (event: ServerEvent) => s.bus.publish(ws, event);
  const page = (id: string) => {
    const found = s.pages.getPage(ws, id);
    if (!found) throw new ToolFailure(PAGE_NOT_FOUND);
    return found;
  };
  const move = async (id: string | null, action: "reading" | "writing" | "thinking") => {
    check();
    const from = getRun(s.db, ws, run.id)?.pageId ?? null;
    if (from && from !== id) await s.collab.hideAgent(from, ctx.presenceId);
    check();
    // Notebook-wide tools change the action, not the last physical stop:
    // toPageId null means "stays at fromPageId".
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
    fn: (input: z.output<S>) => Promise<Outcome>, options: { concurrent?: boolean } = {}) => tool({
    description,
    inputSchema: schema,
    execute: async (input) => {
      const body = async () => {
        let outcome: Outcome;
        let ok = true;
        try {
          check();
          if (ctx.budget.remaining-- <= 0) throw new ToolFailure("Tool budget reached. Stop calling tools and reply with what you have done.");
          outcome = await fn(input as z.output<S>);
        } catch (error) {
          ok = false;
          const message = ctx.signal.aborted ? "Run stopped." :
            error instanceof ToolFailure || error instanceof PageStoreError ? error.message :
            "The tool couldn't complete. Read the page again, then retry.";
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
      };
      const task = options.concurrent ? body() : pending.then(body);
      if (!options.concurrent) pending = task;
      inFlight.add(task);
      try { return await task; } finally { inFlight.delete(task); }
    },
  });
  const id = z.string().min(1).max(200);
  /** Muse Wonder sometimes sends the string "null" (or "") for "no parent". */
  const parentRef = z.preprocess((v) => (v === "null" || v === "" ? null : v), id.nullable());
  const markdown = z.string().max(200_000);
  const version = z.string().min(1).max(100)
    .describe("The version from your latest read_page of this page, or from your last write to it.");
  const write = async (pageId: string, fn: () => Promise<Outcome>) => ctx.withPageLock(pageId, async () => {
    check();
    page(pageId);
    await move(pageId, "writing");
    check();
    return fn();
  });
  const showCaret = async (pageId: string) => {
    // The write's actor is the actual agent; presence is run-specific so concurrent
    // runs of the same agent cannot remove each other's carets.
    if (!ctx.signal.aborted) await s.collab.showAgent(pageId, ws, { ...agent, id: ctx.presenceId });
  };
  const edit = async (pageId: string, fn: Parameters<typeof s.collab.editPage>[2]) => {
    check();
    const written = await s.collab.editPage(pageId, ws, fn, actor);
    if (!written) throw new ToolFailure(PAGE_NOT_FOUND);
    await showCaret(pageId);
    return readView(written).version;
  };

  const tools = {
    list_pages: define("list_pages", "List every page: id, title, a markdown link to paste into replies, parentId and a short excerpt.", z.object({}), async () => {
      await move(null, "thinking");
      const pages = s.pages.listPages(ws).map(({ id, title, parentId, excerpt }) => ({
        id, title, link: pageLink(title, id), parentId, excerpt: excerpt.replace(/\s+/g, " ").slice(0, 120),
      }));
      const widgets = listWidgets(s.db, ws);
      return { text: JSON.stringify(pages) + (widgets.length ? `\nCurrent widgets: ${JSON.stringify(widgets.map(w => ({ id: w.id, kind: w.data.kind, title: w.title })))}` : ""), summary: `Listed ${pages.length} pages` };
    }),
    show_lens: define("show_lens", "Rearrange the map to answer a question about several pages. Get page ids from list_pages. Each page can belong to only one group. Does not change saved card positions.",
      z.object({ title: z.string().trim().min(1).max(500), kind: z.enum(["columns", "timeline"]), groups: z.array(z.object({ label: z.string().min(1).max(120), pageIds: z.array(id).max(200), note: z.string().max(300).optional() })).min(1).max(6) }),
      async ({ title, kind, groups }) => {
        const seen = new Set<string>();
        for (const group of groups) for (const pageId of group.pageIds) {
          page(pageId);
          if (seen.has(pageId)) throw new ToolFailure("Each page can appear in only one lens group. Get ids from list_pages.");
          seen.add(pageId);
        }
        await move(null, "thinking");
        saveLens(s.db, s.bus, ws, { id: newId(), title, kind, groups, agentId: agent.id, runId: run.id, createdAt: nowIso() });
        return { text: `Showed "${title}" on the map.`, summary: `Showed "${title}"` };
      }),
    create_widget: define("create_widget", "Place a live progress, money total, countdown or facts widget on the map. Same kind and title replaces the existing widget in place. Progress and total recompute from source pages as people edit. Currency defaults to €; use €, $ or £. Get source page ids from list_pages, not from memory.",
      z.object({ kind: z.enum(["progress", "total", "countdown", "facts"]), title: z.string().trim().min(1).max(500), pageIds: z.array(id).max(200).default([]), date: z.string().max(200).optional(), label: z.string().max(300).optional(), currency: z.enum(["€", "$", "£"]).default("€"), items: z.array(z.object({ label: z.string().min(1).max(120), value: z.string().min(1).max(500) })).min(1).max(8).optional() }),
      async ({ kind, title, pageIds: ids, date, label, currency, items }) => {
        const pageIds = [...new Set(ids)];
        const sources = pageIds.map(page);
        if ((kind === "progress" || kind === "total") && !pageIds.length) throw new ToolFailure("Progress and total widgets need at least one source page. Get ids from list_pages.");
        if (kind === "countdown" && (!date || !Number.isFinite(Date.parse(date)))) throw new ToolFailure("A countdown needs a parseable date, such as 2026-12-04.");
        if (kind === "facts" && !items?.length) throw new ToolFailure("A facts widget needs 1 to 8 label/value items.");
        if (pageIds[0]) await move(pageIds[0], "reading");
        const initial: WidgetData = kind === "progress" ? { kind, done: 0, total: 0, perPage: [] }
          : kind === "total" ? { kind, currency, amount: 0, lines: [] }
          : kind === "countdown" ? { kind, date: date!, label: label ?? title }
          : { kind, items: items! };
        const data = await liveWidgetData(s.collab, ws, initial, pageIds);
        await move(null, "thinking");
        const widgets = listWidgets(s.db, ws);
        const existing = widgets.find(w => w.title === title && w.data.kind === kind);
        const widget = existing ? { ...existing, pageIds, data, createdBy: actor, updatedAt: nowIso() }
          : newWidget(actor, title, pageIds, data, widgetPosition(sources, widgets));
        saveWidget(s.db, s.bus, ws, widget);
        return { text: `${widgetValue(widget)} (widget id: ${widget.id}).`, summary: `Added "${title}" widget` };
      }),
    remove_widget: define("remove_widget", "Remove a map widget. Find its id in the trailing widgets note from list_pages.", z.object({ widgetId: id }), async ({ widgetId }) => {
      await move(null, "thinking");
      if (!deleteWidget(s.db, s.bus, ws, widgetId)) throw new ToolFailure("Widget not found. Get its id from list_pages.");
      return { text: "Removed widget.", summary: "Removed widget" };
    }),
    read_page: define("read_page", "Read a page's live markdown and its version. Pass the version to edit_page or rewrite_page. Continue long pages with nextOffset (a character offset).",
      z.object({ pageId: id, offset: z.number().int().min(0).default(0) }), async ({ pageId, offset }) => {
        const target = page(pageId);
        await move(pageId, "reading");
        const json = await s.collab.getPageJSON(pageId, ws);
        if (json === null) throw new ToolFailure(PAGE_NOT_FOUND);
        const view = readView(json);
        const body = view.markdown;
        const end = Math.min(body.length, offset + 16_000);
        return { text: JSON.stringify({ id: pageId, title: target.title, link: pageLink(target.title, pageId), version: view.version,
          markdown: body.slice(offset, end), nextOffset: end < body.length ? end : null, totalCharacters: body.length }),
        summary: `Read ${target.title}`, pageId };
      }),
    search_pages: define("search_pages", "Search page titles and text. Returns id, title, link and a snippet for each match.", z.object({ query: z.string().min(1).max(500) }), async ({ query }) => {
      await move(null, "thinking");
      const results = s.pages.searchPages(ws, query).slice(0, 30);
      if (!results.length) return { text: "No pages matched. Try fewer or different words, or list_pages.", summary: `Searched for ${query}` };
      return { text: JSON.stringify(results.map(({ page, snippet }) => ({ id: page.id, title: page.title, link: pageLink(page.title, page.id), snippet }))), summary: `Searched for ${query}` };
    }),
    create_page: define("create_page", "Create a page, optionally nested under a parent. Give it one fitting emoji as its icon (it marks the page on the map). For a long page, create it with an outline, then add each section with append_to_page.",
      z.object({ title: z.string().min(1).max(500), icon: z.string().max(16).optional(), markdown: markdown.optional(), parentId: parentRef.optional() }),
      async ({ title, icon, markdown: body, parentId }) => {
        check();
        const parent = parentId ? page(parentId) : null;
        const created = s.pages.createPage(ws, actor, { title, parentId, icon: pickIcon(icon, title, parent?.icon) });
        ctx.touched.add(created.id);
        const v = await write(created.id, async () => ({
          text: body ? await edit(created.id, () => markdownToTiptapJSON(stripTitleHeading(body, title))) : pageVersion(""),
          summary: "",
        }));
        return { text: `Created ${pageLink(title, created.id)} (id: ${created.id}, version: ${v.text}).`, summary: `Created ${title}`, pageId: created.id };
      }),
    append_to_page: define("append_to_page", "Add markdown to the end of a page without touching what's there. Use it to write a long page section by section.",
      z.object({ pageId: id, markdown }), ({ pageId, markdown: body }) => write(pageId, async () => {
        const v = await edit(pageId, (_current, doc) => { appendJSONToYDoc(doc, markdownToTiptapJSON(body)); });
        const title = page(pageId).title;
        return { text: `Added to ${pageLink(title, pageId)} (version: ${v}).`, summary: `Added to ${title}`, pageId };
      })),
    edit_page: define("edit_page", "Replace one exact, unique piece of a page's text. Copy find exactly from read_page, with enough surrounding text to be unique. Only the matched blocks change.",
      z.object({ pageId: id, version, find: z.string().min(1).max(200_000), replace: markdown }),
      ({ pageId, version: v, find, replace: replacement }) => write(pageId, async () => {
        let merged = false;
        const next = await edit(pageId, (current) => {
          const result = applyFind(current, v, find, replacement);
          merged = result.merged;
          return result.json;
        });
        const title = page(pageId).title;
        const note = merged ? " The page had changed since you read it; your edit was applied to the current text." : "";
        return { text: `Edited ${pageLink(title, pageId)} (version: ${next}).${note}`, summary: `Edited ${title}`, pageId };
      })),
    rewrite_page: define("rewrite_page", "Replace a page's full markdown. Prefer edit_page for small changes. Requires the version from read_page; refuses if the page changed since.",
      z.object({ pageId: id, version, markdown }), ({ pageId, version: v, markdown: body }) => write(pageId, async () => {
        const next = await edit(pageId, (current) => applyRewrite(current, v, stripTitleHeading(body, page(pageId).title)));
        const title = page(pageId).title;
        const paragraphs = body.split(/\n\s*\n/).filter(Boolean).length;
        return { text: `Rewrote ${pageLink(title, pageId)} (version: ${next}).`, summary: `Wrote ${paragraphs} paragraphs on ${title}`, pageId };
      })),
    rename_page: define("rename_page", "Change a page title.", z.object({ pageId: id, title: z.string().min(1).max(500) }),
      ({ pageId, title }) => write(pageId, async () => {
        s.pages.updatePage(ws, actor, pageId, { title });
        return { text: `Renamed to ${pageLink(title, pageId)}.`, summary: `Renamed ${title}`, pageId };
      })),
    move_page: define("move_page", "Move a page under a parent (parentId null = notebook root).",
      z.object({ pageId: id, parentId: parentRef }), ({ pageId, parentId }) => write(pageId, async () => {
        if (parentId) page(parentId);
        s.pages.updatePage(ws, actor, pageId, { parentId });
        const moved = page(pageId);
        const under = parentId ? ` under ${pageLink(page(parentId).title, parentId)}` : " to the notebook root";
        return { text: `Moved ${pageLink(moved.title, pageId)}${under}.`, summary: `Moved ${moved.title}`, pageId };
      })),
    delete_page: define("delete_page", "Soft-delete a page and its descendants, only when the person explicitly asks for deletion.",
      z.object({ pageId: id }), ({ pageId }) => ctx.withPageLock(pageId, async () => {
        check();
        const target = page(pageId);
        const descendants = s.pages.getDescendantIds(ws, pageId);
        await s.collab.hideAgent(pageId, ctx.presenceId);
        s.pages.deletePage(ws, pageId);
        // Never leave the run standing on a page that no longer exists.
        const from = getRun(s.db, ws, run.id)?.pageId ?? null;
        if (from && (from === pageId || descendants.includes(from))) {
          const parent = target.parentId && s.pages.getPage(ws, target.parentId) ? target.parentId : null;
          const updated = updateRun(s.db, ws, run.id, { pageId: parent });
          if (updated) publish({ type: "run.updated", run: updated });
          if (parent) publish({ type: "agent.moved", runId: run.id, agentId: agent.id, fromPageId: from, toPageId: parent, action: "thinking" });
        }
        return { text: `Deleted ${target.title} and ${descendants.length} child pages.`, summary: `Deleted ${target.title}`, pageId };
      })),
    ask_agent: define("ask_agent", "Ask another notebook agent to do a focused task and wait for their reply. They see only this request, not your conversation: include the page ids and titles involved and the goal.",
      z.object({ agentName: z.string().min(1).max(120), request: z.string().min(1).max(20_000) }), async ({ agentName, request }) => {
        await move(null, "thinking");
        return { text: await ctx.askAgent(agentName, request), summary: `Asked ${agentName} for help` };
      }, { concurrent: true }),
  };
  const drain = async () => {
    await pending.catch(() => {});
    while (inFlight.size) await Promise.allSettled([...inFlight]);
  };
  return { tools, drain };
}
