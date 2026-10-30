/** First-visit welcome: when to show it, and remembering that it was seen. */
export const WELCOME_KEY = "inkwell-welcomed";

export interface WelcomeContext {
  pathname: string;
  search: string;
  /** The visitor has opened the notebook before. */
  seen: boolean;
  /** An automated browser (navigator.webdriver): skip unless asked for, so scripted checks land on the map. */
  automated?: boolean;
}

/**
 * Show the welcome on a first visit to the bare map ("/"), never on a deep link
 * (a page, or the map focused on something), and always when `?welcome` is in the URL.
 */
export function shouldShowWelcome({ pathname, search, seen, automated = false }: WelcomeContext): boolean {
  const params = new URLSearchParams(search);
  if (params.has("welcome")) return true;
  if (seen || automated) return false;
  if (pathname !== "/") return false;
  return [...params.keys()].length === 0;
}

export function hasSeenWelcome(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): boolean {
  try {
    return storage?.getItem(WELCOME_KEY) === "1";
  } catch {
    return true; // storage blocked: don't greet on every visit
  }
}

export function markWelcomeSeen(storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage) {
  try {
    storage?.setItem(WELCOME_KEY, "1");
  } catch {
    /* storage blocked; nothing to remember with */
  }
}

/** The URL's search string without `welcome`, for tidying the address bar afterwards. */
export function withoutWelcomeParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("welcome");
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
