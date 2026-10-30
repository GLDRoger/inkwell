/**
 * The diary's first run. Right after the welcome (or on a first visit that
 * skipped it), Atlas's welcome note writes itself in and offers a few one-tap
 * requests, so the first ten seconds explain what Inkwell does.
 *
 * Wide screens open the diary beside the map; phones show a small nudge
 * instead, because a full-screen sheet over a map you've just entered is pushy.
 */
export const INTRO_KEY = "inkwell-diary-introduced";

export interface IntroContext {
  pathname: string;
  search: string;
  /** The intro already ran in this browser. */
  introduced: boolean;
  /** An automated browser: only introduce when the welcome itself played (`?welcome`). */
  automated: boolean;
  /** The welcome played during this page load. */
  welcomed: boolean;
}

export function shouldIntroduce({ pathname, search, introduced, automated, welcomed }: IntroContext): boolean {
  if (introduced) return false;
  if (welcomed) return true;
  if (automated) return false;
  // A deep link (a page, or the map focused on something) is someone arriving with a purpose.
  return pathname === "/" && !new URLSearchParams(search).toString();
}

export function hasIntroduced(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): boolean {
  try {
    return storage?.getItem(INTRO_KEY) === "1";
  } catch {
    return true;
  }
}

export function markIntroduced(storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage) {
  try {
    storage?.setItem(INTRO_KEY, "1");
  } catch {
    /* storage blocked */
  }
}

/** The welcome-note conversation the server seeds into every new notebook. */
export const isWelcomeThread = (title: string | undefined) => title === "Welcome to Inkwell";
