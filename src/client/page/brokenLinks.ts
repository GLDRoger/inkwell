import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Links to pages that aren't in this notebook any more (deleted, or copied
 * from someone else's notebook) are drawn muted and struck through, with a
 * tooltip saying why. The editor dispatches `brokenLinksKey` meta whenever
 * the page list changes so the marks are recomputed.
 */
export interface BrokenLinksOptions {
  /** Ids of the pages in this notebook, or null while they're still loading. */
  knownIds(): ReadonlySet<string> | null;
}

export const brokenLinksKey = new PluginKey<DecorationSet>("brokenLinks");
export const BROKEN_LINK_TITLE = "This page isn't in your notebook any more";

/** The page id a link points at, if it's an in-app page link. */
export function linkedPageId(href: string | null | undefined): string | null {
  const m = /^\/p\/([^/?#]+)/.exec(href ?? "");
  return m ? decodeURIComponent(m[1]) : null;
}

export function brokenLinkRanges(doc: PmNode, known: ReadonlySet<string>): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const link = node.marks.find((m) => m.type.name === "link");
    const id = linkedPageId(link?.attrs.href as string | undefined);
    if (id && !known.has(id)) out.push({ from: pos, to: pos + node.nodeSize });
  });
  return out;
}

function build(doc: PmNode, known: ReadonlySet<string> | null): DecorationSet {
  if (!known) return DecorationSet.empty;
  const ranges = brokenLinkRanges(doc, known);
  if (!ranges.length) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    ranges.map((r) => Decoration.inline(r.from, r.to, { class: "link-broken", title: BROKEN_LINK_TITLE })),
  );
}

export const BrokenLinks = Extension.create<BrokenLinksOptions>({
  name: "brokenLinks",
  addOptions() {
    return { knownIds: () => null };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<DecorationSet>({
        key: brokenLinksKey,
        state: {
          init: (_, state) => build(state.doc, options.knownIds()),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(brokenLinksKey) ? build(tr.doc, options.knownIds()) : old),
        },
        props: { decorations: (state) => brokenLinksKey.getState(state) },
      }),
    ];
  },
});
