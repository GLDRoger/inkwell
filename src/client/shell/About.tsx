import { useEffect, useId, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Signpost, KeyRound, Play } from "lucide-react";
import { Mark } from "./Mark";
import { openKeyDialog, setUi, useUi } from "../lib/ui";
import { useMetaKey } from "../lib/key";
import { useDemo } from "../lib/demo";
import { startDemo, tryItYourself } from "../lib/demo-flow";

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
  const client = useQueryClient();
  const { key } = useMetaKey();
  const demo = useDemo((s) => s.notebook === "demo");
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
          {demo ? (
            <>
              <p className="about-title">The recorded demo</p>
              <p className="about-demo">You're watching a recording in a demo notebook. Your own notebook is untouched.</p>
            </>
          ) : (
            <AboutText />
          )}
          <ul className="about-actions">
            <li>
              <button
                type="button"
                className="about-action"
                onClick={() => {
                  setOpen(false);
                  void startDemo(client);
                }}
              >
                <Play size={15} aria-hidden />
                {demo ? "Watch the demo again" : "Watch the demo"}
              </button>
            </li>
            <li>
              <button
                type="button"
                className="about-action"
                onClick={() => {
                  setOpen(false);
                  if (demo) tryItYourself(client);
                  setUi({ guideOpen: true, diaryOpen: false });
                }}
              >
                <Signpost size={15} aria-hidden />
                Show the guide
              </button>
            </li>
            {!demo && (
              <li>
                <button type="button" className="about-action" onClick={() => openKeyDialog()}>
                  <KeyRound size={15} aria-hidden />
                  {key ? "Your Meta API key" : "Add your Meta API key"}
                </button>
              </li>
            )}
          </ul>
          <button type="button" className="link-button about-welcome" onClick={showWelcomeAgain}>
            Show the welcome again
          </button>
        </div>
      )}
    </div>
  );
}
