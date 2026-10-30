import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { Agent, DiaryEntry, MapGraph, Page, Run, RunStep } from "@shared/types";
import { keys } from "../lib/queries";
import { Entries } from "./Entries";

const scout: Agent = { id: "scout", name: "Scout", description: "", instructions: "", color: "#c0602f", model: "muse-spark-1" };
const wren: Agent = { id: "wren", name: "Wren", description: "", instructions: "", color: "#3b7a58", model: "muse-spark-1" };
const step = (tool: string, summary: string, pageId: string | null = null): RunStep => ({ at: "", tool, summary, pageId, ok: true });
const run = (status: Run["status"], extra: Partial<Run> = {}): Run => ({
  id: "r1", agentId: "scout", threadId: "t1", parentRunId: null, prompt: "Plan my 5 days in Lisbon", status, pageId: null, error: null,
  steps: [step("search_pages", "Searched for lisbon")], createdAt: "", endedAt: null, ...extra,
});
const asked: DiaryEntry = { id: "e1", threadId: "t1", role: "person", agentId: null, text: "Plan my 5 days in Lisbon", pageIds: [], attachments: [], runId: null, createdAt: "2026-10-30T10:00:00Z" };
const reply = (text: string): DiaryEntry => ({ ...asked, id: "e2", role: "agent", agentId: "scout", text, runId: "r1", createdAt: "2026-10-30T10:00:01Z" });

function show(entry: DiaryEntry, r: Run, opts: { runs?: Run[]; pages?: Partial<Page>[]; recoverable?: boolean; readOnly?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(keys.run(r.id), r);
  client.setQueryData<MapGraph>(keys.map, { pages: [], links: [], agents: [scout, wren], runs: opts.runs ?? [] });
  client.setQueryData(keys.pages, opts.pages ?? []);
  const onRecover = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Entries
          entries={[asked, entry]}
          agents={[scout, wren]}
          liveIds={[]}
          hiddenId={null}
          recoverableId={opts.recoverable === false ? null : entry.id}
          onCancel={() => {}}
          onRecover={onRecover}
          readOnly={opts.readOnly}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onRecover };
}

afterEach(cleanup);

const MODEL_FAILED = "The Meta model couldn't complete this request. Check the API configuration and try again.";

