/** The guide shows once, the first time someone chooses "Try it yourself"; the brand menu reopens it. */
export const GUIDED_KEY = "inkwell-guided";

export function hasBeenGuided(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): boolean {
  try {
    return storage?.getItem(GUIDED_KEY) === "1";
  } catch {
    return true; // storage blocked: don't guide on every visit
  }
}

export function markGuided(storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage) {
  try {
    storage?.setItem(GUIDED_KEY, "1");
  } catch {
    /* nothing to remember with */
  }
}
