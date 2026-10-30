import { useSyncExternalStore } from "react";

/**
 * Short notices from work that outlives the screen that started it: a photo
 * being read, a cover failing to paint, a page you can still undo deleting.
 * One list for the whole app, shown by <Notices /> in the shell.
 */
export interface Notice {
  id: string;
  text: string;
  /** busy: still working (stays until updated); done and error dismiss themselves. */
  tone: "busy" | "done" | "error";
  /** One button beside the text, e.g. Undo. Running it dismisses the notice. */
  action?: { label: string; run(): void };
  /** Keep showing after the person moves to another screen (default: only busy notices do). */
  persist?: boolean;
  /** How long a done or error notice stays, ms. */
  duration?: number;
  /** Stay until dismissed in code or by the person (the owner runs its own clock, e.g. an undo window). */
  sticky?: boolean;
  /** The pointer or keyboard focus arrived on the notice: the person is reading it. */
  onHold?(): void;
  /** ...and left again. */
  onRelease?(): void;
  /** The person closed it with its × button (not called when it times out or is replaced). */
  onClose?(): void;
}

const MAX_SHOWN = 3;
let notices: Notice[] = [];
const subs = new Set<() => void>();
interface Clock {
  timer?: ReturnType<typeof setTimeout>;
  /** When it will dismiss itself, while running. */
  due: number;
  /** Time left while held. */
  left: number;
  holds: number;
}
const clocks = new Map<string, Clock>();
let next = 0;

const publish = (list: Notice[]) => {
  notices = list;
  subs.forEach((l) => l());
};

function stopClock(id: string) {
  const c = clocks.get(id);
  if (c) clearTimeout(c.timer);
  clocks.delete(id);
}

/** A notice the person can act on (Undo) is never pushed out by newer ones. */
const droppable = (n: Notice) => n.tone !== "busy" && !n.action;

export function dismiss(id: string) {
  stopClock(id);
  if (notices.some((n) => n.id === id)) publish(notices.filter((n) => n.id !== id));
}

/** The person closed it: tell its owner, then remove it. */
export function close(id: string) {
  const n = notices.find((x) => x.id === id);
  dismiss(id);
  n?.onClose?.();
}

/** Pause a notice's clock while it's hovered or focused. Holds nest; see release(). */
export function hold(id: string) {
  const n = notices.find((x) => x.id === id);
  const c = clocks.get(id);
  if (!n || !c) return;
  if (c.holds++ === 0) {
    clearTimeout(c.timer);
    c.timer = undefined;
    c.left = Math.max(0, c.due - Date.now());
    n.onHold?.();
  }
}

/** Undo one hold(); the clock restarts with the time it had left once nothing holds it. */
export function release(id: string) {
  const n = notices.find((x) => x.id === id);
  const c = clocks.get(id);
  if (!n || !c || c.holds === 0) return;
  if (--c.holds === 0) {
    run(id, n, c, c.left);
    n.onRelease?.();
  }
}

function run(id: string, n: Notice, c: Clock, ms: number) {
  clearTimeout(c.timer);
  c.timer = undefined;
  if (n.tone === "busy" || n.sticky) return;
  c.due = Date.now() + ms;
  c.timer = setTimeout(() => dismiss(id), ms);
}

/** Clear what belonged to the last screen: everything except busy work and notices marked persist. */
export function dismissForNavigation() {
  for (const n of notices) if (n.tone !== "busy" && !n.persist) dismiss(n.id);
}

/**
 * Show a notice, or update the one with the same id. A notice with the same
 * text and tone as one already showing replaces it rather than stacking.
 * Returns its id.
 */
export function notify(notice: Omit<Notice, "id"> & { id?: string }): string {
  const twin = notice.id ? undefined : notices.find((n) => n.text === notice.text && n.tone === notice.tone);
  const id = notice.id ?? twin?.id ?? `n${++next}`;
  const item: Notice = { ...notice, id };
  const list = notices.some((n) => n.id === id) ? notices.map((n) => (n.id === id ? item : n)) : [...notices, item];
  // Too many: drop the oldest finished one. Busy work and anything with a button stay, even past the limit.
  while (list.length > MAX_SHOWN) {
    const drop = list.findIndex((n) => n.id !== id && droppable(n));
    if (drop < 0) break;
    stopClock(list.splice(drop, 1)[0].id);
  }
  publish(list);
  const clock = clocks.get(id) ?? { due: 0, left: 0, holds: 0 };
  clocks.set(id, clock);
  const ms = item.duration ?? (item.tone === "error" ? 8000 : 5000);
  // Updated while someone is reading it: keep it paused, with a fresh clock for when they leave.
  if (clock.holds > 0) {
    clearTimeout(clock.timer);
    clock.timer = undefined;
    clock.left = ms;
  } else run(id, item, clock, ms);
  return id;
}

export const getNotices = () => notices;

export function useNotices(): Notice[] {
  return useSyncExternalStore(
    (l) => (subs.add(l), () => subs.delete(l)),
    () => notices,
  );
}
