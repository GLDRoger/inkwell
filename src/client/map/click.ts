/**
 * One click peeks a card (opens it in the panel beside the map); two quick
 * clicks on the same card open the full page. The single click waits a moment
 * before acting, so a double-click doesn't flash the peek open first. Timed
 * by hand rather than with `dblclick`, so a double tap on a phone opens a
 * page too.
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
