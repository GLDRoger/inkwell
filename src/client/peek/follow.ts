import type { Id } from "@shared/types";
import type { Cam, Insets } from "../map/camera";

/**
 * The demo camera. While the recorded demo plays, the map follows what the
 * demo points at (`focus` in lib/demo.ts): it flies to the agent, or the page
 * being worked on, and opens the page in the peek panel once an agent writes
 * there. It never fights the viewer: moving the map, or peeking a page of
 * your own, pauses following for a while.
 */
export const FOLLOW_PAUSE_MS = 8000;

export class FollowGate {
  private until = 0;
  constructor(private ms = FOLLOW_PAUSE_MS) {}
  /** The viewer took the wheel. */
  pause(now: number) {
    this.until = now + this.ms;
  }
  active(now: number) {
    return now >= this.until;
  }
  /** How long until following resumes, ms (0 when it's on). */
  resumesIn(now: number) {
    return Math.max(0, this.until - now);
  }
  reset() {
    this.until = 0;
  }
}

export interface FollowWalker {
  pageId: Id | null;
  action: string;
}

export interface FollowInput {
  focus: { pageId?: Id; agentId?: Id };
  /** Agents' walkers by agent id. */
  agentAt(agentId: Id): FollowWalker | undefined;
  hasPage(id: Id): boolean;
  /** Pages an agent is writing on right now. */
  writing: { has(id: Id): boolean };
}

/**
 * Where to look and what to peek for a demo focus. The camera goes to the
 * focused agent's page while it walks, else to the focused page. The peek
 * opens on the focused page once someone writes there (or straight away when
 * the step names a page and no agent, like a new cover), else on whatever
 * page the focused agent is writing in. Pages that aren't on the map yet
 * (being created this moment) are skipped until they arrive.
 */
export function followTarget(i: FollowInput): { pageId: Id | null; peek: Id | null } {
  const { focus } = i;
  const w = focus.agentId ? i.agentAt(focus.agentId) : undefined;
  const agentPage = w?.pageId && i.hasPage(w.pageId) ? w.pageId : null;
  const focusPage = focus.pageId && i.hasPage(focus.pageId) ? focus.pageId : null;
  let peek: Id | null = null;
  if (focusPage && (i.writing.has(focusPage) || !focus.agentId)) peek = focusPage;
  else if (agentPage && w!.action === "writing") peek = agentPage;
  return { pageId: agentPage ?? focusPage, peek };
}

export interface CardRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The camera that shows `box` in the part of the screen the chrome and the
 * peek panel leave free, or null when it's already in view and big enough.
 * It zooms in to at least `minScale` (where cards say what they hold), never
 * further than fits the card, and otherwise keeps the zoom you chose.
 */
export function peekCamera(box: CardRect, cam: Cam, vw: number, vh: number, insets: Insets, minScale: number, margin = 16): Cam | null {
  const freeW = vw - insets.left - insets.right;
  const freeH = vh - insets.top - insets.bottom;
  if (freeW <= 0 || freeH <= 0) return null;
  const fits = Math.min((freeW - margin * 2) / box.w, (freeH - margin * 2) / box.h);
  const s = Math.min(Math.max(cam.s, minScale), Math.max(fits, 0.05));
  if (Math.abs(Math.log(s / cam.s)) < 0.02) {
    const left = (box.x - cam.x) * cam.s + vw / 2;
    const top = (box.y - cam.y) * cam.s + vh / 2;
    const right = left + box.w * cam.s;
    const bottom = top + box.h * cam.s;
    const inside =
      left >= insets.left + margin * 0.5 &&
      top >= insets.top + margin * 0.5 &&
      right <= vw - insets.right - margin * 0.5 &&
      bottom <= vh - insets.bottom - margin * 0.5;
    if (inside) return null;
  }
  // The card's centre at the centre of the free area.
  const cx = insets.left + freeW / 2;
  const cy = insets.top + freeH / 2;
  return {
    x: box.x + box.w / 2 - (cx - vw / 2) / s,
    y: box.y + box.h / 2 - (cy - vh / 2) / s,
    s,
  };
}
