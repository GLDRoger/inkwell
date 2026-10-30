import { useCallback, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { Id, Page } from "@shared/types";
import { ApiError, DEMO_READ_ONLY, api, isDemoReadOnly, isNotConnected } from "./api";
import { inDemo } from "./demo";
import { activeModelName, hasKey } from "./key";
import { openKeyDialog } from "./ui";
import { emit } from "./events";
import { holdArrivals, releaseArrivals } from "./arrivals";
import { dismiss, notify } from "./notices";
import { keys } from "./queries";

/**
 * The Meta media flows from the person's side: a cover painted by Muse Image,
 * a photo of notes turned into cards, speech turned into words. Errors come
 * back as one plain sentence about what to do next.
 */
export type MediaKind = "photo" | "voice" | "cover";

/** Why the key dialog opened, from the action that needed it. */
export const NEEDS_KEY: Record<MediaKind | "diary", string> = {
  photo: "Reading a photo uses Meta's models. Add your key to try it.",
  voice: "Voice uses Meta's models. Add your key to try it, or type instead.",
  cover: "Making a cover uses Meta's models. Add your key to try it.",
  diary: "The agents use Meta's models. Add your key and they'll write back.",
};

/**
 * Before an AI action: in the demo, say it's read-only; without any Meta key,
 * open the key dialog. Returns whether the action may go ahead.
 */
export function readyForAi(kind: MediaKind | "diary", me?: MeWithModels): boolean {
  if (inDemo()) {
    notify({ tone: "done", id: "demo-read-only", text: DEMO_READ_ONLY });
    return false;
  }
  if (!modelsConnected(me)) {
    openKeyDialog(NEEDS_KEY[kind]);
    return false;
  }
  return true;
}

/** After an AI request failed: "not connected" opens the key dialog instead of an error. Returns whether it handled it. */
export function handledAiRefusal(error: unknown, kind: MediaKind | "diary"): boolean {
  if (isNotConnected(error)) {
    refused = true;
    openKeyDialog(NEEDS_KEY[kind]);
    return true;
  }
  if (isDemoReadOnly(error)) {
    notify({ tone: "done", id: "demo-read-only", text: DEMO_READ_ONLY });
    return true;
  }
  return false;
}

const FALLBACK: Record<MediaKind, string> = {
  photo: "Couldn't read that photo. Try again in a moment.",
  voice: "Couldn't hear that. Try again, or type it.",
  cover: "Couldn't make a cover just now. Try again in a moment.",
};

export function mediaErrorCopy(error: unknown, kind: MediaKind): string {
  const status = error instanceof ApiError ? error.status : -1;
  const message = error instanceof Error ? error.message : "";
  switch (status) {
    case 0:
      return "Couldn't reach the notebook. Check your connection and try again.";
    case 403:
      if (isDemoReadOnly(error)) return DEMO_READ_ONLY;
      return FALLBACK[kind];
    case 503:
      if (isNotConnected(error)) {
        refused = true;
        return NEEDS_KEY[kind];
      }
      return FALLBACK[kind];
    case 413:
      if (error instanceof ApiError && (error.code === "storage_low" || error.code === "upload_limit")) return message;
      return kind === "voice" ? "That recording is too long. Keep it under ten minutes." : "That photo is too big. Try one under 20 MB.";
    case 415:
      return kind === "voice"
        ? "Your browser recorded sound Inkwell can't read. Type instead."
        : "Inkwell can read PNG, JPEG, WebP or GIF photos. Try one of those.";
    case 422:
      return "Couldn't find any notes to read in that photo. Try a closer, sharper shot.";
    case 404:
      return kind === "cover" ? "This page isn't in your notebook any more." : kind === "photo" ? "That photo didn't upload. Try again." : FALLBACK[kind];
    case 400:
      if (kind === "voice") return /10-minute/.test(message) ? "That recording is too long. Keep it under ten minutes." : "Didn't catch that. Try again a little closer to the mic, or type instead.";
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
export async function paintCover(page: Pick<Page, "id" | "title">, me?: MeWithModels): Promise<boolean> {
  if (painting.has(page.id)) return false;
  if (!readyForAi("cover", me ?? meNow())) return false;
  painting.add(page.id);
  paintChanged();
  try {
    const updated = await api.illustrate(page.id);
    emit({ type: "page.updated", page: updated });
    return true;
  } catch (e) {
    if (!handledAiRefusal(e, "cover")) notify({ tone: "error", text: mediaErrorCopy(e, "cover") });
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
  if (!readyForAi("photo", meNow())) return;
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
    const { pages, segmentedBy } = await api.importPhoto(attachment.id);
    for (const page of pages) emit({ type: "page.created", page });
    ids = pages.map((p) => p.id);
    const notes = pages.length - 1;
    // Quiet provenance: which Meta models did the reading.
    const placed = notes === 1 ? "One note is on the map." : `${notes} notes are on the map.`;
    const model = activeModelName();
    notify({ id, tone: "done", text: `${placed} ${segmentedBy ? `Read by SAM 3.1 + ${model}.` : `Read by ${model}.`}` });
    show(ids);
  } catch (e) {
    if (handledAiRefusal(e, "photo")) dismiss(id);
    else notify({ id, tone: "error", text: mediaErrorCopy(e, "photo") });
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

// ---------------------------------------------------------------- are Meta's models connected?

/** What the server says about its Meta models: the `metaConnected` flag on GET /api/me. */
export type MeWithModels = { metaConnected?: boolean } | null | undefined;

/** A media request came back "not connected" (503) during this visit. */
let refused = false;

/**
 * Can this notebook reach Meta's models? Decided synchronously, so the photo
 * picker can still open inside the click that asked for it (browsers block a
 * file picker opened later). Yes with a key in this browser, or when the
 * server has its own; without the server's flag, a "not connected" answer
 * this visit means no. Unknown counts as yes: the request itself then explains.
 */
export function modelsConnected(me?: MeWithModels): boolean {
  if (hasKey()) return true;
  if (typeof me?.metaConnected === "boolean") return me.metaConnected;
  return !refused;
}

/** The cached GET /api/me, for actions that start outside React (set by the shell). */
let meSource: () => MeWithModels = () => undefined;
export const setMeSource = (fn: () => MeWithModels) => {
  meSource = fn;
};
const meNow = () => meSource();

/** Forget what we learned (tests). */
export const resetModelsConnected = () => {
  refused = false;
};

/** Pick (or take) a photo and import it, then fly the map to the new cards. */
export function usePhotoImport(): (file?: File) => void {
  const navigate = useNavigate();
  const client = useQueryClient();
  return useCallback(
    (file?: File) => {
      const run = (f: File) => void importPhoto(f, (ids) => navigate(`/?focus=${ids.join(",")}`));
      if (file) return run(file);
      // In the demo, or without Meta's models, say so now instead of after they've chosen a photo.
      if (readyForAi("photo", client.getQueryData<MeWithModels>(keys.me))) pickPhoto(run);
    },
    [navigate, client],
  );
}
