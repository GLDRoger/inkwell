import { memo, useEffect, useMemo, useRef, useState } from "react";
import { prefersReducedMotion } from "../lib/ui";
import { handCut, handSegments, maskIncomplete, renderMarkdown, revealRate, sliceSegments, type HandSegment, type QuoteAuthor } from "./ink";

interface Props {
  /** The diary entry this ink belongs to; remembers that it has been written once. */
  id: string;
  text: string;
  color: string;
  /** Write it out stroke by stroke (it streamed in during this visit) or show it at once. */
  live: boolean;
  /** More text may still arrive. */
  streaming: boolean;
  /** Signs quotes another agent wrote ("— Wren") once the reply has settled. */
  quoteBy?: QuoteAuthor;
  onClick?(e: React.MouseEvent): void;
  /** The reply has finished writing and settled into plain text. */
  onSettled?(): void;
}

/** Replies already written out once this visit: switching conversations doesn't write them again. */
const written = new Set<string>();
const SETTLE_AFTER_MS = 650;
/** The hand fades out completely before the serif fades in, so the two never overlap (keep in step with diary.css). */
const HAND_OUT_MS = 180;

/** Reveal `text` at a handwriting pace. Returns how many characters are visible. */
function useReveal(text: string, live: boolean): number {
  const [shown, setShown] = useState(() => (live ? 0 : text.length));
  const target = useRef(text.length);
  const cut = useRef(0);
  target.current = text.length;
  cut.current = handCut(text);

  useEffect(() => {
    if (!live) {
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

/** One span per character so each stroke is laid down with its own small ink bleed; links stay links. */
const HandInk = memo(function HandInk({ segments, strokes }: { segments: HandSegment[]; strokes: boolean }) {
  let n = 0;
  return (
    <>
      {segments.map((s, i) => {
        const chars = strokes
          ? Array.from(s.text).map((ch) => (
              <span key={n++} className="stroke">
                {ch}
              </span>
            ))
          : s.text;
        return s.href ? (
          <a key={`a${i}`} href={s.href}>
            {chars}
          </a>
        ) : (
          <span key={`t${i}`}>{chars}</span>
        );
      })}
    </>
  );
});

/** Snap the serif part's reveal to whole words so markdown isn't re-parsed every frame. */
const snapToWord = (s: string, end: number) => {
  if (end >= s.length) return s.length;
  const space = s.lastIndexOf(" ", end);
  return space > 0 ? space : end;
};

/**
 * An agent's reply. While it arrives it writes itself out in the agent's hand;
 * a moment after the last word it settles into plain, readable text. Replies
 * that were already there when you opened the diary are simply text.
 */
export function InkWriter({ id, text, color, live, streaming, quoteBy, onClick, onSettled }: Props) {
  const writes = live && !written.has(id) && !prefersReducedMotion();
  const [settled, setSettled] = useState(!writes);
  /** "out": the hand is fading away; "in": the settled text is fading in. */
  const [fade, setFade] = useState<"out" | "in" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const shown = useReveal(text, writes && !settled);
  const done = shown >= text.length && !streaming;
  const settledCb = useRef(onSettled);
  settledCb.current = onSettled;

  useEffect(() => {
    if (settled || !done) return;
    let swap: ReturnType<typeof setTimeout> | undefined;
    const t = setTimeout(() => {
      written.add(id);
      settledCb.current?.();
      if (prefersReducedMotion()) return setSettled(true);
      setFade("out");
      swap = setTimeout(() => {
        setSettled(true);
        setFade("in");
      }, HAND_OUT_MS);
    }, SETTLE_AFTER_MS);
    return () => {
      clearTimeout(t);
      clearTimeout(swap);
    };
  }, [done, settled, id]);

  // A live reply that was already written once (you switched away and back): it's settled already.
  useEffect(() => {
    if (live && !writes) settledCb.current?.();
  }, [live, writes]);

  const settledHtml = useMemo(() => (settled ? renderMarkdown(text, { quoteBy }) : ""), [settled, text, quoteBy]);

  const cut = handCut(text);
  // While more may arrive, a link or bold that hasn't closed yet is shown as plain words, not syntax.
  const handMd = streaming ? maskIncomplete(text.slice(0, cut)) : text.slice(0, cut);
  const segments = useMemo(() => handSegments(handMd), [handMd]);
  // Map the markdown position onto the ink proportionally, so hidden syntax (a link's target) never makes the reveal jump back.
  const handLength = useMemo(() => segments.reduce((n, s) => n + Array.from(s.text).length, 0), [segments]);
  const visibleChars = cut ? Math.round((handLength * Math.min(shown, cut)) / cut) : 0;
  const handVisible = useMemo(() => sliceSegments(segments, visibleChars), [segments, visibleChars]);
  const restEnd = shown > cut ? snapToWord(text, shown) : cut;
  // The serif part is revealed word by word, so it can stop mid-link even when the text is complete.
  const restMd = settled ? "" : maskIncomplete(text.slice(cut, restEnd));
  const restHtml = useMemo(() => (restMd.trim() ? renderMarkdown(restMd) : ""), [restMd]);
  const writing = !settled && (shown < text.length || streaming);
  const handText = segments.map((s) => s.text).join("");

  return (
    <div
      ref={root}
      className="ink"
      style={{ ["--agent" as string]: color }}
      aria-busy={writing}
      data-settled={settled}
      data-fade={fade ?? undefined}
      data-writing={writing && shown > cut}
      onClick={onClick}
    >
      {settled ? (
        <div className="ink-body" dangerouslySetInnerHTML={{ __html: settledHtml }} onAnimationEnd={() => setFade(null)} />
      ) : (
        <>
          {handText.trim() && (
            <p className="ink-hand">
              <HandInk segments={handVisible} strokes />
              {writing && shown <= cut && <span className="nib" aria-hidden />}
            </p>
          )}
          {restHtml && <div className="ink-body" dangerouslySetInnerHTML={{ __html: restHtml }} />}
        </>
      )}
    </div>
  );
}
