import type { Id, Widget } from "../../shared/types";
import type { Box, CardBox } from "./layout";
import { widgetSize } from "./widget-data";

const GAP = 40;

const hits = (a: Box, b: Box, pad = 12) =>
  a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

/**
 * Where each widget is drawn. The server's position is only a hint: it can't
 * see where the map lays out cards that have no saved place. A widget whose
 * stored box covers a card moves to the right of its source cards, down the
 * first free slot, so it never hides the pages it reads.
 */
export function placeWidgets(widgets: Widget[], cards: Map<Id, CardBox>, opts: { strip?: Box } = {}): Map<Id, Box> {
  const out = new Map<Id, Box>();
  if (opts.strip) return stripOf(widgets, opts.strip);
  const taken: Box[] = [...cards.values()];
  // Widgets that are already clear keep their place (people may have dragged them there).
  const blocked: Widget[] = [];
  for (const w of widgets) {
    const box = { x: w.x, y: w.y, ...widgetSize(w.data) };
    if (taken.some((t) => hits(box, t))) blocked.push(w);
    else { out.set(w.id, box); taken.push(box); }
  }
  for (const w of blocked) {
    const size = widgetSize(w.data);
    const sources = w.pageIds.map((id) => cards.get(id)).filter((b): b is CardBox => !!b);
    const anchor = sources.length ? sources : [{ x: w.x - GAP, y: w.y, w: 0, h: 0 }];
    let x = Math.max(...anchor.map((b) => b.x + b.w)) + GAP;
    const top = Math.min(...anchor.map((b) => b.y));
    let box = { x, y: top, ...size };
    for (let tries = 0; taken.some((t) => hits(box, t)) && tries < 60; tries++) {
      // Down the column first, then one column further right.
      if (tries % 6 === 5) { x += size.w + GAP; box = { x, y: top, ...size }; }
      else {
        const below = Math.max(...taken.filter((t) => hits(box, t)).map((t) => t.y + t.h));
        box = { ...box, y: below + GAP };
      }
    }
    out.set(w.id, box);
    taken.push(box);
  }
  return out;
}

/**
 * A phone held upright lays the cards out afresh in a column, so the places
 * widgets were given beside the wide map mean nothing there: they line up in
 * rows above the cards instead (`over`, the cards' bounds), first thing you see.
 */
function stripOf(widgets: Widget[], over: Box): Map<Id, Box> {
  const rows: { w: Widget; size: { w: number; h: number } }[][] = [[]];
  let x = 0;
  for (const w of widgets) {
    const size = widgetSize(w.data);
    if (rows[rows.length - 1].length && x + size.w > over.w) {
      rows.push([]);
      x = 0;
    }
    rows[rows.length - 1].push({ w, size });
    x += size.w + GAP;
  }
  const heights = rows.map((r) => Math.max(0, ...r.map((c) => c.size.h)));
  let y = over.y - GAP - heights.reduce((t, h) => t + h + GAP, 0) + GAP;
  const out = new Map<Id, Box>();
  rows.forEach((r, i) => {
    let cx = over.x;
    for (const c of r) {
      out.set(c.w.id, { x: cx, y, ...c.size });
      cx += c.size.w + GAP;
    }
    y += heights[i] + GAP;
  });
  return out;
}
