// @vitest-environment node
import { describe, expect, it } from "vitest";
import { markdownToTiptapJSON, tiptapJSONToMarkdown } from "./editor-schema.ts";

const para = (...texts: string[]) => ({ type: "doc", content: texts.map(text => ({ type: "paragraph", content: [{ type: "text", text }] })) });

describe("markdown that agents read", () => {
  it("shows &, < and > as the person typed them", () => {
    expect(tiptapJSONToMarkdown(para("fish & chips", "1 < 2 && 3 > 2"))).toBe("fish & chips\n\n1 < 2 && 3 > 2\n");
  });
  it("still escapes what would parse as HTML, an entity or a blockquote, and round-trips", () => {
    const doc = para("> not a quote", "a <div> tag", "literally &copy;");
    const md = tiptapJSONToMarkdown(doc);
    expect(md).toBe("&gt; not a quote\n\na &lt;div> tag\n\nliterally &amp;copy;\n");
    expect(markdownToTiptapJSON(md)).toEqual(doc);
  });
});
