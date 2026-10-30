import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight } from "lucide-react";
import { Mark } from "../shell/Mark";
import { prefersReducedMotion } from "../lib/ui";
import { NARROW, WIDE, type Placed } from "./objects";
import "./welcome.css";

type Phase = "mark" | "intro" | "leaving";

const NARROW_QUERY = "(max-width: 640px)";
/** How long the logo holds before the welcome opens, at least; also waits (briefly) for the display font. */
const MARK_MS = 1000;
const LEAVE_MS = 1200;
const LEAVE_REDUCED_MS = 260;

function useNarrow() {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const mq = matchMedia(NARROW_QUERY);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

function objectStyle(o: Placed, i: number): CSSProperties {
  // Unit vector from the centre, so the exit pushes each object straight outward.
  const dx = o.x - 50;
  const dy = (o.y - 50) * 0.7;
  const len = Math.hypot(dx, dy) || 1;
  return {
    "--x": o.x,
    "--y": o.y,
    "--w": o.w,
    "--ratio": o.ratio,
    "--r": `${o.r ?? 0}deg`,
    "--dx": dx / len,
    "--dy": dy / len,
    "--i": i,
    "--depth": 0.6 + ((i * 7) % 5) / 10,
    "--float-dur": `${7 + ((i * 13) % 5)}s`,
    "--float-delay": `${-((i * 1.7) % 7)}s`,
  } as CSSProperties;
}

function markReady(img: HTMLImageElement | null) {
  if (img?.complete && img.naturalWidth) img.closest(".welcome-object")?.setAttribute("data-ready", "");
}

/**
 * The first-visit welcome: a brief logo beat, then one headline over a still life
 * of everyday things. "Open your notebook" sends the objects outward and the view
 * moves into the map, which has been loading underneath all along.
 */
export function Welcome({ onLeave, onDone }: { onLeave(): void; onDone(): void }) {
  const reduced = useRef(prefersReducedMotion()).current;
  const narrow = useNarrow();
  const [phase, setPhase] = useState<Phase>(reduced ? "intro" : "mark");
  const rootRef = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);
  const ctaRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (phase !== "mark") return;
    let cancelled = false;
    const fonts = document.fonts?.ready ?? Promise.resolve();
    const minimum = new Promise((r) => setTimeout(r, MARK_MS));
    const cap = new Promise((r) => setTimeout(r, MARK_MS + 900));
    void Promise.race([Promise.all([fonts, minimum]), cap]).then(() => !cancelled && setPhase("intro"));
    return () => {
      cancelled = true;
    };
  }, [phase]);

  // Focus the dialog itself (no ring on the button until someone tabs); Enter or Escape opens the notebook.
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  const enter = () => {
    if (leaving.current) return;
    leaving.current = true;
    setPhase("leaving");
    onLeave();
    setTimeout(onDone, reduced ? LEAVE_REDUCED_MS : LEAVE_MS);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || (e.key === "Enter" && e.target === rootRef.current)) enter();
      // A modal: Tab stays on its one button (the notebook underneath is inert, but focus could still leave for the page body).
      else if (e.key === "Tab" && !leaving.current) {
        e.preventDefault();
        if (phase !== "mark") ctaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // A little depth: objects lean away from a fine pointer. Written straight to CSS, no re-render.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || reduced || !matchMedia("(pointer: fine)").matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.style.setProperty("--px", ((e.clientX / innerWidth) * 2 - 1).toFixed(3));
        root.style.setProperty("--py", ((e.clientY / innerHeight) * 2 - 1).toFixed(3));
      });
    };
    root.addEventListener("pointermove", onMove);
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("pointermove", onMove);
    };
  }, [reduced]);

  const objects = narrow ? NARROW : WIDE;

  return (
    <div
      ref={rootRef}
      className="welcome"
      data-phase={phase}
      data-reduced={reduced || undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      tabIndex={-1}
    >
      <div className="welcome-objects" aria-hidden>
        {objects.map((o, i) => (
          <div key={o.id} className="welcome-object" style={objectStyle(o, i)}>
            <div className="welcome-parallax">
              <div className="welcome-shadow" />
              <div className="welcome-float">
                <img
                  ref={markReady}
                  src={`/objects/${o.id}.webp`}
                  alt=""
                  draggable={false}
                  decoding="async"
                  onLoad={(e) => markReady(e.currentTarget)}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="welcome-mark" aria-hidden>
        <Mark size={48} />
      </div>

      <div className="welcome-content">
        <p className="welcome-brand">
          <Mark size={26} />
          <span>Inkwell</span>
        </p>
        <h1 id="welcome-title" className="welcome-title">
          A notebook that writes&nbsp;back.
        </h1>
        <p className="welcome-line">Write a request. Watch it get done across your pages.</p>
        <button ref={ctaRef} type="button" className="welcome-cta" onClick={enter} tabIndex={phase === "mark" ? -1 : 0}>
          Open your notebook
          <ArrowRight size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}
