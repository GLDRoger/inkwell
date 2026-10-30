import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, FileText, X } from "lucide-react";
import type { Id, Page } from "@shared/types";
import { settleSheet, snapHeight, type Snap } from "./sheet";
import "./peek.css";

// The editor stack (Tiptap, Yjs) loads with the first peek, not with the map.
const PeekBody = lazy(() => import("./PeekBody"));

/** How much of the screen the panel covers, px from the right edge (side panel) or the bottom (sheet). */
export interface PeekCover {
  right: number;
  bottom: number;
}

export interface PeekPanelProps {
  pageId: Id;
  /** The page as the map knows it (title and icon stay live from events). */
  page: Page | undefined;
  readOnly: boolean;
  /** The map's dev harness: no server, so show the card's text instead of the editor. */
  fixture?: boolean;
  onClose(): void;
  onOpenFull(id: Id): void;
  onSwap(id: Id): void;
  onCover(c: PeekCover): void;
}

const WIDE = "(min-width: 900px)";

function useWide() {
  const [wide, setWide] = useState(() => typeof window === "undefined" || !window.matchMedia || window.matchMedia(WIDE).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(WIDE);
    if (!mq) return;
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

/** The bar's height above the map, read from the shell's variable (via the sheet's own top padding). */
const chromeTop = () => {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--topbar-h");
  return (parseFloat(v) || 56) + 10;
};

/** Too narrow for both side by side, so the peek sits in front of the open diary (see peek.css). */
export const BOTH_PANELS_MIN_W = 1240;
const coversDiary = () => window.innerWidth < BOTH_PANELS_MIN_W && !!document.querySelector('.app[data-diary="open"]');

/**
 * A page opened beside the map. On a wide screen it's a panel on the right
 * (left of an open diary when there's room for both, in front of it when
 * there isn't); on a phone it's a bottom sheet you drag between half and
 * fully open, or down to close. The map behind stays live and movable.
 */
export function PeekPanel({ pageId, page, readOnly, fixture, onClose, onOpenFull, onSwap, onCover }: PeekPanelProps) {
  const ref = useRef<HTMLElement>(null);
  const wide = useWide();
  const [snap, setSnap] = useState<Snap>("half");
  const [vh, setVh] = useState(() => (typeof window === "undefined" ? 800 : window.innerHeight));
  const top = typeof document === "undefined" ? 66 : chromeTop();
  const full = snapHeight("full", vh, top);
  const visible = snapHeight(snap, vh, top);
  const title = page?.title?.trim() || (page ? "Untitled" : "Opening…");

  useEffect(() => {
    const on = () => setVh(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  // Tell the map how much of the screen is covered, so its camera keeps the peeked card in the free part.
  // Also published on the document (--peek-cover-right, --peek-cover-bottom), so other floating
  // chrome (the demo's caption) can make room for the panel.
  const coverRef = useRef((c: PeekCover) => {
    const root = document.documentElement.style;
    root.setProperty("--peek-cover-right", `${c.right}px`);
    root.setProperty("--peek-cover-bottom", `${c.bottom}px`);
    onCoverRef.current(c);
  });
  const onCoverRef = useRef(onCover);
  onCoverRef.current = onCover;
  const report = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (!wide) return coverRef.current({ right: 0, bottom: visible });
    const right = parseFloat(getComputedStyle(el).right) || 0;
    coverRef.current({ right: right + el.offsetWidth, bottom: 0 });
  }, [wide, visible]);
  useLayoutEffect(() => {
    report();
    const el = ref.current;
    const ro = el ? new ResizeObserver(report) : null;
    if (el) ro!.observe(el);
    // The diary opening or closing moves the panel (CSS on the shell's data-diary).
    const shell = el?.closest(".app");
    const mo = shell ? new MutationObserver(() => requestAnimationFrame(report)) : null;
    if (shell) mo!.observe(shell, { attributes: true, attributeFilter: ["data-diary"] });
    window.addEventListener("resize", report);
    return () => {
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [report]);
  useEffect(() => () => coverRef.current({ right: 0, bottom: 0 }), []);

  // Esc closes the peek, unless something inside (a slash menu) or another layer used it.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".diary, [role='dialog'], [role='menu'], .palette")) return;
      closeRef.current();
    };
    // In front of the diary, Esc from the diary hidden behind closes the peek, not the diary.
    const onKeyFirst = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !coversDiary() || !(e.target as HTMLElement | null)?.closest?.(".diary")) return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onKeyFirst, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onKeyFirst, true);
    };
  }, []);
  // Opened in front of the diary: typing shouldn't go on into its hidden composer.
  useEffect(() => {
    if (coversDiary() && document.activeElement?.closest(".diary")) ref.current?.focus({ preventScroll: true });
  }, [pageId]);

  // ------------------------------------------------------------ sheet drag
  const drag = useRef<{ id: number; y0: number; v0: number; t: number; y: number; v: number } | null>(null);
  const placeSheet = (shown: number | null) => {
    const el = ref.current;
    if (!el) return;
    if (shown == null) {
      el.style.removeProperty("translate");
      el.removeAttribute("data-dragging");
    } else {
      el.style.translate = `0 ${Math.round(full - shown)}px`;
      el.setAttribute("data-dragging", "");
    }
  };
  const onDragStart = (e: React.PointerEvent) => {
    if (wide || (e.target as HTMLElement).closest("button, a")) return;
    drag.current = { id: e.pointerId, y0: e.clientY, v0: visible, t: e.timeStamp, y: e.clientY, v: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dt = Math.max(1, e.timeStamp - d.t);
    d.v = (e.clientY - d.y) / dt;
    d.t = e.timeStamp;
    d.y = e.clientY;
    placeSheet(Math.max(40, Math.min(full, d.v0 - (e.clientY - d.y0))));
  };
  const onDragEnd = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    const shown = Math.max(40, Math.min(full, d.v0 - (e.clientY - d.y0)));
    placeSheet(null);
    // A tap on the handle toggles between half and full.
    if (Math.abs(e.clientY - d.y0) < 6) return setSnap((s) => (s === "half" ? "full" : "half"));
    const next = settleSheet(shown, d.v, vh, top);
    if (next === "closed") onClose();
    else setSnap(next);
  };

  const style = (wide ? {} : { height: full, translate: `0 ${full - visible}px`, "--sheet-hidden": `${full - visible}px` }) as CSSProperties;

  return (
    <aside
      ref={ref}
      className="peek"
      data-mode={wide ? "side" : "sheet"}
      data-snap={wide ? undefined : snap}
      style={style}
      aria-label={`Peek: ${title}`}
      data-peek={pageId}
      tabIndex={-1}
    >
      <header
        className="peek-head"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={() => {
          drag.current = null;
          placeSheet(null);
        }}
      >
        {!wide && <span className="peek-grip" aria-hidden />}
        <span className="peek-icon" aria-hidden>
          {page?.icon ?? <FileText size={16} strokeWidth={1.75} />}
        </span>
        <h2 className="peek-title" title={title}>
          {title}
        </h2>
        <button type="button" className="peek-open" onClick={() => onOpenFull(pageId)} title="Open the full page" aria-label="Open full page">
          <span className="peek-open-long">Open full page</span>
          <span className="peek-open-short">Open</span>
          <ArrowUpRight size={15} strokeWidth={1.75} aria-hidden />
        </button>
        <button type="button" className="peek-close" onClick={onClose} aria-label="Close the peek" title="Close (Esc)">
          <X size={16} strokeWidth={1.75} aria-hidden />
        </button>
      </header>
      <div className="peek-scroll" data-scrolls>
        {fixture ? (
          <div className="peek-doc">
            <div className="editor">
              <div className="prose">
                {(page?.excerpt ?? "")
                  .split(/\n+/)
                  .filter((p) => p.trim())
                  .map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
              </div>
            </div>
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="peek-doc page-skeleton" aria-busy="true">
                <div className="sk sk-line" />
                <div className="sk sk-line" />
              </div>
            }
          >
            <PeekBody key={pageId} pageId={pageId} readOnly={readOnly} onSwap={onSwap} />
          </Suspense>
        )}
      </div>
    </aside>
  );
}
