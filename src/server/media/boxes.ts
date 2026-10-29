import { record } from "./meta.ts";

/** Normalized corners, with (0,0) at the image's top left. */
export type Box = [number, number, number, number];

export function parseJsonText(text: string): unknown {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as unknown;
}

export function parseBox(value: unknown, width?: number, height?: number): Box | null {
  const object = record(value);
  const raw = Array.isArray(value) ? value : [
    object.x1 ?? object.x_min ?? object.x,
    object.y1 ?? object.y_min ?? object.y,
    object.x2 ?? object.x_max ?? (typeof object.x === "number" && typeof object.width === "number" ? object.x + object.width : undefined),
    object.y2 ?? object.y_max ?? (typeof object.y === "number" && typeof object.height === "number" ? object.y + object.height : undefined),
  ];
  if (raw.length !== 4 || !raw.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const values = raw as number[];
  // JSON adapters sometimes return 0..1 fractions, others a 0..1000 grid.
  // SAM's native tokens always supply source-pixel dimensions explicitly.
  const scale = values.every((v) => v >= 0 && v <= 1) ? 1 : 1000;
  const sx = width ?? scale;
  const sy = height ?? scale;
  if (sx <= 0 || sy <= 0) return null;
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const box: Box = [clamp(values[0]! / sx), clamp(values[1]! / sy), clamp(values[2]! / sx), clamp(values[3]! / sy)];
  return box[2] > box[0] && box[3] > box[1] ? box : null;
}

/** Native SAM token grammar, plus JSON/enveloped boxes for compatible gateways. */
export function parseSamBoxes(value: unknown): Box[] {
  const found: Box[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > 12 || found.length >= 50) return;
    if (typeof node === "string") {
      // https://dev.meta.ai/docs/sam/reading-segmentation
      for (const match of node.matchAll(/<\|box;([^|]+)\|>/g)) {
        const fields = Object.fromEntries(match[1]!.split(";").map((part) => {
          const [key, value] = part.split("=");
          return [key, Number(value)];
        }));
        const box = parseBox(fields, fields.w, fields.h);
        if (box) found.push(box);
        if (found.length >= 50) return;
      }
      if (!node.includes("<|box;")) {
        try { visit(parseJsonText(node), depth + 1); } catch { /* Not JSON geometry. */ }
      }
      return;
    }
    if (Array.isArray(node)) {
      const box = parseBox(node);
      if (box) found.push(box);
      else for (const child of node) visit(child, depth + 1);
      return;
    }
    const object = record(node);
    const box = parseBox(object, typeof object.w === "number" ? object.w : undefined, typeof object.h === "number" ? object.h : undefined);
    if (box) { found.push(box); return; }
    for (const key of ["boxes", "box", "bbox", "bounding_box", "segments", "objects", "data", "output", "content", "text", "output_text"]) {
      if (object[key] !== undefined) visit(object[key], depth + 1);
    }
  };
  visit(value, 0);
  return [...new Map(found.map((box) => [box.join(","), box])).values()].slice(0, 50);
}
