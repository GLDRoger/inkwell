import { memo, useEffect, useMemo, useRef, useState } from "react";
import { prefersReducedMotion } from "../lib/ui";
import { handCut, renderMarkdown, revealRate, stripInline } from "./ink";

interface Props {
  text: string;
  color: string;
  /** Write it out stroke by stroke (it streamed in during this visit) or show it at once. */
  live: boolean;
  /** More text may still arrive. */
  streaming: boolean;
  onClick?(e: React.MouseEvent): void;
}

/** Reveal `text` at a handwriting pace. Returns how many characters are visible. */
function useReveal(text: string, live: boolean): number {
  const [shown, setShown] = useState(() => (live && !prefersReducedMotion() ? 0 : text.length));
  const target = useRef(text.length);
  const cut = useRef(0);
  target.current = text.length;
  cut.current = handCut(text);

  useEffect(() => {
    if (!live || prefersReducedMotion()) {
      setShown(text.length);
      return;
    }
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      const dt = Math.min(64, now - last) / 1000;
      last = now;
      setShown((s) => {
        if (s >= target.current) return s;
        acc += revealRate(target.current - s, s < cut.current) * dt;
        const step = Math.floor(acc);
        acc -= step;
        return Math.min(target.current, s + step);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, text.length]);

  return Math.min(shown, text.length);
}

const HandChars = memo(function HandChars({ text }: { text: string }) {
  // One span per character so each stroke can be laid down with its own small ink bleed.
  return (
    <>
      {Array.from(text).map((ch, i) => (
        <span key={i} className="stroke">
          {ch}
        </span>
      ))}
    </>
  );
});

/** Snap the serif part's reveal to whole words so markdown isn't re-parsed every frame. */
const snapToWord = (s: string, end: number) => {
  if (end >= s.length) return s.length;
  const space = s.lastIndexOf(" ", end);
  return space > 0 ? space : end;
};

export function InkWriter({ text, color, live, streaming, onClick }: Props) {
  const shown = useReveal(text, live);
  const cut = handCut(text);
  // Reveal a prefix of the stable, stripped hand text so earlier strokes never re-render.
  const handFull = stripInline(text.slice(0, cut));
  const handVisible = handFull.slice(0, stripInline(text.slice(0, Math.min(shown, cut))).length);
  const restEnd = shown > cut ? snapToWord(text, shown) : cut;
  const restMd = text.slice(cut, restEnd);
  const restHtml = useMemo(() => (restMd.trim() ? renderMarkdown(restMd) : ""), [restMd]);
  const writing = shown < text.length || streaming;

  return (
    <div className="ink" style={{ ["--agent" as string]: color }} aria-busy={writing} data-writing={writing && shown > cut} onClick={onClick}>
      {handFull.trim() && (
        <p className="ink-hand">
          <span className="sr-only">{handFull}</span>
          <span aria-hidden>
            {live ? <HandChars text={handVisible} /> : handVisible}
            {writing && shown <= cut && <span className="nib" />}
          </span>
        </p>
      )}
      {restHtml && (
        <div className="ink-body" dangerouslySetInnerHTML={{ __html: restHtml }} />
      )}
    </div>
  );
}
