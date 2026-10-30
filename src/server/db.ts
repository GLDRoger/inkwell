import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type {
  Actor,
  Agent,
  DiaryEntry,
  DiaryThread,
  Attachment,
  Run,
  RunStatus,
  RunUsage,
  RunStep,
} from "../shared/types.ts";
import { defaultTextModel } from "./meta-access.ts";

export type Db = Database.Database;

export interface DatabaseHandle {
  db: Db;
  dataDir: string;
  uploadsDir: string;
  close: () => void;
}

export function resolveDataDir(explicit?: string): string {
  return path.resolve(explicit ?? process.env.DATA_DIR ?? "./data");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return nanoid(21);
}

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_people_workspace ON people(workspace_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id);

CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  parent_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  icon TEXT,
  position TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  x REAL,
  y REAL,
  cover_url TEXT,
  markdown TEXT NOT NULL DEFAULT '',
  ydoc BLOB,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pages_workspace ON pages(workspace_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(workspace_id, parent_id);

CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  page_id UNINDEXED,
  workspace_id UNINDEXED,
  title,
  markdown
);

CREATE TABLE IF NOT EXISTS links (
  workspace_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, from_id, to_id)
);
CREATE INDEX IF NOT EXISTS idx_links_to ON links(workspace_id, to_id);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#7a2e1d',
  model TEXT NOT NULL DEFAULT 'muse-spark-1.3',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id);

CREATE TABLE IF NOT EXISTS diary_threads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_threads_workspace ON diary_threads(workspace_id, updated_at);

