import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';

export const PAGE_BODY_BYTES = 512 * 1024;
export const MAX_MARKDOWN_CHARS = 200_000;
export const MAX_YDOC_BYTES = 4 * 1024 * 1024;
export const MAX_WS_PAYLOAD_BYTES = 2 * 1024 * 1024;

/** Count actual bytes even if a caller supplies an inaccurate Content-Length. */
export function jsonBodyLimit(maxSize: number): MiddlewareHandler {
  const limit = bodyLimit({ maxSize, onError: c => c.json({ error: 'request body too large' }, 413) });
  return async (c, next) => {
    const length = c.req.header('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > maxSize)) {
      return c.json({ error: 'request body too large' }, 413);
    }
    // Hono's Content-Length fast path trusts the header; force its byte-counted path.
    if (length && c.req.raw.body) {
      const headers = new Headers(c.req.raw.headers);
      headers.delete('content-length');
      c.req.raw = new Request(c.req.raw, { headers });
    }
    return limit(c, next);
  };
}
