import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { Info, ListChecks, Timer, Wallet, X } from "lucide-react";
import type { Id, Page, Widget, WidgetKind } from "@shared/types";
import type { CameraController } from "./camera";
import { linkPath, type Box } from "./layout";
import type { Detail } from "./lod";
import { titleOf } from "./util";
import { countdown, describeWidget, money, whenLabel, widgetRows } from "./widget-data";
import css from "./map.module.css";

/**
 * Live widgets: small instruments an agent builds from a fixed kit (a
 * countdown, progress over task lists, a running total, key facts), reading
 * from pages on the map. They sit on the map like cards, in the same paper,
 * but they hold one number big and say where it came from with threads.
 * When their data changes, the number counts to its new value and glows once.
 */

const ICONS: Record<WidgetKind, typeof Timer> = { countdown: Timer, progress: ListChecks, total: Wallet, facts: Info };

/** The displayed number eases to a new value; `bump` says which way it just moved. */
function useCountTo(value: number, reduced: boolean): { shown: number; bump: "up" | "down" | null } {
  const [shown, setShown] = useState(value);
  const [bump, setBump] = useState<"up" | "down" | null>(null);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    from.current = value;
    setBump(value > start ? "up" : "down");
    const clear = setTimeout(() => setBump(null), 1800);
    if (reduced) {
      setShown(value);
      return () => clearTimeout(clear);
    }
    let raf = 0;
    const t0 = performance.now();
    const ms = 720;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(start + (value - start) * e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(clear);
      setShown(value);
    };
  }, [value, reduced]);
  return { shown, bump };
}

/** A clock that ticks every second when it matters, every half minute otherwise. */
function useTick(fast: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), fast ? 1000 : 30_000);
    return () => clearInterval(id);
  }, [fast]);
  return now;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

interface Props {
  widget: Widget;
  box: Box;
  detail: Detail;
  pages: Map<Id, Page>;
  reduced: boolean;
  /** In a lens, beside it (docked), or faded behind it. */
  lens: "in" | "out" | null;
  movable: boolean;
  camera: CameraController;
  onMove?(id: Id, x: number, y: number): void;
  onDelete?(id: Id): void;
  onHover(id: Id | null): void;
  onPeek?(pageId: Id): void;
}

