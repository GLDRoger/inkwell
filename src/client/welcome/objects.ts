/**
 * The welcome's still life: everyday things from the demo notebook's world
 * (a Lisbon trip, a launch plan, reading notes, recipes). Images are painted by
 * scripts/paint-objects.mjs into public/objects/<id>.webp.
 *
 * x/y: centre, in % of the viewport. w: width in px at the reference size
 * (scaled by --k). r: resting tilt in degrees. ratio: width / height of the image.
 */
export interface Placed {
  id: string;
  ratio: number;
  x: number;
  y: number;
  w: number;
  r?: number;
}

const RATIO: Record<string, number> = {
  "boarding-pass": 400 / 226,
  camera: 400 / 287,
  espresso: 400 / 365,
  glasses: 400 / 211,
  lemon: 365 / 400,
  nata: 400 / 326,
  paperback: 400 / 347,
  pen: 398 / 400,
  phone: 400 / 383,
  plant: 374 / 400,
  sardines: 400 / 390,
  sourdough: 400 / 351,
  "sticky-notes": 400 / 298,
  tile: 400 / 349,
};

const at = (id: string, x: number, y: number, w: number, r = 0): Placed => ({ id, ratio: RATIO[id], x, y, w, r });

/** A loose ring around the centred text, wide screens. */
export const WIDE: Placed[] = [
  at("boarding-pass", 13, 20, 150, -8),
  at("pen", 29, 11, 92),
  at("nata", 46, 10, 96),
  at("sticky-notes", 63, 12, 100, 6),
  at("camera", 80, 19, 136, -4),
  at("phone", 93, 32, 84, 6),
  at("espresso", 86, 53, 110),
  at("lemon", 89, 76, 82, -6),
  at("tile", 73, 85, 100, 8),
  at("sourdough", 55, 89, 140),
  at("paperback", 37, 88, 120, -10),
  at("sardines", 21, 80, 116, 4),
  at("plant", 8, 61, 100),
  at("glasses", 17, 42, 120, -6),
];

/** A row above and a row below the text, phones. */
export const NARROW: Placed[] = [
  at("nata", 17, 12, 84),
  at("boarding-pass", 52, 8, 124, -6),
  at("espresso", 85, 13, 80),
  at("sourdough", 19, 88, 110),
  at("tile", 53, 91, 80, 8),
  at("lemon", 85, 86, 68, -6),
];
