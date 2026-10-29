import type { SuggestionKeyDownProps, SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";

/** State of an open suggestion popup, held outside React so Tiptap can drive it. */
export interface MenuState<T> {
  open: boolean;
  items: T[];
  index: number;
  query: string;
  rect: DOMRect | null;
  select: (item: T) => void;
}

export class MenuStore<T> {
  private state: MenuState<T> = { open: false, items: [], index: 0, query: "", rect: null, select: () => {} };
  private subs = new Set<() => void>();
  get = () => this.state;
  subscribe = (fn: () => void) => (this.subs.add(fn), () => void this.subs.delete(fn));
  set(patch: Partial<MenuState<T>>) {
    this.state = { ...this.state, ...patch };
    this.subs.forEach((f) => f());
  }
  move(delta: number) {
    const n = this.state.items.length;
    if (n) this.set({ index: (this.state.index + delta + n) % n });
  }
}

/** Wire a Suggestion plugin's lifecycle into a MenuStore rendered by <SuggestionMenu>. */
export function storeRenderer<T>(store: MenuStore<T>): NonNullable<SuggestionOptions<T, T>["render"]> {
  return () => {
    const sync = (props: SuggestionProps<T, T>, reset: boolean) =>
      store.set({
        open: true,
        items: props.items,
        query: props.query,
        rect: props.clientRect?.() ?? null,
        select: (item) => props.command(item),
        ...(reset ? { index: 0 } : { index: Math.min(store.get().index, Math.max(0, props.items.length - 1)) }),
      });
    return {
      onStart: (props) => sync(props, true),
      onUpdate: (props) => sync(props, props.query !== store.get().query),
      onExit: () => store.set({ open: false, items: [], rect: null }),
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        const s = store.get();
        if (!s.open) return false;
        if (event.key === "ArrowDown") return store.move(1), true;
        if (event.key === "ArrowUp") return store.move(-1), true;
        if (event.key === "Enter" || event.key === "Tab") {
          const item = s.items[s.index];
          if (!item) return false;
          s.select(item);
          return true;
        }
        if (event.key === "Escape") return store.set({ open: false }), true;
        return false;
      },
    };
  };
}
