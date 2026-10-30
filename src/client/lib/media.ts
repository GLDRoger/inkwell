import { useCallback, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import type { Id, Page } from "@shared/types";
import { ApiError, api } from "./api";
import { emit } from "./events";
import { holdArrivals, releaseArrivals } from "./arrivals";
import { notify } from "./notices";

/**
 * The Meta media flows from the person's side: a cover painted by Muse Image,
 * a photo of notes turned into cards, speech turned into words. Errors come
 * back as one plain sentence about what to do next.
 */
export type MediaKind = "photo" | "voice" | "cover";

const NOT_CONNECTED: Record<MediaKind, string> = {
  photo: "Reading photos needs Meta's models, and this notebook isn't connected to them yet.",
  voice: "Voice needs Meta's models, and this notebook isn't connected to them yet. Type instead.",
  cover: "Painting covers needs Meta's models, and this notebook isn't connected to them yet.",
};

const FALLBACK: Record<MediaKind, string> = {
  photo: "Couldn't read that photo. Try again in a moment.",
  voice: "Couldn't hear that. Try again, or type it.",
  cover: "Couldn't paint a cover just now. Try again in a moment.",
};

export function mediaErrorCopy(error: unknown, kind: MediaKind): string {
  const status = error instanceof ApiError ? error.status : -1;
  const message = error instanceof Error ? error.message : "";
  switch (status) {
    case 0:
      return "Couldn't reach the notebook. Check your connection and try again.";
    case 503:
      return NOT_CONNECTED[kind];
    case 413:
      return kind === "voice" ? "That recording is too long. Keep it under ten minutes." : "That photo is too big. Try one under 20 MB.";
    case 415:
      return kind === "voice"
        ? "Your browser recorded sound Inkwell can't read. Type instead."
        : "Inkwell can read PNG, JPEG, WebP or GIF photos. Try one of those.";
    case 422:
      return "Couldn't find any notes to read in that photo. Try a closer, sharper shot.";
    case 404:
      return kind === "cover" ? "This page has been torn out." : kind === "photo" ? "That photo didn't upload. Try again." : FALLBACK[kind];
    case 400:
      if (kind === "voice") return /10-minute/.test(message) ? "That recording is too long. Keep it under ten minutes." : "Didn't catch any sound. Try again, a little closer.";
      return FALLBACK[kind];
    default:
      return FALLBACK[kind];
  }
}

// ---------------------------------------------------------------- covers

const painting = new Set<Id>();
const paintSubs = new Set<() => void>();
const paintChanged = () => paintSubs.forEach((l) => l());

/** Is a cover being painted for this page right now? */
export function usePainting(pageId: Id): boolean {
  return useSyncExternalStore(
    (l) => (paintSubs.add(l), () => paintSubs.delete(l)),
    () => painting.has(pageId),
  );
}

/** Ask Muse Image for a cover. The page (and its map card) update through the usual page.updated path. */
export async function paintCover(page: Pick<Page, "id" | "title">): Promise<boolean> {
  if (painting.has(page.id)) return false;
  painting.add(page.id);
  paintChanged();
  try {
    const updated = await api.illustrate(page.id);
    emit({ type: "page.updated", page: updated });
    return true;
  } catch (e) {
    notify({ tone: "error", text: mediaErrorCopy(e, "cover") });
    return false;
  } finally {
    painting.delete(page.id);
    paintChanged();
  }
}

// ---------------------------------------------------------------- photo import

let importing = false;

/**
 * Upload a photo of notes, have it read into cards, then hand the new page ids
 * (the parent first) to `show` so the map can fly there while they arrive.
 */
export async function importPhoto(file: File, show: (ids: Id[]) => void, flightMs = 700): Promise<void> {
  if (importing) {
    notify({ tone: "busy", id: "photo-import", text: "Still reading the last photo…" });
    return;
  }
  if (!file.type.startsWith("image/")) {
    notify({ tone: "error", text: mediaErrorCopy(new ApiError(415, ""), "photo") });
    return;
  }
  importing = true;
  const id = notify({ id: "photo-import", tone: "busy", text: "Pinning up your photo…" });
  holdArrivals();
  let ids: Id[] = [];
  try {
    const attachment = await api.upload(file);
    notify({ id, tone: "busy", text: "Reading your notes…" });
    const { pages } = await api.importPhoto(attachment.id);
    for (const page of pages) emit({ type: "page.created", page });
    ids = pages.map((p) => p.id);
    const notes = pages.length - 1;
    // Quiet provenance: which Meta models did the reading.
    const placed = notes === 1 ? "One note is on the map." : `${notes} notes are on the map.`;
    notify({ id, tone: "done", text: `${placed} Read by SAM 3.1 + Muse Spark.` });
    show(ids);
  } catch (e) {
    notify({ id, tone: "error", text: mediaErrorCopy(e, "photo") });
  } finally {
    importing = false;
    releaseArrivals(ids, ids.length ? flightMs : 0);
  }
}

/** Open the system picker for one image (a camera on phones). */
export function pickPhoto(onFile: (file: File) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp,image/gif";
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) onFile(file);
  };
  input.click();
}

/** Pick (or take) a photo and import it, then fly the map to the new cards. */
export function usePhotoImport(): (file?: File) => void {
  const navigate = useNavigate();
  return useCallback(
    (file?: File) => {
      const run = (f: File) => void importPhoto(f, (ids) => navigate(`/?focus=${ids.join(",")}`));
      if (file) run(file);
      else pickPhoto(run);
    },
    [navigate],
  );
}
