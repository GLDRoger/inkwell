import { memo, useRef, type CSSProperties } from "react";
import { ArrowUpRight, ImagePlus } from "lucide-react";
import { arrivalOf, useArrivals } from "../lib/arrivals";
import { paintCover, usePainting } from "../lib/media";
import type { Page } from "@shared/types";
import type { CameraController } from "./camera";
import type { CardBox } from "./layout";
import type { Detail } from "./lod";
import { ago, titleOf } from "./util";
import css from "./map.module.css";

interface Props {
  page: Page;
  box: CardBox;
  detail: Detail;
  /** Ink of the agent writing here right now. */
  writing: string | null;
  /** When the page last got fresh ink while we watched. */
  freshAt: number | null;
  /** Made just now, while we watched: it writes itself onto the map. */
  born: boolean;
  /** When this card inks itself in during the map's reveal, ms. */
  inkAt: number;
  /** Ink of whoever touched it last, when that was an agent. */
  touchedInk: string | null;
  crumb: string;
  now: number;
  camera: CameraController;
  /** A click: the map decides whether it's one (focus) or the second of two (open). */
  onClick(id: string): void;
  onOpen(id: string): void;
  onMove(id: string, x: number, y: number): void;
  /** Right-click (or the context-menu key): actions for this card at a screen point. */
  onMenu?(id: string, x: number, y: number): void;
}

const FRESH_SHOW_MS = 12_000;

function paragraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * One page on the map. Placed in screen space from the camera variables on
 * its layer, so text is always set at its real size; only what it shows
 * changes with zoom.
 */
