import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Check, Loader2, X } from "lucide-react";
import { ConnectionNotice } from "./ConnectionNotice";
import { close, dismiss, dismissForNavigation, hold, release, useNotices, type Notice } from "../lib/notices";

/** Quiet notices along the bottom edge, for work that runs in the background. */
export function Notices() {
  const notices = useNotices();
  const { pathname } = useLocation();
  const first = useRef(true);

  // A notice belongs to the screen it came from: clear finished ones when you move on.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    dismissForNavigation();
  }, [pathname]);

  return (
    <div className="notices" aria-live="polite">
      <ConnectionNotice />
      {notices.map((n) => (
        <NoticeItem key={n.id} n={n} />
      ))}
    </div>
  );
}

/** One notice. Its clock stops while the pointer is over it or focus is inside it, so there's time to read and reach Undo. */
function NoticeItem({ n }: { n: Notice }) {
  const hovered = useRef(false);
  const focused = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  const set = (which: typeof hovered, on: boolean) => {
    if (which.current === on) return;
    which.current = on;
    if (on) hold(n.id);
    else release(n.id);
  };
  return (
    <div
      ref={ref}
      className="notice"
      data-tone={n.tone}
      role={n.tone === "error" ? "alert" : "status"}
      onPointerEnter={(e) => e.pointerType === "mouse" && set(hovered, true)}
      onPointerLeave={() => set(hovered, false)}
      onFocus={() => set(focused, true)}
      onBlur={(e) => !ref.current?.contains(e.relatedTarget as Node | null) && set(focused, false)}
    >
      {n.tone === "busy" ? (
        <Loader2 size={15} className="spin" aria-hidden />
      ) : n.tone === "done" && !n.action ? (
        <Check size={15} aria-hidden />
      ) : null}
      <span className="notice-text">{n.text}</span>
      {n.action && (
        <button
          type="button"
          className="notice-action"
          onClick={() => {
            dismiss(n.id);
            n.action!.run();
          }}
        >
          {n.action.label}
        </button>
      )}
      {n.tone !== "busy" && (
        <button type="button" className="notice-close" aria-label="Dismiss" onClick={() => close(n.id)}>
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}
