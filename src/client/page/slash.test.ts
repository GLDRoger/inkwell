import { afterEach, describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { baseExtensions } from "./Editor";
import { SLASH_ITEMS, filterSlashItems } from "./slash";
import { matchPages } from "./pageLinks";
import type { Page } from "@shared/types";

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

function editorWith(text: string) {
  editor = new Editor({ extensions: baseExtensions(), content: `<p>${text}</p>` });
  return editor;
}
const run = (id: string, text: string) => {
  const e = editorWith(text);
  // The "/query" occupies the paragraph: positions 1..1+text.length.
  SLASH_ITEMS.find((i) => i.id === id)!.run(e, { from: 1, to: 1 + text.length });
  return e;
};

describe("filterSlashItems", () => {
  it("lists everything for an empty query", () => expect(filterSlashItems("")).toHaveLength(SLASH_ITEMS.length));
  it("ranks title prefixes first", () => expect(filterSlashItems("h")[0].id).toBe("h1"));
  it("finds by keyword", () => expect(filterSlashItems("check").map((i) => i.id)).toContain("todo"));
  it("matches words inside titles", () => expect(filterSlashItems("list").map((i) => i.id)).toEqual(expect.arrayContaining(["bullets", "numbers", "todo"])));
  it("returns nothing for nonsense", () => expect(filterSlashItems("zzqq")).toEqual([]));
});

describe("slash commands on a real editor", () => {
  it("turns the line into a heading and removes the command text", () => {
    const e = run("h2", "/head");
    expect(e.getJSON().content![0]).toMatchObject({ type: "heading", attrs: { level: 2 } });
    expect(e.getJSON().content![0].content).toBeUndefined();
  });
  it("starts a to-do list", () => expect(run("todo", "/todo").getJSON().content![0].type).toBe("taskList"));
  it("inserts a 3×3 table", () => {
    const json: JSONContent = run("table", "/table").getJSON();
    const table = json.content!.find((n) => n.type === "table")!;
    expect(table.content).toHaveLength(3);
    expect(table.content![0].content).toHaveLength(3);
  });
  it("adds a divider", () => expect(run("divider", "/div").getJSON().content!.some((n) => n.type === "horizontalRule")).toBe(true));
  it("makes a quote and a code block", () => {
    expect(run("quote", "/quote").getJSON().content![0].type).toBe("blockquote");
    editor!.destroy();
    expect(run("code", "/code").getJSON().content![0].type).toBe("codeBlock");
  });
});

describe("page links", () => {
  const p = (id: string, title: string): Page => ({
    id, title, parentId: null, icon: null, position: "a", excerpt: "", x: null, y: null, coverUrl: null,
    createdAt: "", updatedAt: "", updatedBy: { kind: "person", id: "u", name: "U" },
  });
  const pages = [p("1", "Billing"), p("2", "Search"), p("3", "Billing FAQ")];
  it("excludes the current page and offers to create a missing one", () => {
    const items = matchPages(pages, "bil", "1");
    expect(items).toEqual([{ kind: "page", page: pages[2] }, { kind: "create", title: "bil" }]);
  });
  it("doesn't offer to create an exact match", () => {
    expect(matchPages(pages, "search", "1").some((i) => i.kind === "create")).toBe(false);
  });
});
