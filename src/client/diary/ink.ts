import { marked } from "marked";
import DOMPurify from "dompurify";

/**
 * Where an agent's handwriting stops and the legible serif takes over.
 * The opening lines are written by hand; the rest reads as a normal document.
 * Decided from the prefix only, so the cut doesn't move as more text streams in.
 */
export const HAND_MIN = 60;
export const HAND_MAX = 240;

export function handCut(text: string): number {
  // A block break (blank line, list, heading, code fence, table) ends the handwriting.
  const block = text.search(/\n\s*\n|\n\s*(?:[-*+]\s|\d+\.\s|#{1,6}\s|```|\|)/);
  // A leading block (the reply opens with a list or heading) gets no handwriting at all.
  if (/^\s*(?:[-*+]\s|\d+\.\s|#{1,6}\s|```|\|)/.test(text)) return 0;
  const limit = block === -1 ? text.length : block;
  if (limit <= HAND_MAX) {
    // Short enough: but if it's long, still stop at the first sentence end past HAND_MIN.
    const sentence = firstSentenceEnd(text, HAND_MIN, limit);
    return sentence ?? limit;
  }
  const sentence = firstSentenceEnd(text, HAND_MIN, HAND_MAX);
  if (sentence != null) return sentence;
  const space = text.lastIndexOf(" ", HAND_MAX);
  return space > HAND_MIN ? space + 1 : HAND_MAX;
}

function firstSentenceEnd(text: string, from: number, to: number): number | null {
  const re = /[.!?…]["”’)]?\s/g;
  re.lastIndex = from;
  const m = re.exec(text);
  return m && m.index + m[0].length <= to ? m.index + m[0].length : null;
}

/** Inline markdown is ink, not syntax, in the handwritten part. */
export function stripInline(md: string): string {
  return handSegments(md)
    .map((s) => s.text)
    .join("");
}

/** A run of handwriting: plain ink, or a link that stays clickable while it's written. */
export interface HandSegment {
  text: string;
  href?: string;
}

const SAFE_HREF = /^(\/(?!\/)|#|https?:\/\/|mailto:)/i;

/**
 * The handwritten part as segments: emphasis and code lose their syntax, links
 * keep their target so a short reply like "Done, see [Billing](/p/b1)." still
 * opens Billing. Unsafe targets (javascript:, data:, …) become plain ink.
 */
export function handSegments(md: string): HandSegment[] {
  const plain = (t: string) =>
    t
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(\*|_)(.+?)\1/g, "$2")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*|__/g, "");
  // Pull links out first (as placeholders) so emphasis around them, or underscores in their targets, don't break them.
  const links: HandSegment[] = [];
  const src = md
    .replace(/^#+\s+/, "")
    .replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))*)(?:\s+"[^"]*")?\)/g, (_, label: string, href: string) => {
      links.push(SAFE_HREF.test(href) ? { text: plain(label), href } : { text: plain(label) });
      return `\u0000${links.length - 1}\u0000`;
    });
  const out: HandSegment[] = [];
  const push = (seg: HandSegment) => {
    if (!seg.text) return;
    const last = out[out.length - 1];
    if (last && !last.href && !seg.href) last.text += seg.text;
    else out.push(seg);
  };
  plain(src)
    .split(/\u0000(\d+)\u0000/)
    .forEach((part, i) => push(i % 2 ? links[Number(part)] : { text: part }));
  return out;
}

/** The first `n` characters of some segments (for revealing them stroke by stroke). */
export function sliceSegments(segs: HandSegment[], n: number): HandSegment[] {
  const out: HandSegment[] = [];
  let left = n;
  for (const s of segs) {
    if (left <= 0) break;
    const chars = Array.from(s.text);
    out.push({ ...s, text: chars.slice(0, left).join("") });
    left -= chars.length;
  }
  return out;
}

marked.setOptions({ gfm: true, breaks: true });

/** Markdown to sanitised HTML; internal page links stay in-app. */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target"], FORBID_TAGS: ["style", "form", "input"] });
}

/** Characters per second for the reveal: a calm hand, speeding up when far behind. */
export function revealRate(behind: number, inHand: boolean): number {
  // Quick enough to feel like magic rather than a wait: a one-line reply is written in about a second.
  const base = inHand ? 72 : 220;
  return base + Math.max(0, behind - (inHand ? 30 : 160)) * 3;
}