export const MapWidget = memo(function MapWidget(p: Props) {
  const { widget: w, box, detail } = p;
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; moved: boolean } | null>(null);
  const Icon = ICONS[w.data.kind] ?? Info;
  const far = detail === "rooms" || detail === "dots";
  const d = w.data;
  const close = d.kind === "countdown" && countdown(d.date, Date.now()).close;
  const now = useTick(d.kind === "countdown" && close);
  const value = d.kind === "progress" ? d.done : d.kind === "total" ? d.amount : 0;
  const { shown, bump } = useCountTo(value, p.reduced);
  const movable = p.movable && !far;
  // Said once per change, not per tick.
  const [said, setSaid] = useState("");
  const [changed, setChanged] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaid(describeWidget(w, Date.now()));
    setChanged(true);
    const t = setTimeout(() => setChanged(false), 1800);
    return () => clearTimeout(t);
  }, [w.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const style = { "--x": box.x, "--y": box.y, "--w": box.w, "--h": box.h } as CSSProperties;
  const pageTitle = (id: Id) => titleOf(p.pages.get(id));

  let body: React.ReactNode = null;
  if (d.kind === "countdown") {
    const c = countdown(d.date, now);
    body = c.past ? (
      <div className={css.wBig}>
        <span className={css.wNum}>Today</span>
        <span className={css.wSub}>{d.label} has come</span>
      </div>
    ) : (
      <div className={css.wBig}>
        <span className={css.wNum} data-close={c.close || undefined}>
          {far && !c.close ? (
            <>
              {c.days}
              <small>{c.days === 1 ? "day" : "days"}</small>
            </>
          ) : c.close ? (
            <>
              {c.hours}
              <small>h</small> {pad2(c.minutes)}
              <small>m</small> {!far && (
                <>
                  {pad2(c.seconds)}
                  <small>s</small>
                </>
              )}
            </>
          ) : (
            <>
              {c.days}
              <small>{c.days === 1 ? "day" : "days"}</small> {c.hours}
              <small>h</small>
              {!far && (
                <>
                  {" "}
                  {pad2(c.minutes)}
                  <small>m</small>
                </>
              )}
            </>
          )}
        </span>
        {!far && (
          <span className={css.wSub}>
            {d.label} · {whenLabel(d.date)}
          </span>
        )}
      </div>
    );
  } else if (d.kind === "progress") {
    const k = d.total ? Math.min(1, d.done / d.total) : 0;
    const rows = widgetRows(d.perPage);
    body = (
      <>
        <div className={css.wBig}>
          <span className={css.wNum} data-bump={bump ?? undefined}>
            {Math.round(shown)}
            <small> of {d.total}</small>
          </span>
          {!far && <span className={css.wSub}>{d.total ? `${Math.round(k * 100)}% done` : "No tasks yet"}</span>}
        </div>
        <span className={css.wBar} aria-hidden>
          <span style={{ "--k": k } as CSSProperties} />
        </span>
        {!far && rows.shown.length > 0 && (
          <ul className={css.wRows}>
            {rows.shown.map((r) => (
              <li key={r.pageId}>
                <button type="button" className={css.wPage} onClick={() => p.onPeek?.(r.pageId)} tabIndex={-1}>
                  {pageTitle(r.pageId)}
                </button>
                <span className={css.wMini} aria-hidden>
                  <span style={{ "--k": r.total ? r.done / r.total : 0 } as CSSProperties} />
                </span>
                <span className={css.wVal}>
                  {r.done}/{r.total}
                </span>
              </li>
            ))}
            {rows.more > 0 && <li className={css.wMore}>and {rows.more} more pages</li>}
          </ul>
        )}
      </>
    );
  } else if (d.kind === "total") {
    const rows = widgetRows(d.lines);
    body = (
      <>
        <div className={css.wBig}>
          <span className={css.wNum} data-bump={bump ?? undefined}>
            {money(Number.isInteger(d.amount) ? Math.round(shown) : shown, d.currency, far || Number.isInteger(d.amount) || Math.abs(d.amount) >= 10_000)}
          </span>
          {!far && <span className={css.wSub}>{d.lines.length === 1 ? "1 item" : `${d.lines.length} items`}</span>}
        </div>
        {!far && rows.shown.length > 0 && (
          <ul className={css.wRows}>
            {rows.shown.map((l, i) => (
              <li key={`${l.pageId}:${i}`}>
                <span className={css.wLine}>
                  {l.label}
                  <button type="button" className={css.wPage} onClick={() => p.onPeek?.(l.pageId)} tabIndex={-1}>
                    {pageTitle(l.pageId)}
                  </button>
                </span>
                <span className={css.wVal}>{money(l.amount, d.currency)}</span>
              </li>
            ))}
            {rows.more > 0 && <li className={css.wMore}>and {rows.more} more</li>}
          </ul>
        )}
      </>
    );
  } else if (d.kind === "facts") {
    body = far ? null : (
      <dl className={css.wFacts}>
        {d.items.slice(0, 6).map((f, i) => (
          <div key={i}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <div
      ref={ref}
      className={css.widget}
      style={style}
      data-widget={w.id}
      data-kind={d.kind}
      data-detail={detail}
      data-lens-in={p.lens === "in" || undefined}
      data-lens-out={p.lens === "out" || undefined}
      data-changed={bump || changed ? "" : undefined}
      tabIndex={0}
      role="group"
      aria-label={`${w.title}, a live widget`}
      aria-describedby={`${w.id}-said`}
      onPointerEnter={() => p.onHover(w.id)}
      onPointerLeave={() => p.onHover(null)}
      onFocus={() => p.onHover(w.id)}
      onBlur={() => p.onHover(null)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || !p.onDelete) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          p.onDelete(w.id);
        }
      }}
      onPointerDown={(e) => {
        if (!movable || e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
        drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };
      }}
      onPointerMove={(e) => {
        const g = drag.current;
        if (!g || g.id !== e.pointerId) return;
        const dx = e.clientX - g.sx;
        const dy = e.clientY - g.sy;
        if (!g.moved) {
          if (Math.hypot(dx, dy) < 5) return;
          g.moved = true;
          ref.current?.setPointerCapture(e.pointerId);
          ref.current?.setAttribute("data-dragging", "");
        }
        const s = p.camera.cam.s;
        ref.current?.style.setProperty("--x", String(box.x + dx / s));
        ref.current?.style.setProperty("--y", String(box.y + dy / s));
      }}
      onPointerUp={(e) => {
        const g = drag.current;
        drag.current = null;
        if (!g || g.id !== e.pointerId || !g.moved) return;
        ref.current?.removeAttribute("data-dragging");
        const s = p.camera.cam.s;
        p.onMove?.(w.id, Math.round(box.x + (e.clientX - g.sx) / s), Math.round(box.y + (e.clientY - g.sy) / s));
      }}
      onPointerCancel={() => {
        drag.current = null;
        ref.current?.removeAttribute("data-dragging");
        ref.current?.style.setProperty("--x", String(box.x));
        ref.current?.style.setProperty("--y", String(box.y));
      }}
    >
      {detail === "dots" ? (
        <Icon className={css.wDot} strokeWidth={1.75} aria-hidden />
      ) : (
        <>
          <div className={css.wHead}>
            <Icon className={css.wIcon} strokeWidth={1.75} aria-hidden />
            <span className={css.wTitle}>{w.title}</span>
            {p.onDelete && !far && (
              <button type="button" className={css.wRemove} onClick={() => p.onDelete?.(w.id)} aria-label={`Remove the widget ${w.title}`} title="Remove widget">
                <X size={14} strokeWidth={1.75} aria-hidden />
              </button>
            )}
          </div>
          {body}
        </>
      )}
      <span id={`${w.id}-said`} className={css.srOnly} aria-live="polite">
        {said}
      </span>
    </div>
  );
});

/**
 * Threads from each widget to the pages it reads, under the cards. Quiet until
 * you point at the widget (or it just changed); then they firm up.
 */
export const WidgetThreads = memo(function WidgetThreads({
  widgets,
  places,
  cards,
  hot,
}: {
  widgets: Widget[];
  places: Map<Id, Box>;
  cards: Map<Id, Box>;
  hot: Id | null;
}) {
  return (
    <g className={css.wThreads}>
      {widgets.map((w) => {
        const a = places.get(w.id);
        if (!a) return null;
        return (
          <g key={w.id} data-hot={hot === w.id || undefined}>
            {w.pageIds.map((id) => {
              const b = cards.get(id);
              return b ? <path key={id} d={linkPath(a, b)} /> : null;
            })}
          </g>
        );
      })}
    </g>
  );
});
