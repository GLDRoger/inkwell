/**
 * The contract between server and client. Change it deliberately: both sides
 * build against it in parallel.
 *
 * Every visitor gets their own workspace (an anonymous session cookie), seeded
 * with a demo map, so a judge can open the URL and play without signing up.
 */

export type Id = string;

export interface Page {
  id: Id;
  parentId: Id | null;
  title: string;
  icon: string | null;
  /** Fractional index among siblings. */
  position: string;
  /** Plain-text excerpt for map cards and search (first ~600 chars). */
  excerpt: string;
  /** Where the card sits on the map, in world units. Null until placed. */
  x: number | null;
  y: number | null;
  /** Optional cover/illustration (Muse Image or an upload). */
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: Actor;
}

/** Full page body is Tiptap JSON, synced live over Yjs at /collab. */
export interface PageWithBody extends Page {
  markdown: string;
}

export interface Actor {
  kind: "person" | "agent";
  id: Id;
  name: string;
}

export interface Agent {
  id: Id;
  name: string;
  /** One line shown on the map and in the diary. */
  description: string;
  instructions: string;
  /** Ink colour for its footprints and handwriting, e.g. "#7a2e1d". */
  color: string;
  model: string;
}

/** A diary is a ChatGPT-like thread with the agents, written in ink. */
export interface DiaryEntry {
  id: Id;
  threadId: Id;
  role: "person" | "agent";
  agentId: Id | null;
  /** Markdown. Agent entries stream in; see DiaryDelta events. */
  text: string;
  /** Pages this entry touched, for "see it on the map". */
  pageIds: Id[];
  attachments: Attachment[];
  runId: Id | null;
  createdAt: string;
}

export interface DiaryThread {
  id: Id;
  title: string;
  updatedAt: string;
}

export interface Attachment {
  id: Id;
  kind: "image" | "audio";
  url: string;
  name: string;
}

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface Run {
  id: Id;
  agentId: Id;
  threadId: Id | null;
  parentRunId: Id | null;
  prompt: string;
  status: RunStatus;
  /** The page the agent is on right now (drives its footprints). */
  pageId: Id | null;
  error: string | null;
  steps: RunStep[];
  createdAt: string;
  endedAt: string | null;
}

export interface RunStep {
  at: string;
  tool: string;
  /** Short, human sentence: "Read Billing", "Wrote 3 paragraphs on Search". */
  summary: string;
  pageId: Id | null;
  ok: boolean;
}

/** Links between pages (mentions/links in bodies), drawn as paths on the map. */
export interface Link {
  from: Id;
  to: Id;
}

export interface MapGraph {
  pages: Page[];
  links: Link[];
  agents: Agent[];
  /** Active and recent runs, newest first. */
  runs: Run[];
}

/**
 * Server-sent events on GET /api/events (one stream per workspace).
 * Footprints come from "agent.moved"; ink in the diary from "diary.delta".
 */
export type ServerEvent =
  | { type: "page.created"; page: Page }
  | { type: "page.updated"; page: Page }
  | { type: "page.deleted"; pageId: Id }
  | { type: "run.updated"; run: Run }
  | { type: "agent.moved"; runId: Id; agentId: Id; fromPageId: Id | null; toPageId: Id | null; action: "reading" | "writing" | "thinking" | "leaving" }
  | { type: "diary.entry"; entry: DiaryEntry }
  | { type: "diary.delta"; entryId: Id; threadId: Id; text: string }
  | { type: "presence"; people: { id: Id; name: string; pageId: Id | null }[] };

/**
 * REST, all JSON, under /api. Session cookie "inkwell_sid" is created on first
 * request and maps to a workspace.
 *
 * GET    /api/me                         -> { workspaceId, person: Actor }
 * GET    /api/map                        -> MapGraph
 * GET    /api/pages                      -> Page[]
 * POST   /api/pages {parentId?, title?, markdown?, x?, y?} -> Page
 * GET    /api/pages/:id                  -> PageWithBody
 * PATCH  /api/pages/:id {title?, icon?, parentId?, position?, x?, y?} -> Page
 * DELETE /api/pages/:id                  -> 204
 * GET    /api/search?q=                  -> { page: Page; snippet: string }[]
 * GET    /api/agents                     -> Agent[]
 * POST   /api/agents {name, description, instructions, color} -> Agent
 * GET    /api/diary                      -> DiaryThread[]
 * GET    /api/diary/:threadId            -> DiaryEntry[]
 * POST   /api/diary {threadId?, text, agentId?, attachmentIds?, pageId?} -> { entry: DiaryEntry; runId: Id; threadId: Id }
 * POST   /api/runs/:id/cancel            -> Run
 * POST   /api/uploads (multipart file)   -> Attachment
 * POST   /api/transcribe (multipart audio) -> { text: string }      (Muse Voice Transcribe)
 * POST   /api/pages/:id/illustrate       -> Page                    (Muse Image cover)
 * POST   /api/import/photo {attachmentId} -> { pages: Page[] }      (photo of notes/whiteboard -> cards, SAM 3.1 + vision)
 * GET    /api/events                     -> text/event-stream of ServerEvent
 * WS     /collab                         Hocuspocus; document name = page id
 */
