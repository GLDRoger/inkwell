import type { Run } from "@shared/types";
import type { TraitOverrides } from "blobatar";

/**
 * What an agent's avatar shows, and who it looks like. Pure, so it's tested
 * without a browser. The component is `AgentAvatar.tsx`.
 */

/** What the agent is doing. `done` is the brief happy beat after it finishes; `failed`, a step that didn't work. */
export type AvatarState = "idle" | "thinking" | "reading" | "writing" | "done" | "failed";

/** Which way the page it's reading lies, so its eyes can turn to it. */
export type Look = "up" | "down" | "left" | "right";

export const BUSY: ReadonlySet<AvatarState> = new Set(["thinking", "reading", "writing"]);

/**
 * Each agent is its own creature, not just its own colour. Positions are
 * blobatar's 0-1 trait positions (shape bands in `blobatar/src/styles/blob.ts`:
 * organic 0.22-0.48, droplet 0.86-0.915, hexagon 0.915-0.95).
 *
 * - Wren writes: an ink drop, like the brand's mark.
 * - Atlas organises: a level hexagon, a tile in a tidy floor.
 * - Scout researches: a lopsided pebble, picked up on the trail. (A triangle
 *   read as a warning sign at map sizes.)
 */
const CAST: Record<string, TraitOverrides> = {
  wren: { shape: 0.89, "droplet.tip": 0.4, "eye.scale": 0.75 },
  atlas: { shape: 0.935, "body.rot": 0.5, "poly.round": 0.8, "eye.scale": 0.7 },
  scout: { shape: 0.35, "eye.scale": 0.8 },
};

/** The pinned traits for an agent by name; any other name gets the creature its name hashes to. */
export const castOf = (name: string): TraitOverrides | undefined => CAST[name.trim().toLowerCase()];

const WRITES = /write|edit|create|append|insert|update|move|rename/i;

/** A run's state for its agent's avatar: the same reading of its last step the map uses. */
export function runState(run: Pick<Run, "status" | "steps"> | null | undefined): AvatarState {
  if (!run) return "idle";
  if (run.status === "failed") return "failed";
  if (run.status !== "queued" && run.status !== "running") return "idle";
  const last = run.steps[run.steps.length - 1];
  if (!last) return "thinking";
  if (!last.ok) return "failed";
  return WRITES.test(last.tool) ? "writing" : "reading";
}

// ------------------------------------------------------------------ colour

type Rgb = [number, number, number];
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLin = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLin(v / 255)) as Rgb;
}

function toOklab([r, g, b]: Rgb): Rgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: Rgb): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return "#" + rgb.map((c) => Math.round(Math.min(1, Math.max(0, fromLin(c))) * 255).toString(16).padStart(2, "0")).join("");
}

/** `color-mix(in oklab, a p, b)`, in hex: blobatar writes its colours as SVG fills, where page CSS can't reach. */
export function mixOklab(a: string, b: string, p: number): string | null {
  const x = hexRgb(a);
  const y = hexRgb(b);
  if (!x || !y) return null;
  const A = toOklab(x);
  const B = toOklab(y);
  return fromOklab([0, 1, 2].map((i) => A[i] * p + B[i] * (1 - p)) as Rgb);
}

/**
 * The avatar's body and eyes for an agent's ink. Light: the ink itself with
 * paper-white eyes. Dark: the ink lifted the way DESIGN.md lifts it
 * (55% toward #f2f1ed) with near-black eyes.
 */
export function inkPalette(color: string, dark: boolean): { head: string; eye: string } {
  const head = (dark ? mixOklab(color, "#f2f1ed", 0.55) : mixOklab(color, color, 1)) ?? (dark ? "#b3b1ab" : "#8e8b84");
  return { head, eye: dark ? "#161513" : "#fbfaf7" };
}
