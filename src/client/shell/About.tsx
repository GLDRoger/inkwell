import { useEffect, useId, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { Mark } from "./Mark";
import { setUi, useUi } from "../lib/ui";

/** Start the welcome again (it only reads the URL on load). */
export const showWelcomeAgain = () => window.location.assign("/?welcome");

/** What this notebook is, in four short lines. Shared by the brand menu. */
export function AboutText() {
  return (
    <>
      <p className="about-title">About this notebook</p>
      <ul className="about-list">
        <li>It's private to this browser. There's no account to sign in to.</li>
        <li>Another browser or device gets its own, separate notebook.</li>
        <li>It's kept for 90 days after your last visit, then deleted.</li>
      </ul>
    </>
  );
}

/**
 * The brand pill on the map. It opens a small panel explaining the notebook,
 * with a way to see the welcome again. Also opened from the palette ("About").
 */
export function BrandMenu() {
  const open = useUi((s) => s.aboutOpen ?? false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const setOpen = (v: boolean) => setUi({ aboutOpen: v });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="brand-wrap" ref={ref}>
      <button
        ref={button}
        type="button"
        className="brand"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Inkwell: about this notebook"
        onClick={() => setOpen(!open)}
      >
        <Mark size={22} />
        <span className="brand-name">Inkwell</span>
        <ChevronDown size={14} className="brand-chevron" aria-hidden />
      </button>
      {open && (
        <div id={panelId} className="about" role="region" aria-label="About this notebook">
          <AboutText />
          <button type="button" className="link-button about-welcome" onClick={showWelcomeAgain}>
            Show the welcome again
          </button>
        </div>
      )}
    </div>
  );
}
