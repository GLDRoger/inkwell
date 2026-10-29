import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface PickerOption<T> {
  value: T;
  label: ReactNode;
  detail?: ReactNode;
  lead?: ReactNode;
}

interface Props<T> {
  label: string;
  value: T;
  options: PickerOption<T>[];
  onChange(value: T): void;
  button: ReactNode;
  align?: "start" | "end";
  placement?: "below" | "above";
  footer?: ReactNode;
  className?: string;
}

/** A small accessible listbox popover (threads, agents). */
export function Picker<T>({ label, value, options, onChange, button, align = "start", placement = "below", footer, className }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const i = options.findIndex((o) => o.value === value);
    setIndex(i < 0 ? 0 : i);
    requestAnimationFrame(() => list.current?.focus());
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
    // Only on open: re-running when options change would reset the highlight.
  }, [open]);

  const choose = (o: PickerOption<T>) => {
    onChange(o.value);
    setOpen(false);
    btn.current?.focus();
  };

  return (
    <div className={`picker ${className ?? ""}`} ref={root}>
      <button
        ref={btn}
        type="button"
        className="picker-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {button}
        <ChevronDown size={14} aria-hidden className="picker-chevron" />
      </button>
      {open && (
        <div className={`picker-pop picker-${align} picker-${placement}`}>
          <ul
            ref={list}
            id={id}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            aria-activedescendant={`${id}-${index}`}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setIndex((i) => (i + 1) % options.length));
              else if (e.key === "ArrowUp") (e.preventDefault(), setIndex((i) => (i - 1 + options.length) % options.length));
              else if (e.key === "Enter" || e.key === " ") (e.preventDefault(), options[index] && choose(options[index]));
              else if (e.key === "Escape" || e.key === "Tab") {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                btn.current?.focus();
              }
            }}
          >
            {options.map((o, i) => (
              <li
                key={i}
                id={`${id}-${i}`}
                role="option"
                aria-selected={o.value === value}
                data-active={i === index}
                className="picker-option"
                onMouseMove={() => setIndex(i)}
                onClick={() => choose(o)}
              >
                {o.lead && <span className="picker-lead">{o.lead}</span>}
                <span className="picker-text">
                  <span className="picker-label">{o.label}</span>
                  {o.detail && <span className="picker-detail">{o.detail}</span>}
                </span>
                {o.value === value && <Check size={14} aria-hidden className="picker-check" />}
              </li>
            ))}
          </ul>
          {footer && <div className="picker-footer">{footer}</div>}
        </div>
      )}
    </div>
  );
}
