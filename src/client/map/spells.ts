/**
 * The map answers to two phrases, typed anywhere on it: one to reveal it,
 * one to wipe it back to blank parchment.
 */
export const SPELLS = {
  reveal: "i solemnly swear that i am up to no good",
  hide: "mischief managed",
} as const;
export type Spell = keyof typeof SPELLS;

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").replace(/ +/g, " ");

/**
 * Keeps the tail of what's been typed. `push` returns the spell just
 * completed, if any; `casting` says the keys so far are the start of a
 * spell, so single-key shortcuts (like F in "mischief") stay quiet.
 */
export class SpellBook {
  private buf = "";
  private longest = Math.max(...Object.values(SPELLS).map((s) => s.length));

  push(key: string): Spell | null {
    if (key.length !== 1) return null;
    this.buf = normalise(this.buf + key).slice(-this.longest);
    for (const [name, phrase] of Object.entries(SPELLS) as [Spell, string][]) {
      if (this.buf.endsWith(phrase)) {
        this.buf = "";
        return name;
      }
    }
    return null;
  }

  /** Whether `key` would continue a spell already at least `min` letters in. */
  casting(key: string, min = 3): boolean {
    if (key.length !== 1) return false;
    const next = normalise(this.buf + key);
    for (const phrase of Object.values(SPELLS)) {
      for (let n = Math.min(phrase.length, next.length); n > min; n--) {
        if (next.endsWith(phrase.slice(0, n))) return true;
      }
    }
    return false;
  }

  reset() {
    this.buf = "";
  }
}
