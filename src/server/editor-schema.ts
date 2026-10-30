import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { MarkdownManager } from "@tiptap/markdown";
import { TiptapTransformer } from "@hocuspocus/transformer";
import { getSchema, type Extensions, type JSONContent } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { prosemirrorJSONToYDoc, updateYFragment } from "y-prosemirror";
import * as Y from "yjs";

/**
 * The one canonical extension list. The client editor mirrors this list
 * (plus Collaboration + Placeholder) so server-derived markdown and the
 * live editor agree on the schema.
 */
export const editorExtensions: Extensions = [
  StarterKit.configure({ undoRedo: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: false } }),
];

export const COLLAB_FIELD = "default";

let cachedSchema: Schema | null = null;
export function getEditorSchema(): Schema {
  if (!cachedSchema) cachedSchema = getSchema(editorExtensions);
  return cachedSchema;
}

const markdownManager = new MarkdownManager({ extensions: editorExtensions });
// The stock serializer HTML-escapes every &, < and >, so agents read "fish &amp; chips"
// and their exact-match edits miss text the person sees as "fish & chips". Escape only
// what the parser could mistake for HTML: "<" opening a tag-like run and "&" opening an
// entity. Everything else round-trips as typed.
type TextEncoder = { encodeTextForMarkdown(text: string, node: JSONContent, parent?: JSONContent): string };
const stockEncode = (markdownManager as unknown as TextEncoder).encodeTextForMarkdown.bind(markdownManager);
(markdownManager as unknown as TextEncoder).encodeTextForMarkdown = (text, node, parent) => {
  const encoded = stockEncode(text, node, parent);
  if (encoded === text) return encoded; // inside code: left literal by the stock encoder
  return encoded
    .replace(/(?<!^|\n)&gt;/g, ">") // a leading ">" would start a blockquote
    .replace(/&lt;(?![A-Za-z/!?])/g, "<")
    .replace(/&amp;(?!#?\w+;)/g, "&");
};
const transformer = TiptapTransformer.extensions(editorExtensions);

export function emptyDocJSON(): JSONContent {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

function normalizeDocJSON(json: JSONContent | null | undefined): JSONContent {
  if (!json || json.type !== "doc") return emptyDocJSON();
  if (!json.content || json.content.length === 0) return emptyDocJSON();
  return json;
}

export function markdownToTiptapJSON(markdown: string): JSONContent {
  const md = markdown ?? "";
  if (!md.trim()) return emptyDocJSON();
  return normalizeDocJSON(markdownManager.parse(md) as JSONContent);
}

export function tiptapJSONToMarkdown(json: JSONContent): string {
  const doc = normalizeDocJSON(json);
  // A single empty paragraph is the empty document.
  if (
    doc.content?.length === 1 &&
    doc.content[0]?.type === "paragraph" &&
    !doc.content[0]?.content?.length
  ) {
    return "";
  }
  return markdownManager.serialize(doc).trimEnd() + "\n";
}

/** Build a brand-new Y.Doc from Tiptap JSON (for page creation / seeding). */
export function tiptapJSONToYDoc(json: JSONContent): Y.Doc {
  return transformer.toYdoc(normalizeDocJSON(json), COLLAB_FIELD) as Y.Doc;
}

export function markdownToYDoc(markdown: string): Y.Doc {
  return tiptapJSONToYDoc(markdownToTiptapJSON(markdown));
}

export function markdownToYDocBytes(markdown: string): Buffer {
  const doc = markdownToYDoc(markdown);
  const bytes = Buffer.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return bytes;
}

export function yDocToTiptapJSON(doc: Y.Doc): JSONContent {
  const json = transformer.fromYdoc(doc, COLLAB_FIELD) as JSONContent;
  return normalizeDocJSON(json);
}

export function yDocBytesToJSON(bytes: Buffer | Uint8Array | null): JSONContent {
  if (!bytes || bytes.length === 0) return emptyDocJSON();
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, new Uint8Array(bytes));
    return yDocToTiptapJSON(doc);
  } finally {
    doc.destroy();
  }
}

export function yDocToMarkdown(doc: Y.Doc): string {
  return tiptapJSONToMarkdown(yDocToTiptapJSON(doc));
}

export function yDocBytesToMarkdown(bytes: Buffer | Uint8Array | null): string {
  return tiptapJSONToMarkdown(yDocBytesToJSON(bytes));
}

/**
 * Make a live Y.Doc's body equal the given JSON with a minimal diff:
 * unchanged blocks keep their Yjs identity, so open editors keep their
 * carets and only the changed blocks re-render. Call inside a transaction
 * (Hocuspocus DirectConnection.transact does this).
 */
export function applyJSONToYDoc(doc: Y.Doc, json: JSONContent): void {
  const fragment = doc.getXmlFragment(COLLAB_FIELD);
  const node = getEditorSchema().nodeFromJSON(normalizeDocJSON(json));
  updateYFragment(doc, fragment, node, { mapping: new Map(), isOMark: new Map() });
}

function isEmptyDoc(json: JSONContent): boolean {
  return (
    json.content?.length === 1 &&
    json.content[0]?.type === "paragraph" &&
    !json.content[0]?.content?.length
  );
}

/**
 * Append blocks to the end of a live Y.Doc without touching existing blocks
 * (safe while a person is typing higher up). An empty document's lone empty
 * paragraph is replaced rather than kept above the new content.
 */
export function appendJSONToYDoc(doc: Y.Doc, json: JSONContent): void {
  const extra = normalizeDocJSON(json);
  if (isEmptyDoc(extra)) return;
  const fragment = doc.getXmlFragment(COLLAB_FIELD);
  // Build the new blocks in a scratch doc, then clone them across.
  const scratch = prosemirrorJSONToYDoc(getEditorSchema(), extra, COLLAB_FIELD);
  const clones = scratch
    .getXmlFragment(COLLAB_FIELD)
    .toArray()
    .map((child) => (child as Y.XmlElement | Y.XmlText).clone());
  scratch.destroy();
  doc.transact(() => {
    if (fragment.length > 0 && isEmptyDoc(yDocToTiptapJSON(doc))) {
      fragment.delete(0, fragment.length);
    }
    fragment.insert(fragment.length, clones);
  });
}

/**
 * A Yjs relative position at the end of the document's last text block, for
 * an agent caret ("the ink is here"). Serialisable with
 * Y.relativePositionToJSON; y-prosemirror carets resolve it.
 */
export function endOfDocRelativePosition(doc: Y.Doc): Y.RelativePosition {
  let node: Y.XmlFragment | Y.XmlElement | Y.XmlText = doc.getXmlFragment(COLLAB_FIELD);
  while (!(node instanceof Y.XmlText) && node.length > 0) {
    const last: unknown = node.get(node.length - 1);
    if (last instanceof Y.XmlElement || last instanceof Y.XmlText) node = last;
    else break;
  }
  return Y.createRelativePositionFromTypeIndex(node, node.length, -1);
}

/** Plain text of a Tiptap JSON doc (blocks joined with spaces/newlines). */
export function tiptapJSONToPlainText(json: JSONContent): string {
  const parts: string[] = [];
  const walk = (node: JSONContent) => {
    if (node.type === "text") {
      if (node.text) parts.push(node.text);
      return;
    }
    if (node.content) for (const child of node.content) walk(child);
    if (
      node.type === "paragraph" ||
      node.type === "heading" ||
      node.type === "listItem" ||
      node.type === "taskItem" ||
      node.type === "codeBlock" ||
      node.type === "blockquote" ||
      node.type === "tableRow"
    ) {
      parts.push("\n");
    }
  };
  walk(normalizeDocJSON(json));
  return parts.join("").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

export function markdownToPlainText(markdown: string): string {
  return tiptapJSONToPlainText(markdownToTiptapJSON(markdown));
}

/**
 * Plain-text excerpt for map cards. Pages carry their title separately, so a
 * first line that just repeats the title (a leading "# Title") is skipped.
 */
export function excerptFromMarkdown(markdown: string, maxChars = 600, title?: string): string {
  let text = markdownToPlainText(markdown);
  const firstBreak = text.indexOf("\n");
  const firstLine = (firstBreak === -1 ? text : text.slice(0, firstBreak)).trim();
  if (title && firstLine.toLowerCase() === title.trim().toLowerCase()) {
    text = firstBreak === -1 ? "" : text.slice(firstBreak + 1).trim();
  }
  return text.length > maxChars ? text.slice(0, maxChars).trimEnd() : text;
}

export function excerptFromJSON(json: JSONContent, maxChars = 600): string {
  const text = tiptapJSONToPlainText(json);
  return text.length > maxChars ? text.slice(0, maxChars).trimEnd() : text;
}

/**
 * Extract linked page ids from markdown links like `[text](/p/<id>)`
 * (also tolerates a trailing path/query/title). Deduped, order preserved.
 */
export function extractPageLinkIds(markdown: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const re = /\]\(\s*\/p\/([A-Za-z0-9_-]+)(?:[)\s?#]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const id = m[1]!;
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** One top-level block of a document and where its markdown sits in a BlockView. */
export interface ViewBlock {
  json: JSONContent;
  markdown: string;
  start: number;
  end: number;
}

/**
 * The markdown agents read and edit: each top-level block serialized on its
 * own, joined by a blank line. Every block's offsets are known, so an edit can
 * touch only the blocks it matched and leave the rest of the live document
 * (including content markdown can't express) exactly as it was.
 */
export function blockView(json: JSONContent): { markdown: string; blocks: ViewBlock[] } {
  const blocks: ViewBlock[] = [];
  let markdown = "";
  for (const node of normalizeDocJSON(json).content ?? []) {
    if (blocks.length) markdown += "\n\n";
    const md = blockToMarkdown(node);
    blocks.push({ json: node, markdown: md, start: markdown.length, end: markdown.length + md.length });
    markdown += md;
  }
  return { markdown, blocks };
}

/** Markdown for one top-level block, without surrounding blank lines. */
export function blockToMarkdown(node: JSONContent): string {
  return tiptapJSONToMarkdown({ type: "doc", content: [node] }).replace(/^\n+|\n+$/g, "");
}

/** Top-level blocks parsed from markdown; whitespace-only markdown has none. */
export function markdownToBlocks(markdown: string): JSONContent[] {
  if (!markdown.trim()) return [];
  return markdownToTiptapJSON(markdown).content ?? [];
}

/** Whether a block survives markdown -> block unchanged (tables with multi-block cells don't). */
export function blockRoundTrips(block: ViewBlock): boolean {
  const schema = getEditorSchema();
  try {
    const original = schema.nodeFromJSON({ type: "doc", content: [block.json] });
    return original.eq(schema.nodeFromJSON(markdownToTiptapJSON(block.markdown)));
  } catch {
    return false;
  }
}
