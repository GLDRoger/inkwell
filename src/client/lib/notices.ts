import { useSyncExternalStore } from "react";

/**
 * Short notices from work that outlives the screen that started it: a photo
 * being read, a cover failing to paint. One list for the whole app, shown by
 * <Notices /> in the shell.
 */
export interface Notice {
  id: string;
  text: string;
  /** busy: still working (stays until updated); done and error dismiss themselves. */
  tone: "busy" | "done" | "error";
}

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

/** Show a notice, or update the one with the same id. Returns its id. */
export function notify(notice: Omit<Notice, "id"> & { id?: string }): string {
  const id = notice.id ?? `n${++next}`;
  const item: Notice = { id, text: notice.text, tone: notice.tone };
  publish(notices.some((n) => n.id === id) ? notices.map((n) => (n.id === id ? item : n)) : [...notices, item].slice(-3));
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (item.tone !== "busy") timers.set(id, setTimeout(() => dismiss(id), item.tone === "error" ? 9000 : 5000));
  return id;
}

export function useNotices(): Notice[] {
  return useSyncExternalStore(
    (l) => (subs.add(l), () => subs.delete(l)),
    () => notices,
  );
}
