import { Hono, type Context } from "hono";
import { z, type ZodType } from "zod";
import type { AppEnv } from "../session.ts";
import type { Services } from "../services.ts";
import { jsonBodyLimit, PAGE_BODY_BYTES, MAX_MARKDOWN_CHARS } from "../limits.ts";
import { isValidPosition, PageStoreError } from "../pages.ts";

const createBody = z.object({
  parentId: z.string().nullable().optional(),
  title: z.string().max(500).optional(),
  icon: z.string().max(64).nullable().optional(),
  markdown: z.string().max(MAX_MARKDOWN_CHARS).optional(),
  x: z.number().nullable().optional(),
  y: z.number().nullable().optional(),
});

const patchBody = z.object({
  title: z.string().max(500).optional(),
  icon: z.string().max(64).nullable().optional(),
  parentId: z.string().nullable().optional(),
  position: z.string().refine(isValidPosition, "invalid position").optional(),
  x: z.number().nullable().optional(),
  y: z.number().nullable().optional(),
});

export async function parseJsonBody<T>(
  c: Context,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: c.json({ error: "The request wasn't valid JSON." }, 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: c.json(
        { error: parsed.error.issues[0]?.message ?? "invalid body" },
        400,
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

export function storeError(c: Context, err: unknown): Response {
  if (err instanceof PageStoreError) {
    return c.json({ error: err.message }, err.status as 400);
  }
  throw err;
}

export function createPageRoutes(services: Services): Hono<AppEnv> {
  const { pages } = services;
  const app = new Hono<AppEnv>();

  app.get("/api/me", (c) => {
    const { workspaceId, person } = c.get("ctx");
    return c.json({ workspaceId, person });
  });

  app.get("/api/pages", (c) => {
    return c.json(pages.listPages(c.get("ctx").workspaceId));
  });

  app.post("/api/pages", jsonBodyLimit(PAGE_BODY_BYTES), async (c) => {
    const { workspaceId, person } = c.get("ctx");
    const body = await parseJsonBody(c, createBody);
    if (!body.ok) return body.response;
    try {
      const page = pages.createPage(workspaceId, person, body.data);
      return c.json(page, 201);
    } catch (err) {
      return storeError(c, err);
    }
  });

  app.get("/api/pages/:id", (c) => {
    const page = pages.getPageWithBody(c.get("ctx").workspaceId, c.req.param("id"));
    if (!page) return c.json({ error: "This page doesn't exist or was deleted.", code: "page_not_found" }, 404);
    return c.json(page);
  });

  app.patch("/api/pages/:id", jsonBodyLimit(PAGE_BODY_BYTES), async (c) => {
    const { workspaceId, person } = c.get("ctx");
    const body = await parseJsonBody(c, patchBody);
    if (!body.ok) return body.response;
    try {
      const page = pages.updatePage(workspaceId, person, c.req.param("id"), body.data);
      if (!page) return c.json({ error: "This page doesn't exist or was deleted.", code: "page_not_found" }, 404);
      return c.json(page);
    } catch (err) {
      return storeError(c, err);
    }
  });

  app.delete("/api/pages/:id", (c) => {
    const ok = pages.deletePage(c.get("ctx").workspaceId, c.req.param("id"));
    if (!ok) return c.json({ error: "This page doesn't exist or was deleted.", code: "page_not_found" }, 404);
    return c.body(null, 204);
  });

  app.get("/api/search", (c) => {
    const q = c.req.query("q") ?? "";
    return c.json(pages.searchPages(c.get("ctx").workspaceId, q));
  });

  return app;
}
