import fs from "node:fs/promises";
import path from "node:path";
import { insertAttachmentRow, newId } from "../db.ts";
import type { Services } from "../services.ts";
import type { SessionCtx } from "../session.ts";
import { mediaError, record, type MetaClient } from "./meta.ts";

export async function illustratePage(services: Services, ctx: SessionCtx, id: string, meta: MetaClient) {
  const page = services.pages.getPage(ctx.workspaceId, id);
  if (!page) mediaError("page not found", 404);
  meta.requireKey();
  // PNG must be explicit: https://dev.meta.ai/docs/api-reference/images/schemas
  const result = record(await meta.post("/images/generations", {
    model: process.env.META_IMAGE_MODEL ?? "muse-image-1.0",
    prompt: `Create an antique parchment map vignette, iron-gall ink and watercolour, no text. Illustrate the subject of this notebook page, without letters or labels.\nTitle: ${page.title.slice(0, 500)}\nExcerpt: ${page.excerpt.slice(0, 600)}`,
    response_format: "b64_json",
    output_format: "png",
  }));
  const item = record(Array.isArray(result.data) ? result.data[0] : result);
  let bytes: Buffer;
  if (typeof item.b64_json === "string") {
    if (item.b64_json.length > 28 * 1024 * 1024) mediaError("Generated image exceeds the size limit");
    bytes = Buffer.from(item.b64_json, "base64");
  } else if (typeof item.url === "string") {
    bytes = await meta.downloadImage(item.url);
  } else mediaError("Meta returned no image");
  if (bytes.length > 20 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    mediaError("Meta did not return a valid PNG image");
  }
  // The page may have been deleted while generation was in flight.
  if (!services.pages.getPage(ctx.workspaceId, id)) mediaError("page not found", 404);
  const attachmentId = newId();
  const filename = `${attachmentId}.png`;
  const filePath = path.join(services.uploadsDir, filename);
  await fs.writeFile(filePath, bytes, { flag: "wx" });
  try {
    return services.db.transaction(() => {
      const attachment = insertAttachmentRow(services.db, ctx.workspaceId, {
        id: attachmentId, kind: "image", name: `${page.title.slice(0, 100) || "Illustration"}.png`,
        mime: "image/png", size: bytes.length, path: filename,
      });
      // updatePage owns the workspace-scoped page.updated event.
      const updated = services.pages.updatePage(ctx.workspaceId, ctx.person, id, { coverUrl: attachment.url });
      if (!updated) mediaError("page not found", 404);
      return updated;
    })();
  } catch (error) {
    await fs.unlink(filePath);
    throw error;
  }
}
