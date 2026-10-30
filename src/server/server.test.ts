// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MapGraph, Page, PageWithBody } from "../shared/types.ts";
import * as Y from "yjs";
import { appendRunStep, getRun, insertRun, updateRun } from "./db.ts";
import {
  COLLAB_FIELD,
  appendJSONToYDoc,
  applyJSONToYDoc,
  excerptFromMarkdown,
  extractPageLinkIds,
  markdownToTiptapJSON,
  markdownToYDoc,
  markdownToYDocBytes,
  tiptapJSONToMarkdown,
  yDocBytesToMarkdown,
  yDocToMarkdown,
} from "./editor-schema.ts";
import { createEventBus } from "./events.ts";
import { createApp } from "./main.ts";
import { createServices, type Services } from "./services.ts";

interface TestClient {
  request: (pathname: string, init?: RequestInit) => Promise<Response>;
  cookie: string;
}

let services: Services;
let app: ReturnType<typeof createApp>;
let dataDir: string;

async function newClient(): Promise<TestClient> {
  const res = await app.request("/api/me");
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0]!;
  expect(cookie).toContain("inkwell_sid=");
  return {
    cookie,
    request: async (pathname, init = {}) =>
      app.request(pathname, {
        ...init,
        headers: { Cookie: cookie, ...(init.headers ?? {}) },
      }),
  };
}

async function createPage(client: TestClient, body: object): Promise<Page> {
  const res = await client.request("/api/pages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Page;
}

beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkwell-test-"));
  services = createServices(dataDir);
  app = createApp(services);
});

