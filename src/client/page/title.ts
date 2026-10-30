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