export const MapCard = memo(function MapCard(p: Props) {
  const { page, box, detail } = p;
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);
  const title = titleOf(page);
  const near = detail === "near";
  const movable = detail === "mid" || detail === "near";
  useArrivals();
  const arrival = arrivalOf(page, p.freshAt);
  const painting = usePainting(page.id);
  const freshAge = p.freshAt ? p.now - p.freshAt : Infinity;
  const fresh = freshAge < 60_000;

  const style = {
    "--x": box.x,
    "--y": box.y,
    "--w": box.w,
    "--h": box.h,
    "--d": `${p.inkAt}ms`,
  } as CSSProperties & Record<string, string | number>;
  if (p.writing) style["--who"] = p.writing;
  if (p.touchedInk) style["--touched"] = p.touchedInk;
  // Fresh ink dries on its own clock, even if the card remounts mid-way.
  if (fresh) style["--fresh-delay"] = `${-Math.min(freshAge, FRESH_SHOW_MS)}ms`;
  // A newborn page writes itself in on its own clock, so scrolling it out and back doesn't replay it.
  if (p.born && p.freshAt) style["--born-delay"] = `${-Math.max(0, Math.min(Date.now() - p.freshAt, 5000))}ms`;
  // New cards from a photo come in one after another, on their own clock too.
  if (arrival?.kind === "arriving") style["--arrive-delay"] = `${Math.round(arrival.delayMs)}ms`;

  const label = `${title}${p.writing ? ", being written now" : ""}. Last edited by ${page.updatedBy.name} ${ago(page.updatedAt, p.now)}.`;
  const by = page.updatedBy;

  return (
    <div
      ref={ref}
      className={css.card}
      style={style}
      data-card={page.id}
      data-detail={detail}
      data-writing={p.writing ? "" : undefined}
      data-fresh={fresh ? "" : undefined}
      data-born={p.born || undefined}
      data-root={box.depth === 0 ? "" : undefined}
      data-arrive={arrival?.kind === "held" ? "held" : arrival ? "in" : undefined}
      data-painting={painting || undefined}
      aria-busy={painting || undefined}
      tabIndex={0}
      role={near ? "article" : "button"}
      aria-label={label}
      title={detail === "dots" || detail === "rooms" ? title : undefined}
      onClick={(e) => {
        if (justDragged.current) {
          justDragged.current = false;
          return;
        }
        if ((e.target as HTMLElement).closest("button, a, [data-scrolls]")) return;
        p.onClick(page.id);
      }}
      onContextMenu={(e) => {
        if (!p.onMenu) return;
        e.preventDefault();
        // The context-menu key reports no pointer position; open beside the card instead.
        const r = e.currentTarget.getBoundingClientRect();
        const keyboard = e.clientX === 0 && e.clientY === 0;
        p.onMenu(page.id, keyboard ? r.left + 12 : e.clientX, keyboard ? r.top + 12 : e.clientY);
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter") {
          e.preventDefault();
          p.onOpen(page.id);
        } else if (e.key === " ") {
          e.preventDefault();
          p.onClick(page.id);
        }
      }}
      onPointerDown={(e) => {
        if (!movable || e.button !== 0) return;
        if ((e.target as HTMLElement).closest("button, a, [data-scrolls]")) return;
        drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.sx;
        const dy = e.clientY - d.sy;
        if (!d.moved) {
          if (Math.hypot(dx, dy) < 5) return;
          d.moved = true;
          ref.current?.setPointerCapture(e.pointerId);
          ref.current?.setAttribute("data-dragging", "");
        }
        const s = p.camera.cam.s;
        ref.current?.style.setProperty("--x", String(box.x + dx / s));
        ref.current?.style.setProperty("--y", String(box.y + dy / s));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d || d.id !== e.pointerId || !d.moved) return;
        ref.current?.removeAttribute("data-dragging");
        justDragged.current = true;
        setTimeout(() => (justDragged.current = false), 0);
        const s = p.camera.cam.s;
        p.onMove(page.id, Math.round(box.x + (e.clientX - d.sx) / s), Math.round(box.y + (e.clientY - d.sy) / s));
      }}
      onPointerCancel={() => {
        drag.current = null;
        ref.current?.removeAttribute("data-dragging");
        ref.current?.style.setProperty("--x", String(box.x));
        ref.current?.style.setProperty("--y", String(box.y));
      }}
    >
      {detail === "dots" && page.icon && <span className={css.dotIcon}>{page.icon}</span>}

      {detail === "rooms" && (
        <span className={css.chipTitle}>
          {page.icon && <span className={css.icon}>{page.icon}</span>}
          {title}
        </span>
      )}

      {detail === "mid" && (
        <div className={css.mid}>
          {page.coverUrl && <img className={css.cover} src={page.coverUrl} alt="" draggable={false} />}
          {painting && !page.coverUrl && <span className={css.coverWash} aria-hidden />}
          <h3 className={css.midTitle}>
            {page.icon && <span className={css.icon}>{page.icon}</span>}
            {title}
          </h3>
          {page.excerpt.trim() ? (
            <p className={css.excerpt}>{paragraphs(page.excerpt).join(" ")}</p>
          ) : (
            <p className={css.empty}>Nothing written here yet</p>
          )}
          <Touched by={by} at={page.updatedAt} now={p.now} writing={!!p.writing} fresh={fresh} agentInk={p.touchedInk} />
        </div>
      )}

      {near && (
        <div className={css.near}>
          <div className={css.nearHead}>
            <span className={css.crumb}>{p.crumb}</span>
            <button
              type="button"
              className={css.paint}
              disabled={painting}
              onClick={(e) => {
                e.stopPropagation();
                void paintCover(page);
              }}
              aria-label={painting ? `Making a cover for ${title}` : `Make a cover for ${title}`}
              title={page.coverUrl ? "Make a new cover" : "Make a cover"}
            >
              <ImagePlus size={15} strokeWidth={1.75} aria-hidden />
            </button>
            <button
              type="button"
              className={css.open}
              onClick={(e) => {
                e.stopPropagation();
                p.onOpen(page.id);
              }}
              aria-label={`Open ${title}`}
            >
              Open <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
          {page.coverUrl && <img className={css.coverNear} src={page.coverUrl} alt="" draggable={false} />}
          {painting && !page.coverUrl && <span className={css.coverWashNear} aria-hidden />}
          <h2 className={css.nearTitle}>
            {page.icon && <span className={css.icon}>{page.icon}</span>}
            {title}
          </h2>
          <Touched by={by} at={page.updatedAt} now={p.now} writing={!!p.writing} fresh={fresh} agentInk={p.touchedInk} />
          <div className={css.body} data-scrolls>
            {page.excerpt.trim() ? (
              paragraphs(page.excerpt).map((para, i) => <p key={i}>{para}</p>)
            ) : (
              <p className={css.empty}>Nothing written here yet. Open it to begin.</p>
            )}
            {page.excerpt.length >= 560 && (
              <button
                type="button"
                className={css.more}
                onClick={(e) => {
                  e.stopPropagation();
                  p.onOpen(page.id);
                }}
              >
                Read on
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

function Touched({
  by,
  at,
  now,
  writing,
  fresh,
  agentInk,
}: {
  by: Page["updatedBy"];
  at: string;
  now: number;
  writing: boolean;
  fresh: boolean;
  agentInk: string | null;
}) {
  return (
    <span className={css.touched} data-agent={by.kind === "agent" || undefined}>
      {fresh && <span className={css.wet} aria-hidden />}
      {writing ? (
        <span className={css.writingNow}>Being written now</span>
      ) : (
        <>
          {"Last edited by "}
          <span className={css.byName} style={agentInk ? ({ "--touched": agentInk } as CSSProperties) : undefined}>
            {by.name}
          </span>
          <span className={css.when}> · {ago(at, now)}</span>
        </>
      )}
    </span>
  );
}
