import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../session.ts";
import type { Services } from "../services.ts";
import { getAttachmentRow, insertAttachmentRow, newId } from "../db.ts";

export const WORKSPACE_UPLOAD_QUOTA = 100 * 1024 * 1024;
export const MIN_FREE_DISK_BYTES = 2 * 1024 * 1024 * 1024;

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/avif": ".avif",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
};

export function createUploadRoutes(services: Services): Hono<AppEnv> {
  const { db, uploadsDir } = services;
  const app = new Hono<AppEnv>();

  app.post(
    "/api/uploads",
    // Refuse oversized bodies before buffering them (multipart overhead allowed).
    bodyLimit({
      maxSize: MAX_UPLOAD_BYTES + 1024 * 1024,
      onError: (c) => c.json({ error: "file exceeds 20 MB limit" }, 413),
    }),
    async (c) => {
      const { workspaceId } = c.get("ctx");
      let body: Record<string, string | File>;
      try {
        body = await c.req.parseBody();
      } catch {
        return c.json({ error: "expected multipart form data" }, 400);
      }
      const file =
        body["file"] instanceof File
          ? body["file"]
          : Object.values(body).find((v): v is File => v instanceof File);
      if (!file) return c.json({ error: "missing file field" }, 400);
      if (file.size === 0) return c.json({ error: "file is empty" }, 400);
      if (file.size > MAX_UPLOAD_BYTES) {
        return c.json({ error: "file exceeds 20 MB limit" }, 413);
      }
      const mime = file.type || "application/octet-stream";
      const kind = mime.startsWith("image/")
        ? "image"
        : mime.startsWith("audio/")
          ? "audio"
          : null;
      if (!kind) {
        return c.json({ error: "only image and audio uploads are supported" }, 415);
      }

      const id = newId();
      const ext =
        MIME_EXTENSIONS[mime] ??
        (path.extname(file.name).toLowerCase().match(/^\.[a-z0-9]{1,8}$/)?.[0] ?? "");
      const filename = `${id}${ext}`;
      const bytes = Buffer.from(await file.arrayBuffer());
      const disk = await fs.promises.statfs(services.dataDir);
      if (disk.bavail * disk.bsize - bytes.length < MIN_FREE_DISK_BYTES) {
        return c.json({ error: "storage is low; uploads temporarily unavailable" }, 413);
      }
      // Reserve quota synchronously before the asynchronous write. Concurrent uploads
      // see reservations too, so they cannot all pass the same remaining quota.
      const attachment = db.transaction(() => {
        const used = db.prepare("SELECT COALESCE(SUM(size), 0) AS bytes FROM attachments WHERE workspace_id = ?")
          .get(workspaceId) as { bytes: number };
        if (used.bytes + bytes.length > WORKSPACE_UPLOAD_QUOTA) return null;
        return insertAttachmentRow(db, workspaceId, {
          id,
          kind,
          name: file.name || filename,
          mime,
          size: bytes.length,
          path: filename,
        });
      })();
      if (!attachment) return c.json({ error: "workspace upload quota exceeded" }, 413);
      try {
        await fs.promises.writeFile(path.join(uploadsDir, filename), bytes, { flag: "wx" });
      } catch (error) {
        db.prepare("DELETE FROM attachments WHERE workspace_id = ? AND id = ?").run(workspaceId, id);
        await fs.promises.rm(path.join(uploadsDir, filename), { force: true });
        throw error;
      }
      return c.json(attachment, 201);
    },
  );

  app.get("/api/files/:id", async (c) => {
    const { workspaceId } = c.get("ctx");
    const row = getAttachmentRow(db, workspaceId, c.req.param("id"));
    if (!row) return c.json({ error: "file not found" }, 404);
    const filePath = path.join(uploadsDir, path.basename(row.path));
    let bytes: Buffer;
    try {
      bytes = await fs.promises.readFile(filePath);
    } catch {
      return c.json({ error: "file not found" }, 404);
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": row.mime,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${row.name.replace(/[^\w .()-]/g, "_")}"`,
        // Uploads are user content on our origin: never let one run script
        // (an SVG opened directly) or be sniffed into something executable.
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  });

  return app;
}
