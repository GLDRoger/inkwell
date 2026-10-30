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
}

const MAX_SHOWN = 3;
let notices: Notice[] = [];
const subs = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let next = 0;

const publish = (list: Notice[]) => {
  notices = list;
  subs.forEach((l) => l());
};

export function dismiss(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (notices.some((n) => n.id === id)) publish(notices.filter((n) => n.id !== id));
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
  // Too many: drop the oldest that isn't still working.
  while (list.length > MAX_SHOWN) {
    const drop = list.findIndex((n) => n.tone !== "busy");
    const gone = list.splice(drop < 0 ? 0 : drop, 1)[0];
    clearTimeout(timers.get(gone.id));
    timers.delete(gone.id);
  }
  publish(list);
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (item.tone !== "busy") timers.set(id, setTimeout(() => dismiss(id), item.duration ?? (item.tone === "error" ? 8000 : 5000)));
  return id;
}

export const getNotices = () => notices;

export function useNotices(): Notice[] {
  return useSyncExternalStore(
    (l) => (subs.add(l), () => subs.delete(l)),
    () => notices,
  );
}
