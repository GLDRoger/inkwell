import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Check, Loader2, X } from "lucide-react";
import { dismiss, dismissForNavigation, useNotices } from "../lib/notices";

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
      {notices.map((n) => (
        <div key={n.id} className="notice" data-tone={n.tone} role={n.tone === "error" ? "alert" : "status"}>
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
            <button type="button" className="notice-close" aria-label="Dismiss" onClick={() => dismiss(n.id)}>
              <X size={14} aria-hidden />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
