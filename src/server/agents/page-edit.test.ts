// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { getEditorSchema, markdownToTiptapJSON } from "../editor-schema.ts";
import { applyFind, applyRewrite, nearestSnippet, PAGE_CHANGED, readView } from "./page-edit.ts";

const p = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
/** A table whose body cell holds two paragraphs and a list: markdown can't express it. */
const richTable: JSONContent = { type: "table", content: [
  { type: "tableRow", content: [{ type: "tableHeader", content: [p("Plan")] }, { type: "tableHeader", content: [p("Notes")] }] },
  { type: "tableRow", content: [
    { type: "tableCell", content: [p("Pro"), p("billed yearly")] },
    { type: "tableCell", content: [{ type: "bulletList", content: [{ type: "listItem", content: [p("seats")] }] }] },
  ] },
] };
const docWithTable: JSONContent = { type: "doc", content: [p("Intro paragraph."), richTable, p("Closing paragraph.")] };
const same = (a: JSONContent, b: JSONContent) => getEditorSchema().nodeFromJSON(a).eq(getEditorSchema().nodeFromJSON(b));

describe("agent page edits", () => {
  it("edits only the matched block and leaves a multi-block table cell intact", () => {
    const { version } = readView(docWithTable);
    const { json, merged } = applyFind(docWithTable, version, "Closing paragraph.", "Closing, revised.");
    expect(merged).toBe(false);
    expect(same(json.content![1]!, richTable)).toBe(true);
    expect(json.content![2]).toEqual(p("Closing, revised."));
    expect(json.content![0]).toEqual(docWithTable.content![0]);
  });

  it("refuses to edit inside a table that markdown can't round-trip, rather than flattening it", () => {
    const { version } = readView(docWithTable);
    expect(() => applyFind(docWithTable, version, "Pro", "Team")).toThrow(/can't be edited as markdown/);
  });

  it("keeps blocks a rewrite left unchanged, including a table markdown can't express", () => {
    const view = readView(docWithTable);
    const rewritten = view.markdown.replace("Intro paragraph.", "New intro.");
    const json = applyRewrite(docWithTable, view.version, rewritten);
    expect(json.content![0]).toEqual(p("New intro."));
    expect(same(json.content![1]!, richTable)).toBe(true);
  });

  it("refuses a rewrite from a stale version", () => {
    const { version } = readView(docWithTable);
    const changed: JSONContent = { ...docWithTable, content: [...docWithTable.content!, p("A person typed this.")] };
    expect(() => applyRewrite(changed, version, "Agent text.")).toThrow(PAGE_CHANGED);
  });

  it("applies a stale-version edit to the current text when the target is unchanged (block merge)", () => {
    const base = markdownToTiptapJSON("First para.\n\nSecond para.");
    const { version } = readView(base);
    const current = markdownToTiptapJSON("First para.\n\nSecond para.\n\nA person typed this.");
    const { json, merged } = applyFind(current, version, "First para.", "First, polished.");
    expect(merged).toBe(true);
    expect(readView(json).markdown).toBe("First, polished.\n\nSecond para.\n\nA person typed this.");
  });

  it("says the page changed when a stale target text is gone", () => {
    const { version } = readView(markdownToTiptapJSON("Price: $10."));
    expect(() => applyFind(markdownToTiptapJSON("Price: $12."), version, "Price: $10.", "Price: $11.")).toThrow(PAGE_CHANGED);
  });

  it("tolerates whitespace differences and shows the nearest text when find is wrong", () => {
    const json = markdownToTiptapJSON("The quick brown fox jumps over the lazy dog.");
    const { version } = readView(json);
    expect(readView(applyFind(json, version, "quick  brown\nfox", "slow red fox").json).markdown).toBe("The slow red fox jumps over the lazy dog.");
    expect(() => applyFind(json, version, "quick brown cat", "x")).toThrow(/Copy find exactly from read_page\. Nearest text on the page: ".*quick brown/);
    expect(nearestSnippet("abc", "zzzzzzzz")).toBeNull();
  });

  it("rejects ambiguous text and can delete whole blocks", () => {
    const json = markdownToTiptapJSON("Keep.\n\nDrop me.\n\nKeep.");
    const { version } = readView(json);
    expect(() => applyFind(json, version, "Keep.", "x")).toThrow(/more than once/);
    expect(readView(applyFind(json, version, "\n\nDrop me.", "").json).markdown).toBe("Keep.\n\nKeep.");
  });
});
