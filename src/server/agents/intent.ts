/**
 * Does the person's own request ask for a page to be deleted? Lexical on purpose:
 * it reads only what the person typed, never page text or another agent's request,
 * so an instruction planted in a page can't open it.
 */
const VERB = String.raw`delet\w*|remov\w*|eras\w*|wipe|bin|discard\w*|trash\w*|get rid of|clear out|apag\w*|elimin\w*`;
const PAGE_WORD = String.raw`pages?|notes?|cards?|it|them|this|that|these|those`;
/** Removing these is an edit inside a page, not a deletion. */
const CONTENT = /^(?:the |all |any |my |those |these |some |every )*(?:[\w-]+ ){0,2}(?:typos?|links?|lines?|words?|duplicates?|sentences?|paragraphs?|sections?|headings?|emojis?|bold|formatting|text|commas?|mentions?|tags?|bullets?|spaces?|blank|empty lines?|rows?|items?|tasks?|steps?|placeholders?|repetition|filler)\b(?!\s*(?:pages?|notes?|cards?)\b)/i;
const POLITE = /^\s*(?:(?:hey|hi|ok(?:ay)?|so)[,\s]+)?(?:(?:can|could|would|will) you(?: please)?|please|pls|i(?:'d| would) like you to|i want you to|i need you to|go ahead and|let's)\s+/i;
const NEGATED = new RegExp(String.raw`\b(?:don['’]?t|do not|never|no need to|without|not)\s+(?:\w+\s+){0,2}(?:${VERB})\b`, "i");
const AFFIRM = /^\s*(?:yes|yeah|yep|sure|ok(?:ay)?|go ahead|do it|confirm(?:ed)?|please do|that'?s right|correct)\b/i;

function sentenceAsks(sentence: string): boolean {
  if (NEGATED.test(sentence)) return false;
  const core = sentence.replace(POLITE, "").trim();
  const lead = core.match(new RegExp(String.raw`^(?:${VERB})\b\s*(.*)$`, "i"));
  if (lead) return !CONTENT.test(lead[1]!);
  const near = sentence.match(new RegExp(String.raw`\b(?:${VERB})\b\s*(.{0,40}?)\b(?:${PAGE_WORD})\b`, "i"));
  return !!near && !CONTENT.test(near[1]!);
}

export function asksToDelete(text: string): boolean {
  return text.split(/(?<=[.!?])\s+|\n+/).some(sentenceAsks);
}

/** The request the delete guard reads: a bare "yes, go ahead" carries the request it confirms. */
export function rootRequest(prompt: string, previousPersonMessage: string | null): string {
  return previousPersonMessage && AFFIRM.test(prompt) && prompt.length < 80 ? `${previousPersonMessage}\n${prompt}` : prompt;
}
