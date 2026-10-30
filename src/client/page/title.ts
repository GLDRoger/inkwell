import type { Page } from "@shared/types";

/**
 * The title to save when the title field loses focus or the typing pause
 * ends, or null to save nothing. Only what the person typed is saved, so a
 * blur can't undo an agent's rename that arrived while the field had focus.
 */
export function titleToSave({ edited, value, serverTitle }: { edited: boolean; value: string; serverTitle: string }): string | null {
  if (!edited) return null;
  return value === serverTitle ? null : value;
}

/** Seeded demo pages were all written in the same moment the notebook was made, and never since. */
export function isUntouchedSeed(page: Pick<Page, "createdAt" | "updatedAt" | "updatedBy">, pages: Pick<Page, "createdAt">[]): boolean {
  if (page.updatedBy.kind !== "agent" || page.createdAt !== page.updatedAt) return false;
  const first = Math.min(...pages.map((p) => Date.parse(p.createdAt)).filter((t) => !Number.isNaN(t)));
  const made = Date.parse(page.createdAt);
  return Number.isFinite(first) && !Number.isNaN(made) && made - first < 5_000;
}

/**
 * The title as the person types it: saved after a pause, on blur, on Enter,
 * and when the field goes away (Back, a link, the tab hiding) so a quick
 * rename is never lost. Kept free of React so the timing can be tested.
 */
export class TitleDraft {
  private edited = false;
  private value = "";
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly opts: { serverTitle(): string; save(title: string): void; delay?: number },
  ) {}

  /** The person typed. */
  type(value: string) {
    this.edited = true;
    this.value = value;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.opts.delay ?? 600);
  }

  /** True while there's typing the server hasn't been sent. */
  get pending(): boolean {
    return this.edited;
  }

  /** Save now, if there's anything worth saving. */
  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const next = titleToSave({ edited: this.edited, value: this.value, serverTitle: this.opts.serverTitle() });
    this.edited = false;
    if (next != null) this.opts.save(next);
  }
}
