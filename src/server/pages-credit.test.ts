// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { afterEach, expect, it } from "vitest";
import { createServices, type Services } from "./services.ts";
import { createWorkspaceSession } from "./session.ts";
import { yDocToMarkdown } from "./editor-schema.ts";

let s: Services | undefined;
afterEach(async () => { await s?.close(); s = undefined; });

it("doesn't credit a visitor who only opened an agent's page", () => {
  s = createServices(fs.mkdtempSync(path.join(os.tmpdir(), "inkwell-credit-")));
  const ctx = createWorkspaceSession(s);
  const wren = { kind: "agent" as const, id: "wren", name: "Wren" };
  const page = s.pages.createPage(ctx.workspaceId, wren, { markdown: "# Packing\n\n- [ ] Passport\n- [x] Adapter" });
  const before = s.pages.getPage(ctx.workspaceId, page.id)!;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, s.pages.getPageRow(ctx.workspaceId, page.id)!.ydoc!);
  doc.getMap("__tiptap_position_migrations:root:default").set("1:1", { seen: [] });
  const after = s.pages.syncPageBody(ctx.workspaceId, page.id, {
    ydoc: Buffer.from(Y.encodeStateAsUpdate(doc)), markdown: yDocToMarkdown(doc), actor: ctx.person,
  })!;
  expect(after.updatedBy).toEqual(before.updatedBy);
  expect(after.updatedAt).toBe(before.updatedAt);
});

it("credits the visitor once they change the text", () => {
  s = createServices(fs.mkdtempSync(path.join(os.tmpdir(), "inkwell-credit-")));
  const ctx = createWorkspaceSession(s);
  const page = s.pages.createPage(ctx.workspaceId, { kind: "agent", id: "wren", name: "Wren" }, { markdown: "Hello" });
  const doc = new Y.Doc();
  Y.applyUpdate(doc, s.pages.getPageRow(ctx.workspaceId, page.id)!.ydoc!);
  ((doc.getXmlFragment("default").get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(5, " there");
  const after = s.pages.syncPageBody(ctx.workspaceId, page.id, {
    ydoc: Buffer.from(Y.encodeStateAsUpdate(doc)), markdown: yDocToMarkdown(doc), actor: ctx.person,
  })!;
  expect(after.updatedBy?.kind).toBe("person");
});
