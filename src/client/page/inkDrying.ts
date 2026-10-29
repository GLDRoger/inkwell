import { Extension } from "@tiptap/core";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Text that arrives from someone else (an agent writing through Yjs) appears
 * as wet ink in their colour and dries to the page's ink over a couple of
 * seconds. Only remote changes after the first sync are marked.
 */
export interface InkDryingOptions {
  /** False until the document has synced, so the initial load isn't painted wet. */
  isEnabled(): boolean;
  /** The writer's ink colour (the agent working on this page), or null for the default. */
  getColor(): string | null;
  /** How long ink stays wet, ms. */
  dryAfter: number;
}

export const inkDryingKey = new PluginKey<DecorationSet>("inkDrying");
let nextId = 0;

/** The range in the new document that differs from the old one, or null if nothing was inserted. */
export function insertedRange(tr: Transaction): { from: number; to: number } | null {
  const before = tr.before.content;
  const after = tr.doc.content;
  const start = before.findDiffStart(after);
  if (start == null) return null;
  const end = before.findDiffEnd(after);
  if (!end) return null;
  let { a: endA, b: endB } = end;
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  return endB > start ? { from: start, to: endB } : null;
}

export const InkDrying = Extension.create<InkDryingOptions>({
  name: "inkDrying",
  addOptions() {
    return { isEnabled: () => false, getColor: () => null, dryAfter: 2400 };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<DecorationSet>({
        key: inkDryingKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            let next = set.map(tr.mapping, tr.doc);
            const dried = tr.getMeta(inkDryingKey) as number | undefined;
            if (dried != null) next = next.remove(next.find(undefined, undefined, (spec) => spec.inkId === dried));
            if (tr.docChanged && isChangeOrigin(tr) && options.isEnabled()) {
              const range = insertedRange(tr);
              if (range && tr.doc.textBetween(range.from, range.to, " ", " ").trim()) {
                const color = options.getColor();
                const deco = Decoration.inline(
                  range.from,
                  range.to,
                  { class: "ink-wet", style: color ? `--wet-ink: ${color}` : "" },
                  { inkId: nextId++, inclusiveEnd: false },
                );
                next = next.add(tr.doc, [deco]);
              }
            }
            return next;
          },
        },
        props: {
          decorations: (state) => inkDryingKey.getState(state),
        },
        view() {
          const timers = new Map<number, ReturnType<typeof setTimeout>>();
          return {
            update(view) {
              const set = inkDryingKey.getState(view.state);
              for (const d of set?.find() ?? []) {
                const id = d.spec.inkId as number;
                if (timers.has(id)) continue;
                timers.set(
                  id,
                  setTimeout(() => {
                    timers.delete(id);
                    if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(inkDryingKey, id).setMeta("addToHistory", false));
                  }, options.dryAfter),
                );
              }
            },
            destroy() {
              timers.forEach(clearTimeout);
            },
          };
        },
      }),
    ];
  },
});
