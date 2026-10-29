import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import type { Page } from "@shared/types";
import { MenuStore, storeRenderer } from "./suggestion";
import { pageTitle } from "../lib/queries";

/** An option in the link menu: an existing page, or "create a page called …". */
export type PageLinkItem = { kind: "page"; page: Page } | { kind: "create"; title: string };

export interface PageLinkOptions {
  store: MenuStore<PageLinkItem>;
  /** Current pages (read at query time so the list is always fresh). */
  getPages(): Page[];
  currentPageId: string;
  /** Create a page and resolve to it, for the "new page" option. */
  createPage(title: string): Promise<Page>;
}

export const pageHref = (id: string) => `/p/${id}`;

export function insertPageLink(editor: Editor, range: Range, page: Pick<Page, "id" | "title">) {
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent([
      { type: "text", text: pageTitle(page), marks: [{ type: "link", attrs: { href: pageHref(page.id) } }] },
      { type: "text", text: " " },
    ])
    .run();
}

export function matchPages(pages: Page[], query: string, currentPageId: string, limit = 7): PageLinkItem[] {
  const q = query.trim().toLowerCase();
  const hits = pages
    .filter((p) => p.id !== currentPageId && (!q || pageTitle(p).toLowerCase().includes(q)))
    .sort((a, b) => {
      const as = pageTitle(a).toLowerCase().startsWith(q) ? 0 : 1;
      const bs = pageTitle(b).toLowerCase().startsWith(q) ? 0 : 1;
      return as - bs || (a.updatedAt < b.updatedAt ? 1 : -1);
    })
    .slice(0, limit)
    .map((page): PageLinkItem => ({ kind: "page", page }));
  const exact = pages.some((p) => pageTitle(p).toLowerCase() === q);
  if (q && !exact) hits.push({ kind: "create", title: query.trim() });
  return hits;
}

/** "[[" and "@" both open the same page-link menu. */
export function PageLinks(opts: PageLinkOptions) {
  const command = ({ editor, range, props }: { editor: Editor; range: Range; props: PageLinkItem }) => {
    if (props.kind === "page") return insertPageLink(editor, range, props.page);
    void opts.createPage(props.title).then((page) => insertPageLink(editor, range, page));
  };
  const items = ({ query }: { query: string }) => matchPages(opts.getPages(), query, opts.currentPageId);
  const allow = ({ state, range }: { state: Editor["state"]; range: Range }) =>
    !state.doc.resolve(range.from).parent.type.spec.code;

  return Extension.create({
    name: "pageLinks",
    addProseMirrorPlugins() {
      return [
        Suggestion<PageLinkItem, PageLinkItem>({
          editor: this.editor,
          pluginKey: new PluginKey("pageLinkBrackets"),
          char: "[[",
          allowSpaces: true,
          items,
          command,
          allow,
          render: storeRenderer(opts.store),
        }),
        Suggestion<PageLinkItem, PageLinkItem>({
          editor: this.editor,
          pluginKey: new PluginKey("pageLinkAt"),
          char: "@",
          allowSpaces: false,
          items,
          command,
          allow,
          render: storeRenderer(opts.store),
        }),
      ];
    },
  });
}
