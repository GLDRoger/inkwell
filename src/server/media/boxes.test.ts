// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSamBoxes } from "./boxes.ts";

/**
 * The real output_text of sam-3.1 on src/server/demo/assets/sticky-notes.jpg (1600×1100),
 * captured from api.meta.ai on 2026-10-30: a "<0f>0" preamble, then per note a
 * <|box;x1=…;y1=…;x2=…;y2=…;w=1600;h=1100|> token followed by its <|mask;…|> token.
 */
const REAL = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/sam-3.1-sticky-notes.txt"), "utf8");

describe("SAM 3.1 native tokens", () => {
  it("parses exactly the five boxes of a real response, ignoring the masks", () => {
    expect(REAL.startsWith("<0f>0<|box;")).toBe(true);
    expect(REAL.match(/<\|mask;/g)).toHaveLength(5);
    const boxes = parseSamBoxes({ output_text: REAL });
    const pixels = boxes.map(([x1, y1, x2, y2]) => [x1 * 1600, y1 * 1100, x2 * 1600, y2 * 1100].map(Math.round));
    expect(pixels).toEqual([
      [842, 562, 1226, 946],
      [333, 593, 718, 978],
      [152, 132, 557, 538],
      [1092, 152, 1478, 537],
      [622, 93, 1017, 487],
    ]);
    for (const box of boxes) for (const v of box) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
  });
});
