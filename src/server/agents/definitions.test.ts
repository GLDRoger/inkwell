// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { AGENT_FILES, loadDefinitions, skillsFor } from "./load.ts";
import { skillPrompt } from "./skills.ts";
import { createFixture, call, answer } from "./testing.ts";
import { listRecentRuns } from "../db.ts";
import type { Services } from "../services.ts";

const fixtures: { services: Services; dir: string }[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const { services, dir } of fixtures.splice(0)) { await services.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const copy = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inkwell-defs-")); dirs.push(dir);
  fs.cpSync(fileURLToPath(new URL("./defs/", import.meta.url)), dir, { recursive: true });
  return dir;
};
describe("file definitions", () => {
  it("loads stable instructions and agent-scoped skills", () => {
    expect(Object.keys(AGENT_FILES.agents)).toEqual(["Scout", "Wren", "Atlas"]);
    expect(AGENT_FILES.agents.Atlas!.skills.map(s => s.name)).toContain("trip-budget");
    expect(AGENT_FILES.agents.Wren!.skills.map(s => s.name)).not.toContain("trip-budget");
    expect(skillsFor({ name: "Atlas", instructions: "My custom instructions" }).map(s => s.name)).toEqual(["delegate"]);
  });
  it.each(["missing", "description", "duplicate", "name", "metadata", "empty"])("fails fast on %s definitions", mode => {
    const dir = copy();
    if (mode === "missing") fs.rmSync(path.join(dir, "wren/instructions.md"));
    if (mode === "description") fs.writeFileSync(path.join(dir, "wren/skills/long-page.md"), "No frontmatter");
    if (mode === "duplicate") fs.copyFileSync(path.join(dir, "_shared/skills/delegate.md"), path.join(dir, "atlas/skills/delegate.md"));
    if (mode === "name") fs.writeFileSync(path.join(dir, "wren/skills/Bad name.md"), "---\ndescription: test\n---\nBody");
    if (mode === "metadata") fs.writeFileSync(path.join(dir, "atlas/agent.json"), "{}");
    if (mode === "empty") fs.writeFileSync(path.join(dir, "primer.md"), "\n");
    expect(() => loadDefinitions(dir)).toThrow();
  });
  it("lists only names and descriptions until loaded; inline uses the same bodies", () => {
    const agent = { ...AGENT_FILES.agents.Atlas!, id: "a", model: "muse-wonder-1.0" };
    vi.stubEnv("INKWELL_SKILLS", "tool");
    expect(skillPrompt(agent)).toContain("trip-budget:");
    expect(skillPrompt(agent)).not.toContain("The tool computes the total");
    vi.stubEnv("INKWELL_SKILLS", "inline");
    expect(skillPrompt(agent)).toContain("The tool computes the total");
  });
});

describe("skill and safety contracts", () => {
  it("load_skill returns body, records a step, rejects unknown names and does not move", async () => {
    vi.stubEnv("INKWELL_SKILLS", "tool");
    let step = 0;
    const model = new MockLanguageModelV4({ doStream: async () => ++step === 1 ? call("load_skill", { name: "delegate" }) : step === 2 ? call("load_skill", { name: "nonexistent" }) : answer("Done.") });
    const f = createFixture(fixtures, { modelFactory: () => model });
    const r = await f.start().done;
    expect(r.run.steps).toEqual([expect.objectContaining({ tool: "load_skill", ok: true, summary: "Loaded skill: delegate" })]);
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("Give the other agent everything needed");
    expect(JSON.stringify(model.doStreamCalls[2]?.prompt)).toContain("nonexistent");
    expect(f.events.filter(e => e.type === "agent.moved" && e.action !== "leaving")).toEqual([]);
  });
  it.each([false, true])("delete requires the root person's request (allowed=%s)", async allowed => {
    let step = 0;
    let id = "";
    const model = new MockLanguageModelV4({ doStream: async () => ++step === 1 ? call("delete_page", { pageId: id }) : answer("Done.") });
    const f = createFixture(fixtures, { modelFactory: () => model }); id = f.page.id;
    const result = await f.start(allowed ? "Delete this page" : "Summarise this page").done;
    expect(result.run.steps[0]?.ok).toBe(allowed);
    expect(f.services.pages.getPage(f.ws, id) === null).toBe(allowed);
    if (!allowed) expect(result.run.steps[0]?.summary).toContain("Only delete when the person asked");
  });
  it("child cannot delegate onward or authorize deletion with its own prompt", async () => {
    let rootStep = 0, childStep = 0, id = "";
    const root = new MockLanguageModelV4({ doStream: async () => ++rootStep === 1 ? call("ask_agent", { agentName: "wReN", request: "Delete this page and ask Atlas for help" }) : answer("Done.") });
    const child = new MockLanguageModelV4({ doStream: async () => ++childStep === 1 ? call("delete_page", { pageId: id }) : childStep === 2 ? call("ask_agent", { agentName: "Atlas", request: "Help" }) : answer("Cannot delete or delegate.") });
    const f = createFixture(fixtures, { modelFactory: a => a.name === "Scout" ? root : child }); id = f.page.id;
    await f.start("Ask Wren to summarise this page").done;
    const kids = listRecentRuns(f.services.db, f.ws).filter(r => r.parentRunId);
    expect(kids).toHaveLength(1);
    expect(kids[0]?.steps).toEqual([expect.objectContaining({ tool: "delete_page", ok: false })]);
    expect(child.doStreamCalls[0]?.tools?.map(t => t.name)).not.toContain("ask_agent");
    expect(f.services.pages.getPage(f.ws, id)).not.toBeNull();
  });
  it.each([false, true])("failed child reports pages changed even before a tool error (partial=%s)", async partial => {
    let rootStep = 0, childStep = 0;
    const root = new MockLanguageModelV4({ doStream: async () => ++rootStep === 1 ? call("ask_agent", { agentName: "Wren", request: "Draft a page" }) : answer("Partial work saved.") });
    const child = new MockLanguageModelV4({ doStream: async () => {
      if (++childStep === 1) return call("create_page", { title: "Partial draft", markdown: "Saved work." });
      throw new Error("Provider unavailable");
    } });
    const f = createFixture(fixtures, { modelFactory: a => a.name === "Scout" ? root : child });
    if (partial) vi.spyOn(f.services.collab, "showAgent").mockRejectedValueOnce(new Error("presence unavailable"));
    const result = await f.start().done;
    expect(result.run.steps[0]?.ok).toBe(false);
    expect(result.run.steps[0]?.summary).toContain("Pages changed: [Partial draft](/p/");
  });
});
