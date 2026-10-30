/**
 * One click focuses a card; two quick clicks on the same card open it. The
 * single click waits a moment before acting, so the camera doesn't fly the
 * card out from under the second click of a double-click (which is what made
 * opening a page take two steps). Timed by hand rather than with `dblclick`,
 * so a double tap on a phone opens a page too.
 */
export const DOUBLE_MS = 280;

export class ClickIntent {
  private pending: { id: string; at: number; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(
    private onSingle: (id: string) => void,
    private onDouble: (id: string) => void,
    private wait = DOUBLE_MS,
  ) {}

  click(id: string, at = Date.now()) {
    const p = this.pending;
    if (p) {
      clearTimeout(p.timer);
      this.pending = null;
      if (p.id === id && at - p.at <= this.wait) {
        this.onDouble(id);
        return;
      }
    }
    const timer = setTimeout(() => {
      this.pending = null;
      this.onSingle(id);
    }, this.wait);
    this.pending = { id, at, timer };
  }

  cancel() {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }
}

/**
 * Whether a click on card `id` at zoom `s` opens it: it does when that card
 * was the last one brought close and the map is still at (about) the zoom it
 * was brought to. So from anywhere, a page opens on the second click or tap.
 */
export function opensOnClick(chosen: { id: string; s: number } | null, id: string, s: number): boolean {
  return !!chosen && chosen.id === id && Math.abs(Math.log(s / chosen.s)) < 0.25;
}
