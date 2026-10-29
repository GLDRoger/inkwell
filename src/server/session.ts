import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Actor } from "../shared/types.ts";
import { newId, nowIso, type Db } from "./db.ts";
import { seedWorkspace } from "./seed.ts";
import type { PageStore } from "./pages.ts";

export const SESSION_COOKIE = "inkwell_sid";

export interface SessionCtx {
  workspaceId: string;
  person: Actor;
  sessionId: string;
}

export interface AppEnv {
  Variables: {
    ctx: SessionCtx;
  };
}

interface SessionRow {
  session_id: string;
  workspace_id: string;
  person_id: string;
  person_name: string;
}

const SELECT_SESSION = /* sql */ `
  SELECT s.id AS session_id, s.workspace_id AS workspace_id,
         p.id AS person_id, p.name AS person_name
  FROM sessions s
  JOIN people p ON p.id = s.person_id AND p.workspace_id = s.workspace_id
  WHERE s.id = ?
`;

export function getSession(db: Db, sessionId: string): SessionCtx | null {
  if (!sessionId) return null;
  const row = db.prepare(SELECT_SESSION).get(sessionId) as SessionRow | undefined;
  if (!row) return null;
  return {
    workspaceId: row.workspace_id,
    person: { kind: "person", id: row.person_id, name: row.person_name },
    sessionId: row.session_id,
  };
}

export function parseSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      const value = part.slice(eq + 1).trim();
      return value ? decodeURIComponent(value) : null;
    }
  }
  return null;
}

/** Resolve a session from a raw Cookie header (used by the /collab upgrade). */
export function getSessionFromCookieHeader(
  db: Db,
  cookieHeader: string | null | undefined,
): SessionCtx | null {
  const sid = parseSessionCookie(cookieHeader);
  return sid ? getSession(db, sid) : null;
}

function visitorName(db: Db): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    const name = `Visitor ${1000 + Math.floor(Math.random() * 9000)}`;
    const taken = db.prepare("SELECT 1 FROM people WHERE name = ? LIMIT 1").get(name);
    if (!taken) return name;
  }
  return `Visitor ${newId().slice(0, 6)}`;
}

export function createWorkspaceSession(
  deps: { db: Db; pages: PageStore },
): SessionCtx {
  const { db } = deps;
  const workspaceId = newId();
  const personId = newId();
  const sessionId = newId();
  const name = visitorName(db);
  const now = nowIso();
  db.transaction(() => {
    db.prepare("INSERT INTO workspaces (id, created_at) VALUES (?, ?)").run(workspaceId, now);
    db.prepare("INSERT INTO people (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      personId,
      workspaceId,
      name,
      now,
    );
    db.prepare(
      "INSERT INTO sessions (id, workspace_id, person_id, created_at) VALUES (?, ?, ?, ?)",
    ).run(sessionId, workspaceId, personId, now);
  })();
  const ctx: SessionCtx = {
    workspaceId,
    person: { kind: "person", id: personId, name },
    sessionId,
  };
  seedWorkspace(deps, workspaceId, ctx.person);
  return ctx;
}

function isHttps(c: Context): boolean {
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto) return proto === "https";
  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function createSessionMiddleware(deps: {
  db: Db;
  pages: PageStore;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const sid = getCookie(c, SESSION_COOKIE);
    let ctx = sid ? getSession(deps.db, sid) : null;
    if (!ctx) {
      ctx = createWorkspaceSession(deps);
      setCookie(c, SESSION_COOKIE, ctx.sessionId, {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        secure: isHttps(c),
      });
    }
    c.set("ctx", ctx);
    await next();
  };
}
