import type {
  Actor,
  Agent,
  Attachment,
  DiaryEntry,
  DiaryThread,
  Id,
  MapGraph,
  Page,
  PageWithBody,
  Run,
} from "@shared/types";

/** An HTTP failure with its status, so callers can tell "not built yet" (404) from a real error. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const isNotFound = (e: unknown): boolean => e instanceof ApiError && e.status === 404;
export const isOffline = (e: unknown): boolean => e instanceof ApiError && e.status === 0;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiError(0, "Can't reach the server.");
  }
  if (!res.ok) {
    let message = res.statusText || `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body && typeof body.error === "string") message = body.error;
      else if (body && typeof body.message === "string") message = body.message;
    } catch {
      /* body was not JSON; keep the status text */
    }
    throw new ApiError(res.status, message);
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
  me: () => request<{ workspaceId: Id; person: Actor }>("/me"),
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
    request<{ entry: DiaryEntry; runId: Id; threadId: Id }>("/diary", json("POST", body)),
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
    return request<{ text: string }>("/transcribe", { method: "POST", body: form });
  },
  /** Muse Image paints a cover for the page; returns the page with its new coverUrl. */
  illustrate: (id: Id) => request<Page>(`/pages/${encodeURIComponent(id)}/illustrate`, { method: "POST" }),
  /** SAM 3.1 + vision turn an uploaded photo of notes into cards: a parent page, then one per note. */
  importPhoto: (attachmentId: Id) => request<{ pages: Page[] }>("/import/photo", json("POST", { attachmentId })),
  presence: (pageId: Id | null) => request<void>("/presence", json("POST", { pageId })),
};
