import { Check, Loader2, X } from "lucide-react";
import { dismiss, useNotices } from "../lib/notices";

/** Quiet notices along the bottom edge, for work that runs in the background. */
export function Notices() {
  const notices = useNotices();
  return (
    <div className="notices" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className="notice" data-tone={n.tone} role={n.tone === "error" ? "alert" : "status"}>
          {n.tone === "busy" ? (
            <Loader2 size={15} className="spin" aria-hidden />
          ) : n.tone === "done" ? (
            <Check size={15} aria-hidden />
          ) : null}
          <span>{n.text}</span>
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
