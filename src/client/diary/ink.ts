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
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#+\s+/, "");
}

marked.setOptions({ gfm: true, breaks: true });

/** Markdown to sanitised HTML; internal page links stay in-app. */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target"], FORBID_TAGS: ["style", "form", "input"] });
}

/** Characters per second for the reveal: a calm hand, speeding up when far behind. */
export function revealRate(behind: number, inHand: boolean): number {
  const base = inHand ? 42 : 140;
  return base + Math.max(0, behind - (inHand ? 40 : 200)) * 2.5;
}
