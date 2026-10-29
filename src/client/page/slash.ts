import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { MenuStore, storeRenderer } from "./suggestion";

export interface SlashItem {
  id: string;
  title: string;
  hint: string;
  keywords: string[];
  icon: string; // lucide icon name, mapped in the menu
  run(editor: Editor, range: Range): void;
}

const chain = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);

export const SLASH_ITEMS: SlashItem[] = [
  { id: "text", title: "Text", hint: "Plain paragraph", keywords: ["paragraph", "p", "body"], icon: "Pilcrow", run: (e, r) => chain(e, r).setParagraph().run() },
  { id: "h1", title: "Heading 1", hint: "Big section title", keywords: ["title", "h1", "#"], icon: "Heading1", run: (e, r) => chain(e, r).setNode("heading", { level: 1 }).run() },
  { id: "h2", title: "Heading 2", hint: "Medium section title", keywords: ["subtitle", "h2", "##"], icon: "Heading2", run: (e, r) => chain(e, r).setNode("heading", { level: 2 }).run() },
  { id: "h3", title: "Heading 3", hint: "Small section title", keywords: ["h3", "###"], icon: "Heading3", run: (e, r) => chain(e, r).setNode("heading", { level: 3 }).run() },
  { id: "bullets", title: "Bulleted list", hint: "A simple list", keywords: ["ul", "unordered", "-"], icon: "List", run: (e, r) => chain(e, r).toggleBulletList().run() },
  { id: "numbers", title: "Numbered list", hint: "A list with numbers", keywords: ["ol", "ordered", "1."], icon: "ListOrdered", run: (e, r) => chain(e, r).toggleOrderedList().run() },
  { id: "todo", title: "To-do list", hint: "Track tasks", keywords: ["task", "checkbox", "check", "[]"], icon: "ListTodo", run: (e, r) => chain(e, r).toggleTaskList().run() },
  { id: "quote", title: "Quote", hint: "Set a passage apart", keywords: ["blockquote", ">"], icon: "Quote", run: (e, r) => chain(e, r).toggleBlockquote().run() },
  { id: "code", title: "Code", hint: "A block of code", keywords: ["codeblock", "```", "snippet"], icon: "Code", run: (e, r) => chain(e, r).toggleCodeBlock().run() },
  { id: "table", title: "Table", hint: "Rows and columns", keywords: ["grid", "columns"], icon: "Table", run: (e, r) => chain(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: "divider", title: "Divider", hint: "A line between sections", keywords: ["hr", "rule", "separator", "---"], icon: "Minus", run: (e, r) => chain(e, r).setHorizontalRule().run() },
];

/** Prefix matches on the title rank first, then keyword and substring matches. */
export function filterSlashItems(query: string, items: SlashItem[] = SLASH_ITEMS): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const score = (it: SlashItem) => {
    const t = it.title.toLowerCase();
    if (t.startsWith(q)) return 0;
    if (t.split(/[\s-]+/).some((w) => w.startsWith(q))) return 1;
    if (it.keywords.some((k) => k.startsWith(q))) return 2;
    if (t.includes(q)) return 3;
    return -1;
  };
  return items
    .map((it) => [score(it), it] as const)
    .filter(([s]) => s >= 0)
    .sort((a, b) => a[0] - b[0])
    .map(([, it]) => it);
}

export const slashKey = new PluginKey("slash");

export function SlashCommand(store: MenuStore<SlashItem>) {
  return Extension.create({
    name: "slashCommand",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashItem>({
          editor: this.editor,
          pluginKey: slashKey,
          char: "/",
          startOfLine: false,
          allowedPrefixes: [" "],
          items: ({ query }) => filterSlashItems(query),
          command: ({ editor, range, props }) => props.run(editor, range),
          // Not inside code blocks, where "/" is just a character.
          allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
          render: storeRenderer(store),
        }),
      ];
    },
  });
}