CREATE TABLE IF NOT EXISTS diary_entries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  thread_id TEXT NOT NULL REFERENCES diary_threads(id),
  role TEXT NOT NULL,
  agent_id TEXT,
  text TEXT NOT NULL DEFAULT '',
  page_ids TEXT NOT NULL DEFAULT '[]',
  attachments TEXT NOT NULL DEFAULT '[]',
  run_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_thread ON diary_entries(workspace_id, thread_id, created_at);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  agent_id TEXT NOT NULL,
  thread_id TEXT,
  parent_run_id TEXT,
  prompt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  page_id TEXT,
  error TEXT,
  steps TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_workspace ON runs(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_workspace ON attachments(workspace_id);
`;

export function openDatabase(explicitDataDir?: string): DatabaseHandle {
  const dataDir = resolveDataDir(explicitDataDir);
  const uploadsDir = path.join(dataDir, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });

  const dbPath = path.join(dataDir, "inkwell.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  // Existing installations gain activity tracking without rewriting their tables.
  const columns = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
  if (!columns.some(column => column.name === "last_seen_at")) {
    db.exec("ALTER TABLE sessions ADD COLUMN last_seen_at TEXT");
  }
  db.exec("CREATE TABLE IF NOT EXISTS pending_file_deletions (path TEXT PRIMARY KEY)");
  // Demo mode (docs/DEMO-MODE.md): a session's second, read-only notebook, and
  // which model each run used / whether it was replayed. Additive only.
  addColumn(db, "sessions", "demo_workspace_id", "TEXT");
  addColumn(db, "runs", "model", "TEXT");
  addColumn(db, "runs", "recorded", "INTEGER NOT NULL DEFAULT 0");
  // Token usage per run (JSON RunUsage), so evaluations can see what a request cost.
  addColumn(db, "runs", "usage", "TEXT");

  const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as
    | { version: number }
    | undefined;
  if (!row) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(1);
  }

  return {
    db,
    dataDir,
    uploadsDir,
    close: () => db.close(),
  };
}

function addColumn(db: Db, table: string, column: string, type: string): void {
  // Table, column and type are internal constants, never request data.
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export function getSchemaVersion(db: Db): number {
  const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as
    | { version: number }
    | undefined;
  return row?.version ?? 0;
}

export function setSchemaVersion(db: Db, version: number): void {
  db.prepare("UPDATE schema_version SET version = ?").run(version);
}

/* ---------------- Row shapes ---------------- */

export interface PageRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  position: string;
  excerpt: string;
  x: number | null;
  y: number | null;
  cover_url: string | null;
  markdown: string;
  ydoc: Buffer | null;
  updated_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AgentRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  instructions: string;
  color: string;
  model: string;
  created_at: string;
}

export interface DiaryThreadRow {
  id: string;
  workspace_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface DiaryEntryRow {
  id: string;
  workspace_id: string;
  thread_id: string;
  role: string;
  agent_id: string | null;
  text: string;
  page_ids: string;
  attachments: string;
  run_id: string | null;
  created_at: string;
}

export interface RunRow {
  id: string;
  workspace_id: string;
  agent_id: string;
  thread_id: string | null;
  parent_run_id: string | null;
  prompt: string;
  status: string;
  page_id: string | null;
  error: string | null;
  steps: string;
  created_at: string;
  ended_at: string | null;
  model?: string | null;
  recorded?: number | null;
  usage?: string | null;
}

export interface AttachmentRow {
  id: string;
  workspace_id: string;
  kind: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  created_at: string;
}

/* ---------------- Mappers ---------------- */

export function parseActor(raw: string): Actor {
  try {
    const v = JSON.parse(raw) as Actor;
    if (v && (v.kind === "person" || v.kind === "agent") && v.id) return v;
  } catch {
    /* fall through */
  }
  return { kind: "person", id: "unknown", name: "Unknown" };
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export function rowToAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    color: row.color,
    model: row.model,
  };
}

export function rowToDiaryThread(row: DiaryThreadRow): DiaryThread {
  return { id: row.id, title: row.title, updatedAt: row.updated_at };
}

export function rowToDiaryEntry(row: DiaryEntryRow): DiaryEntry {
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role === "agent" ? "agent" : "person",
    agentId: row.agent_id,
    text: row.text,
    pageIds: parseJsonArray<string>(row.page_ids),
    attachments: parseJsonArray<Attachment>(row.attachments),
    runId: row.run_id,
    createdAt: row.created_at,
  };
}

export function rowToRun(row: RunRow): Run {
  return {
    id: row.id,
    agentId: row.agent_id,
    threadId: row.thread_id,
    parentRunId: row.parent_run_id,
    prompt: row.prompt,
    status: row.status as Run["status"],
    pageId: row.page_id,
    error: row.error,
    steps: parseJsonArray<Run["steps"][number]>(row.steps),
    createdAt: row.created_at,
    endedAt: row.ended_at,
    ...(row.model ? { model: row.model } : {}),
    ...(row.recorded ? { recorded: true } : {}),
    ...(row.usage ? { usage: parseUsage(row.usage) } : {}),
  };
}

function parseUsage(raw: string): RunUsage | undefined {
  try {
    const u = JSON.parse(raw) as Partial<RunUsage>;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    return { inputTokens: n(u.inputTokens), outputTokens: n(u.outputTokens), totalTokens: n(u.totalTokens) };
  } catch { return undefined; }
}

export function rowToAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    kind: row.kind === "audio" ? "audio" : "image",
    url: `/api/files/${row.id}`,
    name: row.name,
  };
}

/* ---------------- Small query helpers (agents / diary / runs / files) ---------------- */

export function listAgents(db: Db, workspaceId: string): Agent[] {
  const rows = db
    .prepare("SELECT * FROM agents WHERE workspace_id = ? ORDER BY rowid ASC")
    .all(workspaceId) as AgentRow[];
  return rows.map(rowToAgent);
}

export function getAgent(db: Db, workspaceId: string, id: string): Agent | null {
  const row = db
    .prepare("SELECT * FROM agents WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, id) as AgentRow | undefined;
  return row ? rowToAgent(row) : null;
}

export function insertAgent(
  db: Db,
  workspaceId: string,
  input: {
    id?: string;
    name: string;
    description: string;
    instructions: string;
    color: string;
    model?: string;
  },
): Agent {
  const agent: Agent = {
    id: input.id ?? newId(),
    name: input.name,
    description: input.description,
    instructions: input.instructions,
    color: input.color,
    model: input.model ?? defaultTextModel(),
  };
  db.prepare(
    `INSERT INTO agents (id, workspace_id, name, description, instructions, color, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    agent.id,
    workspaceId,
    agent.name,
    agent.description,
    agent.instructions,
    agent.color,
    agent.model,
    nowIso(),
  );
  return agent;
}

