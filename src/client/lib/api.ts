import type {
  Agent,
  Attachment,
  DemoScenario,
  DemoState,
  DiaryEntry,
  DiaryThread,
  Id,
  MapGraph,
  Page,
  PageWithBody,
  Me,
  Run,
} from "@shared/types";
import { getDemo } from "./demo";
import { aiHeaders } from "./key";

/** An HTTP failure with its status, so callers can tell "not built yet" (404) from a real error. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The server's machine-readable reason, when it sends one (e.g. "thread_not_found"). */
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const isNotFound = (e: unknown): boolean => e instanceof ApiError && e.status === 404;
export const isOffline = (e: unknown): boolean => e instanceof ApiError && e.status === 0;
/** The server has no Meta key for this request (neither its own nor the visitor's). */
export const isNotConnected = (e: unknown): boolean =>
  e instanceof ApiError && (e.code === "meta_not_connected" || (e.status === 503 && !e.code && /\bAPI key\b/i.test(e.message)));
/** The request tried to change the read-only demo notebook. */
export const isDemoReadOnly = (e: unknown): boolean => e instanceof ApiError && e.code === "demo_read_only";

export const DEMO_READ_ONLY = "This is the recorded demo, so it can't be changed. Try it yourself to write in your own notebook.";

/** Requests that may change something and still make sense while watching the demo. */
const DEMO_WRITES_OK = /^\/(presence|demo\/|key\/check)/;

/** Headers every request carries: which notebook it's for. */
export function notebookHeaders(): Record<string, string> {
  return getDemo().notebook === "demo" ? { "X-Inkwell-Notebook": "demo" } : {};
}

async function request<T>(path: string, init?: RequestInit, { ai = false }: { ai?: boolean } = {}): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  // The demo notebook is read-only for people; say so calmly instead of asking the server to refuse.
  if (method !== "GET" && getDemo().notebook === "demo" && !DEMO_WRITES_OK.test(path)) {
    throw new ApiError(403, DEMO_READ_ONLY, "demo_read_only");
  }
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries({ ...notebookHeaders(), ...(ai ? aiHeaders() : {}) })) headers.set(k, v);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { credentials: "same-origin", ...init, headers });
  } catch {
    throw new ApiError(0, "Can't reach the server.");
  }
  if (!res.ok) {
    let message = res.statusText || `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = await res.json();
      if (body && typeof body.error === "string") message = body.error;
      else if (body && typeof body.message === "string") message = body.message;
      if (body && typeof body.code === "string") code = body.code;
      if (code === "demo_read_only") message = DEMO_READ_ONLY;
    } catch {
      /* body was not JSON; keep the status text */
    }
    throw new ApiError(res.status, message, code);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("json") ? res.json() : res.text()) as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export interface SearchHit {
  page: Page;
  snippet: string;
}

export interface DiaryPostBody {
  threadId?: Id;
  text: string;
  agentId?: Id;
  attachmentIds?: Id[];
  pageId?: Id;
}

export const api = {
  /** `metaConnected` is false when the server has no Meta API key of its own (a visitor's key still works). */
  me: () => request<Me>("/me"),
  map: () => request<MapGraph>("/map"),
  pages: () => request<Page[]>("/pages"),
  page: (id: Id) => request<PageWithBody>(`/pages/${encodeURIComponent(id)}`),
  createPage: (body: { parentId?: Id | null; title?: string; markdown?: string; x?: number; y?: number }) =>
    request<Page>("/pages", json("POST", body)),
  updatePage: (id: Id, body: Partial<Pick<Page, "title" | "icon" | "parentId" | "position" | "x" | "y">>) =>
    request<Page>(`/pages/${encodeURIComponent(id)}`, json("PATCH", body)),
  deletePage: (id: Id) => request<void>(`/pages/${encodeURIComponent(id)}`, { method: "DELETE" }),
  search: (q: string, signal?: AbortSignal) =>
    request<SearchHit[]>(`/search?q=${encodeURIComponent(q)}`, { signal }),
  agents: () => request<Agent[]>("/agents"),
  threads: () => request<DiaryThread[]>("/diary"),
  thread: (threadId: Id) => request<DiaryEntry[]>(`/diary/${encodeURIComponent(threadId)}`),
  writeDiary: (body: DiaryPostBody) =>
    request<{ entry: DiaryEntry; runId: Id; threadId: Id }>("/diary", json("POST", body), { ai: true }),
  run: (id: Id) => request<Run>(`/runs/${encodeURIComponent(id)}`),
  cancelRun: (id: Id) => request<Run>(`/runs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file, file.name);
    return request<Attachment>("/uploads", { method: "POST", body: form });
  },
  transcribe: (audio: Blob) => {
    const form = new FormData();
    form.append("audio", audio, "speech.wav");
    return request<{ text: string }>("/transcribe", { method: "POST", body: form }, { ai: true });
  },
  /** Muse Image paints a cover for the page; returns the page with its new coverUrl. */
  illustrate: (id: Id) => request<Page>(`/pages/${encodeURIComponent(id)}/illustrate`, { method: "POST" }, { ai: true }),
  /** SAM 3.1 + vision turn an uploaded photo of notes into cards: a parent page, then one per note.
   * `segmentedBy` is "sam-3.1" when SAM found the notes, null when vision did it alone. */
  importPhoto: (attachmentId: Id) =>
    request<{ pages: Page[]; segmentedBy?: "sam-3.1" | null }>("/import/photo", json("POST", { attachmentId }), { ai: true }),
  presence: (pageId: Id | null) => request<void>("/presence", json("POST", { pageId })),

  /** Reset the demo notebook and play the scenario from the top. */
  startDemo: () => request<{ scenario: DemoScenario } & Partial<DemoState>>("/demo/start", { method: "POST" }),
  stopDemo: () => request<void>("/demo/stop", { method: "POST" }),
  demo: () => request<DemoState>("/demo"),
  /** One cheap call to Meta with this key; the server doesn't keep it. */
  checkKey: (key: string) => request<{ ok: true } | { ok: false; error: string }>("/key/check", { method: "POST", headers: { "X-Meta-Key": key } }),
};