describe("a failed reply", () => {
  it("offers Try again, which resends the request, and isn't signed", () => {
    const failed = run("failed", { error: MODEL_FAILED, model: "muse-spark-1.3-contributor" });
    const { onRecover } = show(reply(`Gathering the pages for this.\n\n${MODEL_FAILED}`), failed);
    expect(screen.getByText("Muse Spark couldn't finish this one.")).toBeTruthy();
    expect(screen.queryByText("Gathering the pages for this.")).toBeNull();
    expect(screen.queryByText(/Written with/)).toBeNull();
    expect(document.querySelector(".signature")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRecover).toHaveBeenCalledWith(expect.objectContaining({ id: "e2" }), failed, "retry");
  });

  it("keeps a partial answer but leaves it unsigned", () => {
    show(reply(`Day 1 is Alfama.\n\n${MODEL_FAILED}`), run("failed", { error: MODEL_FAILED }));
    expect(screen.getByText("Day 1 is Alfama.")).toBeTruthy();
    expect(screen.queryByText(/Written with/)).toBeNull();
  });

  it("offers Continue when the agent ran out of steps, and nothing when no key is set", () => {
    const limit = "The agent reached its step limit. Ask it to continue from the changes already made.";
    show(reply(limit), run("failed", { error: limit }));
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  });

  it("says which pages it had already made before it failed, and still offers Try again", () => {
    const failed = run("failed", { error: MODEL_FAILED, model: "muse-spark-1.3-contributor", steps: [step("search_pages", "Searched for launch"), step("create_page", "Created Summary: Startup: launch plan", "p1")] });
    show(reply(`Drafting the summary now\n\n${MODEL_FAILED}`), failed, { pages: [{ id: "p1", title: "Summary: Startup: launch plan", icon: null } as Partial<Page>] });
    expect(document.querySelector(".step-note-text")?.textContent).toBe("Muse Spark stopped partway. Scout had already made Summary: Startup: launch plan.");
    expect(screen.getByRole("link", { name: "Summary: Startup: launch plan" }).getAttribute("href")).toBe("/p/p1");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("only offers Try again on the latest reply", () => {
    show(reply(MODEL_FAILED), run("failed", { error: MODEL_FAILED }), { recoverable: false });
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("a finished reply", () => {
  it("is signed, without its opening narration, and quotes are signed by who wrote them", () => {
    const text = "Let me find the right page before I bring in Wren.\n\nI found [Weeknight dinners](/p/w) and handed it to Wren. Their report:\n\n> Looking through the notebook for material.\n>\n> Drafted a plan. Ask me to expand any step.";
    show(reply(text), run("succeeded", { steps: [step("search_pages", "Searched for dinners"), step("ask_agent", "Asked Wren for help")] }));
    expect(screen.queryByText(/Let me find the right page/)).toBeNull();
    expect(screen.queryByText(/Looking through the notebook/)).toBeNull();
    expect(screen.getByText(/Written with Muse Spark/)).toBeTruthy();
    expect(document.querySelector("blockquote .quote-by")?.textContent).toBe("— Wren");
  });

  it("credits the model the run used, and says when it was recorded", () => {
    show(reply("Done. I made the plan."), run("succeeded", { model: "muse-wonder-1.0", recorded: true }));
    expect(screen.getByText("Recorded run · Muse Wonder")).toBeTruthy();
    expect(screen.queryByText(/Written with/)).toBeNull();
  });
});

describe("a stopped reply", () => {
  it("says which pages were already made, as links", () => {
    const parent = run("cancelled", { steps: [step("search_pages", "Searched for lisbon"), step("ask_agent", "Asked Wren for help")] });
    const child = run("cancelled", { id: "r2", agentId: "wren", parentRunId: "r1", steps: [step("create_page", "Created Packing list", "p2")] });
    show(reply("Let me find the right page before I bring in Wren."), parent, { runs: [child], pages: [{ id: "p2", title: "Packing list", icon: null } as Partial<Page>] });
    expect(document.querySelector(".step-note")?.textContent).toBe("Stopped. Wren had already made Packing list.");
    expect(screen.getByRole("link", { name: "Packing list" }).getAttribute("href")).toBe("/p/p2");
    expect(screen.queryByText(/Let me find/)).toBeNull();
    expect(document.querySelector(".signature")).toBeNull();
  });
});

describe("a reply in the recorded demo", () => {
  it("can't be stopped", () => {
    show(reply("Reading your Lisbon pages."), run("running", { recorded: true }), { readOnly: true });
    expect(screen.queryByRole("button", { name: /Stop/ })).toBeNull();
    cleanup();
    show(reply("Reading your Lisbon pages."), run("running"));
    expect(screen.getByRole("button", { name: /Stop/ })).toBeTruthy();
  });
});

describe("a handoff", () => {
  it("shows the other agent working inline, with its live steps, while the reply waits", () => {
    const parent = run("running", { steps: [step("search_pages", "Searched for hiring")] });
    const child = run("running", {
      id: "r2", agentId: "wren", parentRunId: "r1", prompt: "Draft the job post for a founding engineer. Hiring plan is p1.",
      steps: [step("read_page", "Read Hiring plan", "p1")],
    });
    show(reply(""), parent, { runs: [child] });
    const handoff = document.querySelector(".handoff")!;
    expect(handoff.textContent).toContain("Wren is working on it…");
    expect(handoff.textContent).toContain("Scout asked: “Draft the job post for a founding engineer.”");
    expect(screen.getByRole("link", { name: "Read Hiring plan" })).toBeTruthy();
    expect(screen.getByText("Waiting for Wren…")).toBeTruthy();
  });

  it("stays under the reply once the helper finishes", () => {
    const parent = run("succeeded", { steps: [step("ask_agent", "Asked Wren for help")] });
    const child = run("succeeded", { id: "r2", agentId: "wren", parentRunId: "r1", prompt: "Draft the job post.", steps: [step("create_page", "Created Job post", "p3")] });
    show(reply("Wren drafted the job post."), parent, { runs: [child] });
    expect(document.querySelector(".handoff")?.textContent).toContain("Wren finished");
    expect(screen.queryByText(/Waiting for/)).toBeNull();
  });
});
