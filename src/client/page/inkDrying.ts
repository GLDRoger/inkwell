import { Extension } from "@tiptap/core";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from "@tiptap/y-tiptap";
import type { RelativePosition } from "yjs";

/**
 * Text that arrives from someone else (an agent writing through Yjs) appears
 * as wet ink in their colour and dries to the page's ink over a couple of
 * seconds. Only remote changes after the first sync are marked.
 *
 * Remote updates often replace a whole paragraph in ProseMirror, which would
 * wipe ordinary decorations, so each wet stretch is anchored to Yjs relative
 * positions and turned back into document positions when drawn.
 */
export interface InkDryingOptions {
  /** False until the document has synced, so the initial load isn't painted wet. */
  isEnabled(): boolean;
  /** The writer's ink colour (the agent working on this page), or null for the default. */
  getColor(): string | null;
  /** How long ink stays wet, ms. */
  dryAfter: number;
}

interface WetInk {
  id: number;
  from: RelativePosition;
  /** Anchored on the last wet character, so text typed after it isn't swept in. */
  last: RelativePosition;
  color: string | null;
}

export const inkDryingKey = new PluginKey<WetInk[]>("inkDrying");
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

function decorate(state: EditorState, wet: WetInk[]): DecorationSet {
  const sync = ySyncPluginKey.getState(state);
  if (!wet.length || !sync?.binding) return DecorationSet.empty;
  const decos: Decoration[] = [];
  const size = state.doc.content.size;
  for (const w of wet) {
    const from = relativePositionToAbsolutePosition(sync.doc, sync.type, w.from, sync.binding.mapping);
    const last = relativePositionToAbsolutePosition(sync.doc, sync.type, w.last, sync.binding.mapping);
    if (from == null || last == null) continue;
    const to = Math.min(size, last + 1);
    if (to <= from) continue;
    decos.push(Decoration.inline(from, to, { class: "ink-wet", style: w.color ? `--wet-ink: ${w.color}` : "" }, { inkId: w.id }));
  }
  return DecorationSet.create(state.doc, decos);
}

export const InkDrying = Extension.create<InkDryingOptions>({
  name: "inkDrying",
  addOptions() {
    return { isEnabled: () => false, getColor: () => null, dryAfter: 2400 };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<WetInk[]>({
        key: inkDryingKey,
        state: {
          init: () => [],
          apply(tr, wet, _old, next) {
            const dried = tr.getMeta(inkDryingKey) as number | undefined;
            let out = dried != null ? wet.filter((w) => w.id !== dried) : wet;
            if (!tr.docChanged || !isChangeOrigin(tr) || !options.isEnabled()) return out;
            const range = insertedRange(tr);
            const sync = ySyncPluginKey.getState(next);
            if (!range || !sync?.binding || !tr.doc.textBetween(range.from, range.to, " ", " ").trim()) return out;
            try {
              const from = absolutePositionToRelativePosition(range.from, sync.type, sync.binding.mapping);
              const last = absolutePositionToRelativePosition(Math.max(range.from, range.to - 1), sync.type, sync.binding.mapping);
              out = [...out.slice(-80), { id: nextId++, from, last, color: options.getColor() }];
            } catch {
              /* positions not mapped yet (first render); skip this stroke */
            }
            return out;
          },
        },
        props: {
          decorations: (state) => decorate(state, inkDryingKey.getState(state) ?? []),
        },
        view() {
          const timers = new Map<number, ReturnType<typeof setTimeout>>();
          return {
            update(view) {
              for (const w of inkDryingKey.getState(view.state) ?? []) {
                if (timers.has(w.id)) continue;
                timers.set(
                  w.id,
                  setTimeout(() => {
                    if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(inkDryingKey, w.id).setMeta("addToHistory", false));
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
