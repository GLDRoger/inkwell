import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, RotateCcw, Square } from "lucide-react";
import { stepModelLabel, useDemo } from "../lib/demo";
import { startDemo, stopDemo, tryItYourself } from "../lib/demo-flow";

export const DEMO_COPY = {
  label: "Recorded demo",
  starting: "Setting up the demo notebook…",
  finished: "That's Inkwell. Try it with your own notebook.",
  stopped: "Demo stopped. Watch it again, or try it with your own notebook.",
  tryYourself: "Try it yourself",
  stop: "Stop",
  again: "Watch again",
} as const;

/**
 * The quiet caption bar while the recorded demo plays: what's happening, which
 * Meta model it shows, how far along it is, and the ways out. Bottom centre on
 * wide screens; on phones it sits above the map's controls.
 */
export function DemoBar() {
  const client = useQueryClient();
  const d = useDemo((s) => s);
  if (d.notebook !== "demo" && !d.starting) return null;

  const steps = d.scenario?.steps ?? [];
  const caption = d.starting
    ? DEMO_COPY.starting
    : d.ended === "finished"
      ? DEMO_COPY.finished
      : d.ended === "stopped"
        ? DEMO_COPY.stopped
        : (d.step?.caption ?? DEMO_COPY.starting);
  const model = !d.ended && !d.starting ? stepModelLabel(d.step?.model) : null;
  const over = !!d.ended;

  return (
    <section className="demo-bar" aria-label={DEMO_COPY.label} data-ended={d.ended ?? undefined}>
      <div className="demo-meta">
        <span className="demo-label">
          <span className="demo-dot" data-playing={d.playing || undefined} aria-hidden />
          {DEMO_COPY.label}
        </span>
        {model && <span className="demo-model">{model}</span>}
        {steps.length > 0 && (
          <ol className="demo-dots" aria-label={`Step ${Math.max(1, d.index + 1)} of ${steps.length}`}>
            {steps.map((s, i) => (
              <li key={s.id} data-state={i < d.index || (over && d.ended === "finished") ? "done" : i === d.index ? "now" : "next"} />
            ))}
          </ol>
        )}
      </div>
      <p className="demo-caption" aria-live="polite">
        {d.starting && <Loader2 size={16} className="spin" aria-hidden />}
        {caption}
      </p>
      <div className="demo-actions">
        {over ? (
          <button type="button" className="demo-ghost" onClick={() => void startDemo(client)}>
            <RotateCcw size={13} aria-hidden />
            {DEMO_COPY.again}
          </button>
        ) : (
          <button type="button" className="demo-ghost" disabled={d.starting} onClick={() => void stopDemo()}>
            <Square size={10} aria-hidden fill="currentColor" />
            {DEMO_COPY.stop}
          </button>
        )}
        <button type="button" className="demo-try" onClick={() => tryItYourself(client)}>
          {DEMO_COPY.tryYourself}
          <ArrowRight size={14} aria-hidden />
        </button>
      </div>
    </section>
  );
}
