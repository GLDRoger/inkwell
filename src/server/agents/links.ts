/**
 * Safety nets for what models get wrong about pages (real Muse Wonder eval, 2026-10-30):
 * a mis-copied page id in a reply's link, and the page title repeated as a heading.
 */

/** Compare titles the way a reader would: case, markdown emphasis, quotes and spacing don't matter. */
export function sameTitle(a: string, b: string): boolean {
  return normTitle(a) === normTitle(b) && normTitle(a) !== "";
}

function normTitle(text: string): string {
  return text
    .replace(/\\([[\]\\*_`])/g, "$1")
    .replace(/[*_`"“”‘’]/g, "")
    .replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, "")
    .replace(/\s+/g, " ")
    .replace(/[.:!?\s]+$/, "")
    .trim()
    .toLowerCase();
}

const LINK = /\[((?:\\.|[^\]\\\n])*)\]\(\/p\/([^)\s]*)\)/g;

/**
 * Repair /p/ID links in a reply. A link whose label names a page (exactly one
 * page has that title) points at that page, whatever id the model typed. A link
 * whose id isn't a live page and whose label names none keeps its words, unlinked.
 * Other links (live id, free-text label) are left alone.
 */
export function repairPageLinks(text: string, pages: { id: string; title: string }[]): string {
  if (!text.includes("](/p/")) return text;
  const live = new Set(pages.map((p) => p.id));
  return text.replace(LINK, (whole, label: string, id: string) => {
    const named = pages.filter((p) => sameTitle(p.title, label));
    if (named.some((p) => p.id === id)) return whole;
    if (named.length === 1) return `[${label}](/p/${named[0]!.id})`;
    if (live.has(id)) return whole;
    return label.replace(/\\([[\]])/g, "$1");
  });
}

/**
 * Drop a leading heading that only repeats the page's title: the title is already
 * shown above the text. Blank lines after it go too.
 */
export function stripTitleHeading(markdown: string, title: string): string {
  const match = markdown.match(/^\s*#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/);
  if (!match || !sameTitle(match[1]!, title)) return markdown;
  return markdown.slice(match[0].length).replace(/^(?:[ \t]*\r?\n)+/, "");
}
