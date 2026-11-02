import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Blobatar } from "@blobatar/react";
import { useGaze } from "@blobatar/react/gaze";
import type { Expression } from "blobatar";
import { happy, idle, sad, thinking } from "blobatar/expression";
import "blobatar/motion.css";
import "blobatar/gaze.css";
import { BUSY, castOf, inkPalette, type AvatarState, type Look } from "./look";
import css from "./avatar.module.css";

export type { AvatarState, Look } from "./look";

/**
 * Each state's pose. Reading keeps the resting face and turns its eyes to the
 * page (see `look`); writing is the lifted, happy arcs of someone getting on
 * with it; thinking is blobatar's two-dot loader; a step that failed droops.
 */
const POSE: Record<AvatarState, Expression> = {
  idle,
  reading: idle,
  thinking,
  writing: happy,
  done: happy,
  failed: sad,
};

/** How long the happy beat lasts once an agent finishes, before it goes back to resting. */
export const DONE_MS = 1400;

// ------------------------------------------------------------------ dark or light

/** The theme the page is drawn in: `data-theme` on <html> when set, else the system's. */
function readDark(): boolean {
  if (typeof document === "undefined") return false;
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  const cs = document.documentElement.style.colorScheme;
  if (cs === "dark" || cs === "light") return cs === "dark";
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

const schemeSubs = new Set<() => void>();
let schemeOff: (() => void) | null = null;
function subscribeScheme(fn: () => void) {
  schemeSubs.add(fn);
  if (!schemeOff && typeof document !== "undefined") {
    const ping = () => schemeSubs.forEach((f) => f());
    const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
    mq?.addEventListener("change", ping);
    const mo = typeof MutationObserver === "function" ? new MutationObserver(ping) : null;
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    schemeOff = () => {
      mq?.removeEventListener("change", ping);
      mo?.disconnect();
    };
  }
  return () => {
    schemeSubs.delete(fn);
    if (!schemeSubs.size) {
      schemeOff?.();
      schemeOff = null;
    }
  };
}

/** One observer for every avatar on the page. */
export const useDark = () => useSyncExternalStore(subscribeScheme, readDark, () => false);

// ------------------------------------------------------------------ the avatar

/**
 * The state shown, which is `state` except for a short happy beat when an
 * agent goes from busy to resting.
 */
function useShown(state: AvatarState, animate: boolean): AvatarState {
  const [beat, setBeat] = useState(false);
  const prev = useRef(state);
  useEffect(() => {
    const was = prev.current;
    prev.current = state;
    if (!animate || state !== "idle" || !BUSY.has(was)) {
      setBeat(false);
      return;
    }
    setBeat(true);
    const t = setTimeout(() => setBeat(false), DONE_MS);
    return () => clearTimeout(t);
  }, [state, animate]);
  return beat ? "done" : state;
}

export interface AgentAvatarProps {
  /** The agent's name: it decides the creature (see `castOf`). */
  name: string;
  /** The agent's ink, a hex colour (`Agent.color`). */
  color: string;
  /** Rendered size, px. The body fills about 70% of it. */
  size: number;
  state?: AvatarState;
  /** Turn the eyes toward the page being read or written. */
  look?: Look | null;
  /**
   * Breathe, blink and glance (inline SVG). Off, the avatar is a single static
   * <img> holding its pose: what long lists of old entries use.
   */
  animate?: boolean;
  /** Eyes follow the pointer (fine pointers only; the library stands down under reduced motion). */
  follow?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * An agent's face: a soft body in its ink with two capsule eyes
 * (blobatar), idling, blinking and changing pose with what it's doing.
 * Decorative: whatever names the agent in text stays next to it.
 */
export function AgentAvatar({ name, color, size, state = "idle", look, animate = true, follow = false, className, style }: AgentAvatarProps) {
  const dark = useDark();
  const shown = useShown(state, animate);
  // Only a following avatar gets a gaze driver (it needs matchMedia, which test DOMs lack).
  const tracking = follow && animate && typeof matchMedia === "function";
  const { ref } = useGaze(tracking ? { travel: 6, lookAt: "pointer" } : { lookAt: null });
  const cls = className ? `${css.avatar} ${className}` : css.avatar;
  const common = {
    name,
    size,
    traits: castOf(name),
    palette: inkPalette(color, dark),
    expression: POSE[shown],
  };
  return (
    <span
      className={cls}
      data-state={shown}
      data-look={(shown === "reading" || shown === "writing") && look ? look : undefined}
      style={{ ...style, ["--avatar-size" as string]: `${size}px` }}
      aria-hidden
    >
      {animate ? <Blobatar {...common} ref={tracking ? ref : undefined} animate="always" /> : <Blobatar {...common} alt="" draggable={false} />}
    </span>
  );
}