export function listDiaryThreads(db: Db, workspaceId: string): DiaryThread[] {
  const rows = db
    .prepare(
      "SELECT * FROM diary_threads WHERE workspace_id = ? ORDER BY updated_at DESC",
    )
    .all(workspaceId) as DiaryThreadRow[];
  return rows.map(rowToDiaryThread);
}

export function getDiaryThread(
  db: Db,
  workspaceId: string,
  threadId: string,
): DiaryThread | null {
  const row = db
    .prepare("SELECT * FROM diary_threads WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, threadId) as DiaryThreadRow | undefined;
  return row ? rowToDiaryThread(row) : null;
}

export function listDiaryEntries(
  db: Db,
  workspaceId: string,
  threadId: string,
): DiaryEntry[] {
  const rows = db
    .prepare(
      "SELECT * FROM diary_entries WHERE workspace_id = ? AND thread_id = ? ORDER BY rowid ASC",
    )
    .all(workspaceId, threadId) as DiaryEntryRow[];
  return rows.map(rowToDiaryEntry);
}

export function insertDiaryThread(
  db: Db,
  workspaceId: string,
  title: string,
  id: string = newId(),
): DiaryThread {
  const now = nowIso();
  db.prepare(
    "INSERT INTO diary_threads (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, workspaceId, title, now, now);
  return { id, title, updatedAt: now };
}

export function insertDiaryEntry(
  db: Db,
  workspaceId: string,
  input: {
    id?: string;
    threadId: string;
    role: "person" | "agent";
    agentId?: string | null;
    text: string;
    pageIds?: string[];
    attachments?: Attachment[];
    runId?: string | null;
  },
): DiaryEntry {
  const entry: DiaryEntry = {
    id: input.id ?? newId(),
    threadId: input.threadId,
    role: input.role,
    agentId: input.agentId ?? null,
    text: input.text,
    pageIds: input.pageIds ?? [],
    attachments: input.attachments ?? [],
    runId: input.runId ?? null,
    createdAt: nowIso(),
  };
  db.prepare(
    `INSERT INTO diary_entries (id, workspace_id, thread_id, role, agent_id, text, page_ids, attachments, run_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.id,
    workspaceId,
    entry.threadId,
    entry.role,
    entry.agentId,
    entry.text,
    JSON.stringify(entry.pageIds),
    JSON.stringify(entry.attachments),
    entry.runId,
    entry.createdAt,
  );
  db.prepare(
    "UPDATE diary_threads SET updated_at = ? WHERE workspace_id = ? AND id = ?",
  ).run(entry.createdAt, workspaceId, entry.threadId);
  return entry;
}

/** Latest run per agent, plus every active run, with stable newest-first ordering. */
export function listRecentRuns(db: Db, workspaceId: string): Run[] {
  const rows = db
    .prepare(
      `WITH ranked AS (
         SELECT *, rowid AS insertion_order,
           ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY created_at DESC, rowid DESC) AS agent_rank
         FROM runs WHERE workspace_id = ?
       )
       SELECT * FROM ranked WHERE agent_rank = 1 OR status IN ('queued', 'running')
       ORDER BY created_at DESC, insertion_order DESC`,
    )
    .all(workspaceId) as RunRow[];
  return rows.map(rowToRun);
}

export function getRun(db: Db, workspaceId: string, id: string): Run | null {
  const row = db
    .prepare("SELECT * FROM runs WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, id) as RunRow | undefined;
  return row ? rowToRun(row) : null;
}

export function insertRun(
  db: Db,
  workspaceId: string,
  input: {
    id?: string;
    agentId: string;
    threadId?: string | null;
    parentRunId?: string | null;
    prompt: string;
    status?: RunStatus;
    pageId?: string | null;
    model?: string;
    recorded?: boolean;
  },
): Run {
  const run: Run = {
    id: input.id ?? newId(),
    agentId: input.agentId,
    threadId: input.threadId ?? null,
    parentRunId: input.parentRunId ?? null,
    prompt: input.prompt,
    status: input.status ?? "queued",
    pageId: input.pageId ?? null,
    error: null,
    steps: [],
    createdAt: nowIso(),
    endedAt: null,
    ...(input.model ? { model: input.model } : {}),
    ...(input.recorded ? { recorded: true } : {}),
  };
  db.prepare(
    `INSERT INTO runs (id, workspace_id, agent_id, thread_id, parent_run_id, prompt, status, page_id, error, steps, created_at, ended_at, model, recorded)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, '[]', ?, NULL, ?, ?)`,
  ).run(
    run.id,
    workspaceId,
    run.agentId,
    run.threadId,
    run.parentRunId,
    run.prompt,
    run.status,
    run.pageId,
    run.createdAt,
    input.model ?? null,
    input.recorded ? 1 : 0,
  );
  return run;
}

/**
 * Patch a run. Setting a terminal status (succeeded/failed/cancelled) stamps
 * endedAt unless given. Returns the updated run, or null if not in workspace.
 */
export function updateRun(
  db: Db,
  workspaceId: string,
  id: string,
  patch: {
    status?: RunStatus;
    pageId?: string | null;
    error?: string | null;
    steps?: RunStep[];
    endedAt?: string | null;
    usage?: RunUsage;
  },
): Run | null {
  const current = getRun(db, workspaceId, id);
  if (!current) return null;
  const status = patch.status ?? current.status;
  const terminal = status === "succeeded" || status === "failed" || status === "cancelled";
  const next: Run = {
    ...current,
    status,
    pageId: patch.pageId !== undefined ? patch.pageId : current.pageId,
    error: patch.error !== undefined ? patch.error : current.error,
    steps: patch.steps ?? current.steps,
    endedAt:
      patch.endedAt !== undefined
        ? patch.endedAt
        : terminal
          ? (current.endedAt ?? nowIso())
          : current.endedAt,
    ...(patch.usage ? { usage: patch.usage } : {}),
  };
  db.prepare(
    `UPDATE runs SET status = ?, page_id = ?, error = ?, steps = ?, ended_at = ?, usage = ?
     WHERE workspace_id = ? AND id = ?`,
  ).run(next.status, next.pageId, next.error, JSON.stringify(next.steps), next.endedAt,
    next.usage ? JSON.stringify(next.usage) : null, workspaceId, id);
  return next;
}

/** Append one step (and optionally move the run to the step's page). */
export function appendRunStep(
  db: Db,
  workspaceId: string,
  id: string,
  step: Omit<RunStep, "at"> & { at?: string },
  options: { movePage?: boolean } = {},
): Run | null {
  const current = getRun(db, workspaceId, id);
  if (!current) return null;
  const full: RunStep = { ...step, at: step.at ?? nowIso() };
  return updateRun(db, workspaceId, id, {
    steps: [...current.steps, full],
    ...(options.movePage ? { pageId: full.pageId } : {}),
  });
}

export function getDiaryEntry(db: Db, workspaceId: string, id: string): DiaryEntry | null {
  const row = db
    .prepare("SELECT * FROM diary_entries WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, id) as DiaryEntryRow | undefined;
  return row ? rowToDiaryEntry(row) : null;
}

/** Patch an entry (e.g. the agent's streamed text once complete, touched pages). */
export function updateDiaryEntry(
  db: Db,
  workspaceId: string,
  id: string,
  patch: { text?: string; pageIds?: string[]; runId?: string | null },
): DiaryEntry | null {
  const current = getDiaryEntry(db, workspaceId, id);
  if (!current) return null;
  const next: DiaryEntry = {
    ...current,
    text: patch.text ?? current.text,
    pageIds: patch.pageIds ?? current.pageIds,
    runId: patch.runId !== undefined ? patch.runId : current.runId,
  };
  db.prepare(
    "UPDATE diary_entries SET text = ?, page_ids = ?, run_id = ? WHERE workspace_id = ? AND id = ?",
  ).run(next.text, JSON.stringify(next.pageIds), next.runId, workspaceId, id);
  return next;
}

/** Attachments by id, workspace-scoped (unknown ids are skipped). */
export function getAttachments(db: Db, workspaceId: string, ids: string[]): Attachment[] {
  const out: Attachment[] = [];
  for (const id of ids) {
    const row = getAttachmentRow(db, workspaceId, id);
    if (row) out.push(rowToAttachment(row));
  }
  return out;
}

/** Absolute path of an attachment's file on disk, workspace-scoped. */
export function attachmentFilePath(
  db: Db,
  uploadsDir: string,
  workspaceId: string,
  id: string,
): { path: string; mime: string; name: string } | null {
  const row = getAttachmentRow(db, workspaceId, id);
  if (!row) return null;
  return { path: path.join(uploadsDir, path.basename(row.path)), mime: row.mime, name: row.name };
}

export function insertAttachmentRow(
  db: Db,
  workspaceId: string,
  input: { id: string; kind: "image" | "audio"; name: string; mime: string; size: number; path: string },
): Attachment {
  db.prepare(
    `INSERT INTO attachments (id, workspace_id, kind, name, mime, size, path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(input.id, workspaceId, input.kind, input.name, input.mime, input.size, input.path, nowIso());
  return { id: input.id, kind: input.kind, url: `/api/files/${input.id}`, name: input.name };
}

export function getAttachmentRow(
  db: Db,
  workspaceId: string,
  id: string,
): AttachmentRow | null {
  const row = db
    .prepare("SELECT * FROM attachments WHERE workspace_id = ? AND id = ?")
    .get(workspaceId, id) as AttachmentRow | undefined;
  return row ?? null;
}

/**
 * Delete everything a notebook holds (not its sessions, people or the workspace row),
 * in FK order, and queue its files for deletion. Call inside a transaction.
 */
export function purgeWorkspaceContent(db: Db, workspaceId: string): void {
  db.prepare("INSERT OR IGNORE INTO pending_file_deletions (path) SELECT path FROM attachments WHERE workspace_id = ?").run(workspaceId);
  // pages.ydoc is removed along with the page.
  for (const table of ["diary_entries", "runs", "diary_threads", "agents", "attachments", "links", "pages_fts", "pages"]) {
    // Table names are an internal constant allowlist, never request data.
    db.prepare(`DELETE FROM ${table} WHERE workspace_id = ?`).run(workspaceId);
  }
}

/** At most one activity write per session per hour; no unbounded in-memory cache. */
export function touchSession(db: Db, sessionId: string): void {
  const now = Date.now();
  db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?
    AND COALESCE(last_seen_at, created_at) <= ?`)
    .run(new Date(now).toISOString(), sessionId, new Date(now - 3_600_000).toISOString());
}

/**
 * Runs left queued/running by a crash or restart can never finish: mark them
 * failed and give their empty diary replies the reason. Call once at startup,
 * before any run starts. Returns the number of runs repaired.
 */
export function failInterruptedRuns(db: Db, reason: string): number {
  const ended = nowIso();
  return db.transaction(() => {
    db.prepare(
      `UPDATE diary_entries SET text = ? WHERE text = '' AND run_id IN (
         SELECT r.id FROM runs r WHERE r.workspace_id = diary_entries.workspace_id AND r.status IN ('queued', 'running'))`,
    ).run(reason);
    return db.prepare(
      "UPDATE runs SET status = 'failed', error = ?, ended_at = ? WHERE status IN ('queued', 'running')",
    ).run(reason, ended).changes;
  })();
}

/** Give a run's still-empty diary replies a closing line. Returns the entries changed. */
export function finishEmptyRunEntries(db: Db, workspaceId: string, runId: string, text: string): DiaryEntry[] {
  const rows = db.prepare(
    "SELECT * FROM diary_entries WHERE workspace_id = ? AND run_id = ? AND text = ''",
  ).all(workspaceId, runId) as DiaryEntryRow[];
  return rows.map((row) => updateDiaryEntry(db, workspaceId, row.id, { text })!).filter(Boolean);
}

/** Undo a diary submission whose run never started: the entry, and its thread if that is now empty. */
export function deleteDiaryEntry(db: Db, workspaceId: string, id: string, threadId: string): void {
  db.transaction(() => {
    db.prepare("DELETE FROM diary_entries WHERE workspace_id = ? AND id = ?").run(workspaceId, id);
    const left = db.prepare("SELECT 1 FROM diary_entries WHERE workspace_id = ? AND thread_id = ? LIMIT 1").get(workspaceId, threadId);
    if (!left) db.prepare("DELETE FROM diary_threads WHERE workspace_id = ? AND id = ?").run(workspaceId, threadId);
  })();
}
