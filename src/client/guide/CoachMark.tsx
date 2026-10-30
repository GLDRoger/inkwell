import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

export interface CoachMarkProps {
  /** The element this mark points at; null shows the mark on its own, centred low on the screen. */
  target: () => Element | null;
  title: string;
  children: ReactNode;
  /** "2 of 4". */
  progress?: { at: number; of: number };
  /** The main button. */
  primary: { label: string; run(): void };
  secondary?: { label: string; run(): void };
  /** Esc, the × and "Skip": close the whole guide. */
  onClose(): void;
  closeLabel?: string;
}

type Spot = { top: number; left: number; width: number; height: number } | null;

const PHONE = "(max-width: 640px)";
const GAP = 12;
const CARD_W = 320;

function measure(el: Element | null): Spot {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/** Where the card goes: below the target if there's room, else above; kept on screen. */
export function placeCard(spot: Spot, card: { width: number; height: number }, view: { width: number; height: number }) {
  if (!spot) return { top: view.height - card.height - 24, left: (view.width - card.width) / 2, side: "none" as const };
  const below = spot.top + spot.height + GAP;
  const fitsBelow = below + card.height <= view.height - 12;
  const top = fitsBelow ? below : Math.max(12, spot.top - GAP - card.height);
  const centre = spot.left + spot.width / 2 - card.width / 2;
  const left = Math.min(Math.max(12, centre), view.width - card.width - 12);
  return { top, left, side: fitsBelow ? ("below" as const) : ("above" as const) };
}

/**
 * One coach mark: a small card beside the thing it explains, with a ring
 * around that thing. It's a non-modal dialog that takes focus when it opens
 * (and on each step), keeps Tab inside itself, closes on Escape, and gives
 * focus back to where it was. On phones it sits along the bottom.
 */
export function CoachMark({ target, title, children, progress, primary, secondary, onClose, closeLabel = "Skip the guide" }: CoachMarkProps) {
  const card = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [spot, setSpot] = useState<Spot>(null);
  const [pos, setPos] = useState<{ top: number; left: number; side: string } | null>(null);
  const [phone, setPhone] = useState(() => typeof matchMedia === "function" && matchMedia(PHONE).matches);

  // Follow the target as the layout moves (resizes, the map's chrome sliding in).
  useLayoutEffect(() => {
    let frame = 0;
    let last = "";
    const tick = () => {
      const s = measure(target());
      const isPhone = typeof matchMedia === "function" && matchMedia(PHONE).matches;
      const view = { width: window.innerWidth, height: window.innerHeight };
      const box = card.current?.getBoundingClientRect();
      const size = { width: box?.width || CARD_W, height: box?.height || 180 };
      const p = isPhone ? null : placeCard(s, size, view);
      const key = JSON.stringify([s, p, isPhone]);
      if (key !== last) {
        last = key;
        setSpot(s);
        setPos(p);
        setPhone(isPhone);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [target, title]);

  // Focus comes to the mark on each step; it goes back where it was when the guide closes.
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    return () => {
      // Nothing had focus (the guide opened after the welcome): land on the notebook itself.
      const to = back?.isConnected && back !== document.body ? back : document.getElementById("main");
      to?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [title]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !card.current) return;
      const items = [...card.current.querySelectorAll<HTMLElement>("button, a[href]")];
      if (!items.length) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      // Tab stays inside the mark: from the heading or anything outside, start at the ends.
      e.preventDefault();
      const next = at < 0 ? (e.shiftKey ? items.length - 1 : 0) : (at + (e.shiftKey ? -1 : 1) + items.length) % items.length;
      items[next].focus();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const style = phone || !pos ? undefined : { top: pos.top, left: pos.left };

  return (
    <>
      {spot && (
        <div
          className="coach-ring"
          aria-hidden
          style={{ top: spot.top - 6, left: spot.left - 6, width: spot.width + 12, height: spot.height + 12 }}
        />
      )}
      <div
        ref={card}
        className="coach"
        data-phone={phone || undefined}
        data-side={pos?.side}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        style={style}
      >
        <div className="coach-head">
          {progress && (
            <span className="coach-progress" aria-label={`Step ${progress.at} of ${progress.of}`}>
              {progress.at} of {progress.of}
            </span>
          )}
          <button type="button" className="coach-close" aria-label={closeLabel} title={`${closeLabel} (Esc)`} onClick={onClose}>
            <X size={15} aria-hidden />
          </button>
        </div>
        <h2 ref={heading} id={titleId} className="coach-title" tabIndex={-1}>
          {title}
        </h2>
        <div id={bodyId} className="coach-body">
          {children}
        </div>
        <div className="coach-actions">
          {secondary && (
            <button type="button" className="coach-secondary" onClick={secondary.run}>
              {secondary.label}
            </button>
          )}
          <button type="button" className="coach-primary" onClick={primary.run}>
            {primary.label}
          </button>
        </div>
      </div>
    </>
  );
}
