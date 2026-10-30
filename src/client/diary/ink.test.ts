import { describe, expect, it } from "vitest";
import { HAND_MAX, handCut, handSegments, renderMarkdown, sliceSegments, stripInline } from "./ink";

describe("handCut", () => {
  it("writes a short reply entirely by hand", () => {
    const t = "Done. I tidied Billing.";
    expect(handCut(t)).toBe(t.length);
  });

  it("stops the hand at the first sentence end after the opening", () => {
    const t = "I read Billing and Search, then rewrote the overview so it reads cleanly. Here is what changed in detail across the pages.";
    const cut = handCut(t);
    expect(t.slice(0, cut)).toBe("I read Billing and Search, then rewrote the overview so it reads cleanly. ");
  });

  it("stops at a block break", () => {
    const t = "Here's the plan:\n\n- one\n- two";
    expect(t.slice(0, handCut(t))).toBe("Here's the plan:");
  });

  it("gives a reply that opens with a list no handwriting", () => {
    expect(handCut("- one\n- two")).toBe(0);
  });

  it("caps long unpunctuated openings at a word boundary", () => {
    const t = "word ".repeat(80);
    const cut = handCut(t);
    expect(cut).toBeLessThanOrEqual(HAND_MAX + 1);
    expect(t[cut - 1]).toBe(" ");
  });

  it("doesn't move once decided, as more text streams in", () => {
    const full = "I read Billing and Search, then rewrote the overview so it reads cleanly. Then I linked the pages together and added a summary.";
    const cut = handCut(full);
    expect(cut).toBeGreaterThan(0);
    for (let n = cut; n <= full.length; n++) expect(handCut(full.slice(0, n))).toBe(cut);
  });
});

describe("stripInline / renderMarkdown", () => {
  it("drops inline syntax from the handwriting", () => {
    expect(stripInline("I **rewrote** [Billing](/p/b1) and `fixed` it")).toBe("I rewrote Billing and fixed it");
  });
  it("sanitises rendered markdown", () => {
    const html = renderMarkdown("Hi <img src=x onerror=alert(1)> [x](javascript:alert(1))");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });
});

describe("handSegments: links stay clickable in the handwriting", () => {
  it("keeps a page link in a short handwritten reply", () => {
    const t = "Done. I tidied [Billing](/p/b1) for you.";
    expect(handCut(t)).toBe(t.length); // the whole reply is handwritten
    expect(handSegments(t)).toEqual([
      { text: "Done. I tidied " },
      { text: "Billing", href: "/p/b1" },
      { text: " for you." },
    ]);
  });

  it("keeps web links and drops emphasis syntax", () => {
    expect(handSegments("See **[the docs](https://example.com)** and `x`")).toEqual([
      { text: "See " },
      { text: "the docs", href: "https://example.com" },
      { text: " and x" },
    ]);
  });

  it("turns unsafe targets into plain ink", () => {
    expect(handSegments("[click](javascript:alert(1))")).toEqual([{ text: "click" }]);
    expect(handSegments("[x](data:text/html,hi) and [y](//evil.example)")).toEqual([{ text: "x and y" }]);
  });

  it("reveals a prefix across segments without losing the link", () => {
    const segs = handSegments("Read [Billing](/p/b1) now");
    expect(sliceSegments(segs, 8)).toEqual([{ text: "Read " }, { text: "Bil", href: "/p/b1" }]);
    expect(sliceSegments(segs, 100).map((s) => s.text).join("")).toBe("Read Billing now");
  });
});
