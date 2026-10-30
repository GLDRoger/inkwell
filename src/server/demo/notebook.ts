/**
 * A session's demo notebook (docs/DEMO-MODE.md): a second workspace, created on
 * first use and reset to a fresh seed on every demo start. People only read it;
 * the demo runner writes to it.
 */
import { newId, nowIso, purgeWorkspaceContent, type Db } from "../db.ts";
import { flushFileDeletions } from "../janitor.ts";
import type { PageStore } from "../pages.ts";
import { seedWorkspace } from "../seed.ts";
import type { Services } from "../services.ts";
import type { SessionCtx } from "../session.ts";

/** The session's demo notebook id, creating and seeding it on first use. */
export function ensureDemoWorkspace(deps: { db: Db; pages: PageStore }, ctx: SessionCtx): string {
  const { db } = deps;
  let created: string | null = null;
  const id = db.transaction(() => {
    const row = db.prepare(`SELECT s.demo_workspace_id AS id FROM sessions s
      JOIN workspaces w ON w.id = s.demo_workspace_id WHERE s.id = ?`).get(ctx.sessionId) as { id: string } | undefined;
    if (row) return row.id;
    created = newId();
    db.prepare("INSERT INTO workspaces (id, created_at) VALUES (?, ?)").run(created, nowIso());
    db.prepare("UPDATE sessions SET demo_workspace_id = ? WHERE id = ?").run(created, ctx.sessionId);
    return created;
  })();
  if (created) seedWorkspace(deps, id, ctx.person);
  return id;
}

/**
 * Empty the demo notebook and seed it again. Old pages are announced as deleted so
 * open maps drop them. Its id stays the same, so open event streams keep working.
 */
export async function resetDemoWorkspace(services: Services, ctx: SessionCtx, demoWorkspaceId: string): Promise<void> {
  const { db, pages, bus } = services;
  const old = pages.listPages(demoWorkspaceId).map((p) => p.id);
  db.transaction(() => purgeWorkspaceContent(db, demoWorkspaceId))();
  for (const pageId of old) bus.publish(demoWorkspaceId, { type: "page.deleted", pageId });
  seedWorkspace({ db, pages }, demoWorkspaceId, ctx.person);
  await flushFileDeletions(services);
}
