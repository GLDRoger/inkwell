/**
 * The peeked page lives in the URL (`/?peek=<id>`), so it survives a reload
 * and Back and Forward step through what you looked at. Other parameters
 * (`focus`, `welcome`) are left as they are.
 */
export const PEEK_PARAM = "peek";

export function peekFrom(search: string | URLSearchParams): string | null {
  const q = typeof search === "string" ? new URLSearchParams(search) : search;
  const id = q.get(PEEK_PARAM)?.trim();
  return id ? id : null;
}

/** `search` with the peek set to `id`, or removed for null. Returns "" or "?…". */
export function withPeek(search: string | URLSearchParams, id: string | null): string {
  const q = new URLSearchParams(typeof search === "string" ? search : search.toString());
  if (id) q.set(PEEK_PARAM, id);
  else q.delete(PEEK_PARAM);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * How a peek change goes into history. Opening a peek from none is a step you
 * can go Back from; swapping to another page or closing replaces the entry, so
 * Back never walks through every card you glanced at, and a demo that opens
 * pages by itself never adds entries at all.
 */
export function peekHistory(current: string | null, next: string | null, by: "person" | "demo"): "push" | "replace" | null {
  if (current === next) return null;
  if (by === "demo") return "replace";
  return current === null && next !== null ? "push" : "replace";
}