afterAll(async () => {
  await services.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("session + seed", () => {
  it("health and cookieless non-bootstrap requests do not seed workspaces", async () => {
    const count = () => (services.db.prepare("SELECT count(*) AS n FROM workspaces").get() as { n: number }).n;
    const before = count();
    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
    expect(health.headers.get("set-cookie")).toBeNull();
    for (const url of ["/api/map", "/api/events", "/api/pages", "/api/nope"]) {
      const result = await app.request(url);
      expect(result.status).toBe(401);
      expect(result.headers.get("set-cookie")).toBeNull();
    }
    expect(count()).toBe(before);
  });

  it("creates a workspace on first request and seeds the demo notebook", async () => {
    const client = await newClient();
    const me = (await (await client.request("/api/me")).json()) as {
      workspaceId: string;
      person: { name: string };
    };
    expect(me.workspaceId).toBeTruthy();
    expect(me.person.name).toMatch(/^Visitor /);

    const map = (await (await client.request("/api/map")).json()) as MapGraph;
    expect(map.pages.length).toBeGreaterThanOrEqual(14);
    expect(map.agents.map((a) => a.name)).toEqual(["Scout", "Wren", "Atlas"]);
    expect(map.links.length).toBeGreaterThan(0);
    expect(map.pages.every((p) => p.x !== null && p.y !== null)).toBe(true);

    const titles = map.pages.map((p) => p.title);
    expect(titles).toContain("Trip to Lisbon");
    expect(titles).toContain("Startup: launch plan");
    expect(titles).toContain("Reading notes");
    expect(titles).toContain("Recipes");
  });

  it("attributes the demo pages to Atlas and seeds a completed run at each agent's hub", async () => {
    const client = await newClient();
    const map = await (await client.request("/api/map")).json() as MapGraph;
    const atlas = map.agents.find((a) => a.name === "Atlas")!;
    expect(map.pages.every((p) => p.updatedBy.kind === "agent" && p.updatedBy.id === atlas.id && p.updatedBy.name === "Atlas")).toBe(true);
    expect(map.runs).toHaveLength(3);
    const hubs: Record<string, string> = { Atlas: "Startup: launch plan", Scout: "Reading notes", Wren: "Trip to Lisbon" };
    for (const agent of map.agents) {
      const run = map.runs.find((r) => r.agentId === agent.id)!;
      expect(run).toMatchObject({ status: "succeeded", error: null, endedAt: expect.any(String) });
      expect(map.pages.find((p) => p.id === run.pageId)?.title).toBe(hubs[agent.name]);
      expect(run.steps.length).toBeGreaterThanOrEqual(1);
      expect(run.steps.length).toBeLessThanOrEqual(2);
      expect(run.steps.every((s) => s.ok && s.pageId === run.pageId)).toBe(true);
    }
    const threads = await (await client.request("/api/diary")).json() as { id: string }[];
    const entries = await (await client.request(`/api/diary/${threads[0]!.id}`)).json() as { agentId: string }[];
    expect(entries[0]!.agentId).toBe(atlas.id);
    expect((await (await client.request("/api/map")).json() as MapGraph).runs).toEqual(map.runs);
  });

  it("resumes the same workspace with the cookie", async () => {
    const client = await newClient();
    const first = (await (await client.request("/api/me")).json()) as { workspaceId: string };
    const again = await app.request("/api/me", { headers: { Cookie: client.cookie } });
    const second = (await again.json()) as { workspaceId: string };
    expect(second.workspaceId).toBe(first.workspaceId);
    expect(again.headers.get("set-cookie")).toBeNull();
  });

  it("gives a second visitor their own seeded workspace", async () => {
    const a = await newClient();
    const b = await newClient();
    const meA = (await (await a.request("/api/me")).json()) as { workspaceId: string };
    const meB = (await (await b.request("/api/me")).json()) as { workspaceId: string };
    expect(meB.workspaceId).not.toBe(meA.workspaceId);
    const mapB = (await (await b.request("/api/map")).json()) as MapGraph;
    expect(mapB.pages.length).toBeGreaterThanOrEqual(14);
  });
});

describe("page CRUD + workspace isolation (the attack)", () => {
  it("another session cannot read, patch, delete or find my page", async () => {
    const owner = await newClient();
    const attacker = await newClient();
    const page = await createPage(owner, {
      title: "Secret plans",
      markdown: "# Secret\n\nThe launch code is zebrafish42.",
    });

    expect((await attacker.request(`/api/pages/${page.id}`)).status).toBe(404);
    expect(
      (
        await attacker.request(`/api/pages/${page.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Pwned" }),
        })
      ).status,
    ).toBe(404);
    expect(
      (await attacker.request(`/api/pages/${page.id}`, { method: "DELETE" })).status,
    ).toBe(404);

    const attackerPages = (await (await attacker.request("/api/pages")).json()) as Page[];
    expect(attackerPages.some((p) => p.id === page.id)).toBe(false);

    const attackerSearch = (await (
      await attacker.request("/api/search?q=zebrafish42")
    ).json()) as unknown[];
    expect(attackerSearch).toHaveLength(0);

    const intact = (await (await owner.request(`/api/pages/${page.id}`)).json()) as PageWithBody;
    expect(intact.title).toBe("Secret plans");
    expect(intact.markdown).toContain("zebrafish42");
  });

  it("creates, patches and soft-deletes pages (with subtree)", async () => {
    const client = await newClient();
    const parent = await createPage(client, { title: "Parent", markdown: "parent body" });
    const child = await createPage(client, { title: "Child", parentId: parent.id });

    const patchedRes = await client.request(`/api/pages/${child.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Child v2", x: 42, y: -7 }),
    });
    const patched = (await patchedRes.json()) as Page;
    expect(patched.title).toBe("Child v2");
    expect(patched.x).toBe(42);
    expect(patched.y).toBe(-7);

    // Moving a page into its own subtree is rejected.
    const cycle = await client.request(`/api/pages/${parent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: child.id }),
    });
    expect(cycle.status).toBe(400);

    expect(
      (await client.request(`/api/pages/${parent.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    expect((await client.request(`/api/pages/${parent.id}`)).status).toBe(404);
    expect((await client.request(`/api/pages/${child.id}`)).status).toBe(404);
  });

  it("validates bodies", async () => {
    const client = await newClient();
    const bad = await client.request("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: "not-a-number" }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBeTruthy();
  });
});

describe("markdown <-> Yjs round trip", () => {
  const md = [
    "# Heading",
    "",
    "A paragraph with **bold** and a [link](/p/abc123).",
    "",
    "- one",
    "- two",
    "",
    "1. first",
    "2. second",
    "",
    "- [ ] todo item",
    "- [x] done item",
    "",
    "> quoted wisdom",
    "",
    "```ts",
    "const x = 1;",
    "```",
    "",
    "| A | B |",
    "| --- | --- |",
    "| cell-1 | cell-2 |",
    "",
  ].join("\n");

  it("round-trips block types through JSON", () => {
    const out = tiptapJSONToMarkdown(markdownToTiptapJSON(md));
    for (const needle of [
      "# Heading",
      "**bold**",
      "[link](/p/abc123)",
      "- one",
      "1. first",
      "- [ ] todo item",
      "- [x] done item",
      "> quoted wisdom",
      "const x = 1;",
      "cell-1",
    ]) {
      expect(out).toContain(needle);
    }
  });

  it("round-trips through Yjs bytes", () => {
    const out = yDocBytesToMarkdown(markdownToYDocBytes(md));
    expect(out).toContain("# Heading");
    expect(out).toContain("todo item");
    expect(out).toContain("cell-2");
  });

  it("replace diffs the live doc: unchanged blocks keep their Yjs identity", () => {
    const doc = markdownToYDoc("# Title\n\nKeep me.\n\nChange me.\n");
    const fragment = doc.getXmlFragment(COLLAB_FIELD);
    const [heading, kept] = [fragment.get(0), fragment.get(1)];
    doc.transact(() =>
      applyJSONToYDoc(doc, markdownToTiptapJSON("# Title\n\nKeep me.\n\nChanged.\n")),
    );
    expect(fragment.get(0)).toBe(heading);
    expect(fragment.get(1)).toBe(kept);
    expect(yDocToMarkdown(doc)).toBe("# Title\n\nKeep me.\n\nChanged.\n");
  });

  it("append adds blocks after existing ones without rewriting them", () => {
    const doc = markdownToYDoc("First.\n");
    const fragment = doc.getXmlFragment(COLLAB_FIELD);
    const first = fragment.get(0);
    appendJSONToYDoc(doc, markdownToTiptapJSON("## Added\n\n- [ ] a task\n"));
    expect(fragment.get(0)).toBe(first);
    expect(yDocToMarkdown(doc)).toBe("First.\n\n## Added\n\n- [ ] a task\n");

    // Appending to an empty page replaces its lone empty paragraph.
    const empty = markdownToYDoc("");
    appendJSONToYDoc(empty, markdownToTiptapJSON("Hello."));
    expect(empty.getXmlFragment(COLLAB_FIELD).length).toBe(1);
    expect(yDocToMarkdown(empty)).toBe("Hello.\n");
    expect(Y.encodeStateAsUpdate(empty).length).toBeGreaterThan(0);
  });

  it("POST /api/pages with markdown stores a real Yjs doc", async () => {
    const client = await newClient();
    const page = await createPage(client, { title: "RT", markdown: md });
    const body = (await (await client.request(`/api/pages/${page.id}`)).json()) as PageWithBody;
    expect(body.markdown).toContain("# Heading");

    const { workspaceId } = (await (await client.request("/api/me")).json()) as {
      workspaceId: string;
    };
    const row = services.pages.getPageRow(workspaceId, page.id);
    expect(row?.ydoc && row.ydoc.length > 0).toBe(true);
    expect(yDocBytesToMarkdown(row!.ydoc)).toContain("quoted wisdom");
  });
});

describe("links + search", () => {
  it("extracts /p/<id> links into the map graph", async () => {
    const client = await newClient();
    const target = await createPage(client, { title: "Target", markdown: "target body" });
    const source = await createPage(client, {
      title: "Source",
      markdown: `See [the target](/p/${target.id}) for details.`,
    });
    const map = (await (await client.request("/api/map")).json()) as MapGraph;
    expect(map.links).toContainEqual({ from: source.id, to: target.id });
  });

  it("excerpts skip a first line that repeats the title", () => {
    expect(excerptFromMarkdown("# Garden\n\nTomatoes and basil.", 600, "Garden")).toBe(
      "Tomatoes and basil.",
    );
    expect(excerptFromMarkdown("# Garden\n\nTomatoes.", 600, "Other")).toBe("Garden\nTomatoes.");
  });

  it("extractPageLinkIds dedupes", () => {
    expect(extractPageLinkIds("[a](/p/x1) [b](/p/x1) [c](/p/y2)")).toEqual(["x1", "y2"]);
  });

  it("searches title and body with a snippet", async () => {
    const client = await newClient();
    const seeded = (await (await client.request("/api/search?q=Lisbon")).json()) as {
      page: Page;
      snippet: string;
    }[];
    expect(seeded.some((r) => r.page.title === "Trip to Lisbon")).toBe(true);
    expect(seeded[0]!.snippet.length).toBeGreaterThan(0);
    // Snippets are readable text: no markdown link syntax or page ids.
    for (const r of seeded) expect(r.snippet).not.toMatch(/\]\(|\/p\//);

    await createPage(client, { title: "Unique", markdown: "contains flibbertygibbet" });
    const found = (await (
      await client.request("/api/search?q=flibberty")
    ).json()) as { page: Page }[];
    expect(found.some((r) => r.page.title === "Unique")).toBe(true);
  });
});

describe("agents, diary reads, uploads", () => {
  it("creates agents and reads the seeded diary thread", async () => {
    const client = await newClient();
    const created = await client.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Pixel",
        description: "Draws maps",
        instructions: "You draw.",
        color: "#123456",
      }),
    });
    expect(created.status).toBe(201);
    const agents = (await (await client.request("/api/agents")).json()) as { name: string }[];
    expect(agents.map((a) => a.name)).toContain("Pixel");

    const threads = (await (await client.request("/api/diary")).json()) as {
      id: string;
      title: string;
    }[];
    expect(threads.length).toBeGreaterThan(0);
    const entries = (await (
      await client.request(`/api/diary/${threads[0]!.id}`)
    ).json()) as { role: string; text: string }[];
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]!.text).toContain("Welcome");

    expect((await client.request("/api/diary/does-not-exist")).status).toBe(404);
  });

  it("stores uploads and serves them only to the owning workspace", async () => {
    const owner = await newClient();
    const other = await newClient();
    const form = new FormData();
    form.set("file", new File([new Uint8Array([137, 80, 78, 71])], "dot.png", { type: "image/png" }));
    const res = await owner.request("/api/uploads", { method: "POST", body: form });
    expect(res.status).toBe(201);
    const attachment = (await res.json()) as { id: string; url: string; kind: string };
    expect(attachment.url).toBe(`/api/files/${attachment.id}`);
    expect(attachment.kind).toBe("image");

    const served = await owner.request(attachment.url);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toContain("image/png");

    expect((await other.request(attachment.url)).status).toBe(404);

    // User content must never run as script on our origin.
    expect(served.headers.get("content-security-policy")).toContain("sandbox");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");

    const big = new FormData();
    big.set("file", new File([new Uint8Array(22 * 1024 * 1024)], "big.png", { type: "image/png" }));
    expect((await owner.request("/api/uploads", { method: "POST", body: big })).status).toBe(413);

    const badForm = new FormData();
    badForm.set("file", new File(["hello"], "note.txt", { type: "text/plain" }));
    expect((await owner.request("/api/uploads", { method: "POST", body: badForm })).status).toBe(415);
  });
});

describe("runs", () => {
  it("records runs and steps and shows recent runs on the owner's map only", async () => {
    const owner = await newClient();
    const other = await newClient();
    const { workspaceId } = (await (await owner.request("/api/me")).json()) as {
      workspaceId: string;
    };
    const map = (await (await owner.request("/api/map")).json()) as MapGraph;
    const agent = map.agents[0]!;
    const page = map.pages[0]!;

    const run = insertRun(services.db, workspaceId, { agentId: agent.id, prompt: "Tidy up" });
    expect(run.status).toBe("queued");
    updateRun(services.db, workspaceId, run.id, { status: "running" });
    appendRunStep(
      services.db,
      workspaceId,
      run.id,
      { tool: "read_page", summary: `Read ${page.title}`, pageId: page.id, ok: true },
      { movePage: true },
    );
    const done = updateRun(services.db, workspaceId, run.id, { status: "succeeded" })!;
    expect(done.endedAt).toBeTruthy();
    expect(done.pageId).toBe(page.id);
    expect(getRun(services.db, workspaceId, run.id)!.steps).toHaveLength(1);

    const ownerRuns = ((await (await owner.request("/api/map")).json()) as MapGraph).runs;
    expect(ownerRuns.map((r) => r.id)).toContain(run.id);
    const otherRuns = ((await (await other.request("/api/map")).json()) as MapGraph).runs;
    expect(otherRuns.map((r) => r.id)).not.toContain(run.id);
    // Another workspace can't touch the run through the helpers either.
    const otherWs = ((await (await other.request("/api/me")).json()) as { workspaceId: string })
      .workspaceId;
    expect(updateRun(services.db, otherWs, run.id, { status: "failed" })).toBeNull();
  });

  it("keeps the latest run per agent and all active runs, beyond age and count cutoffs", async () => {
    const client = await newClient();
    const { workspaceId } = await (await client.request("/api/me")).json() as { workspaceId: string };
    const map = await (await client.request("/api/map")).json() as MapGraph;
    const agent = map.agents[0]!;
    const activeIds: string[] = [];
    const sameTime = "2000-01-01T00:00:00.000Z";
    services.db.prepare("UPDATE runs SET created_at = ? WHERE workspace_id = ?").run(sameTime, workspaceId);
    for (let i = 0; i < 55; i++) {
      const run = insertRun(services.db, workspaceId, { agentId: agent.id, prompt: `Active ${i}`, status: i % 2 ? "queued" : "running" });
      services.db.prepare("UPDATE runs SET created_at = ? WHERE id = ?").run(sameTime, run.id);
      activeIds.push(run.id);
    }
    const latest = insertRun(services.db, workspaceId, { agentId: agent.id, prompt: "Latest" });
    updateRun(services.db, workspaceId, latest.id, { status: "succeeded" });
    services.db.prepare("UPDATE runs SET created_at = ? WHERE id = ?").run(sameTime, latest.id);
    const runs = (await (await client.request("/api/map")).json() as MapGraph).runs;
    expect(runs.map((r) => r.id)).toEqual([latest.id, ...activeIds.reverse(), ...map.runs.filter((r) => r.agentId !== agent.id).map((r) => r.id)]);
    expect(new Set(runs.map((r) => r.id)).size).toBe(runs.length);
    // Timestamp order wins over insertion order, including between agents.
    const olderSeed = map.runs.find((r) => r.agentId !== agent.id)!;
    services.db.prepare("UPDATE runs SET created_at = ? WHERE id = ?").run("2001-01-01T00:00:00.000Z", olderSeed.id);
    const reordered = (await (await client.request("/api/map")).json() as MapGraph).runs;
    expect(reordered.map((r) => r.id)).toEqual([olderSeed.id, ...runs.filter((r) => r.id !== olderSeed.id).map((r) => r.id)]);
  });

  it("answers unknown API routes with a JSON 404", async () => {
    const client = await newClient();
    const res = await client.request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found.", code: "not_found" });
  });
});

describe("event bus fan-out", () => {
  it("only delivers to the publishing workspace", () => {
    const bus = createEventBus();
    const seenA: string[] = [];
    const seenB: string[] = [];
    const unsubA = bus.subscribe("ws-a", (e) => seenA.push(e.type));
    bus.subscribe("ws-b", (e) => seenB.push(e.type));
    bus.publish("ws-a", { type: "page.deleted", pageId: "p1" });
    expect(seenA).toEqual(["page.deleted"]);
    expect(seenB).toEqual([]);
    unsubA();
    bus.publish("ws-a", { type: "page.deleted", pageId: "p2" });
    expect(seenA).toHaveLength(1);
  });

  it("emits page.created through the bus on create", async () => {
    const client = await newClient();
    const { workspaceId } = (await (await client.request("/api/me")).json()) as {
      workspaceId: string;
    };
    const events: string[] = [];
    const unsub = services.bus.subscribe(workspaceId, (e) => events.push(e.type));
    await createPage(client, { title: "Eventful" });
    unsub();
    expect(events).toContain("page.created");
  });
});
