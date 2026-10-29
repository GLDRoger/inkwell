import { describe, expect, it } from "vitest";
import { SpellBook } from "./spells";

const type = (book: SpellBook, s: string) => [...s].map((c) => book.push(c)).filter(Boolean);

describe("SpellBook", () => {
  it("hears both phrases, any case, amid other typing", () => {
    const b = new SpellBook();
    expect(type(b, "zzz I solemnly swear that I am up to no good")).toEqual(["reveal"]);
    expect(type(b, "Mischief managed")).toEqual(["hide"]);
    expect(type(b, "mischief manage")).toEqual([]);
  });

  it("holds single-key shortcuts while a phrase is being typed", () => {
    const b = new SpellBook();
    type(b, "mischie");
    expect(b.casting("f")).toBe(true);
    const c = new SpellBook();
    expect(c.casting("f")).toBe(false);
  });
});
