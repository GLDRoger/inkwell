import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { MenuStore } from "./suggestion";

interface Props<T> {
  store: MenuStore<T>;
  label: string;
  id: string;
  render(item: T): ReactNode;
  keyOf(item: T): string;
  empty?: ReactNode;
}

/** The floating list for slash commands and page links. Keyboard is driven from the editor. */
export function SuggestionMenu<T>({ store, label, id, render, keyOf, empty }: Props<T>) {
  const s = useSyncExternalStore(store.subscribe, store.get);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [s.index, s.open]);

  if (!s.open || !s.rect) return null;
  const below = s.rect.bottom + 320 < window.innerHeight;
  const left = Math.max(8, Math.min(s.rect.left, window.innerWidth - 288));
  const style = below
    ? { top: s.rect.bottom + 6, left }
    : { bottom: window.innerHeight - s.rect.top + 6, left };

  return createPortal(
    <div className="suggest" style={style} role="presentation">
      <ul ref={listRef} id={id} role="listbox" aria-label={label}>
        {s.items.length === 0 && empty && <li className="suggest-empty">{empty}</li>}
        {s.items.map((item, i) => (
          <li
            key={keyOf(item)}
            role="option"
            aria-selected={i === s.index}
            className="suggest-item"
            onMouseDown={(e) => {
              e.preventDefault(); // keep editor focus
              s.select(item);
            }}
            onMouseMove={() => i !== s.index && store.set({ index: i })}
          >
            {render(item)}
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}
