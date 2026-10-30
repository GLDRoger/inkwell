import type { Cam } from "./camera";

/**
 * Where the map's camera was, remembered for this tab (sessionStorage) so
 * coming back from a page lands where you left. Tagged with the notebook it
 * belongs to: the demo's camera must never be restored over the visitor's own
 * pages (a map that settles just as "Try it yourself" switches notebooks
 * would otherwise save the demo's view after the switch cleared it).
 */
export function encodeCamera(c: Cam, notebook: string): string {
  return JSON.stringify({ x: c.x, y: c.y, s: c.s, nb: notebook });
}

export function decodeCamera(raw: string | null, notebook: string): Cam | null {
  try {
    const c = JSON.parse(raw ?? "null");
    if (!c || c.nb !== notebook) return null;
    return [c.x, c.y, c.s].every((n) => typeof n === "number" && Number.isFinite(n)) ? { x: c.x, y: c.y, s: c.s } : null;
  } catch {
    return null;
  }
}
