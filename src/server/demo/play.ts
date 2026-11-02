import { clearLens, listWidgets } from "../widgets.ts";
import { applyFind, readView } from "../agents/page-edit.ts";
/**
 * Plays a demo scenario in one notebook through the real agent runtime and media
 * code. The transport decides where Meta's answers come from: the real API while
 * recording, a cassette while replaying.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Attachment, DemoFocus, Page } from "../../shared/types.ts";
import {
  insertAttachmentRow, insertDiaryEntry, insertDiaryThread, listAgents, newId,
} from "../db.ts";
import { illustratePage } from "../media/illustrate.ts";
import { createMetaClient } from "../media/meta.ts";
import { importPhoto } from "../media/photo.ts";
import { transcribe } from "../media/transcribe.ts";
import type { Services } from "../services.ts";
import type { SessionCtx } from "../session.ts";
import { sleep } from "./cassette.ts";
import type { ScenarioDefinition, ScenarioStep } from "./scenario.ts";

export const ASSETS_DIR = resolveDemoDir("assets");

/** Demo files sit beside this module in src/, and are copied next to it in dist/ by the build. */
export function resolveDemoDir(name: string): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), name);
}

export interface Transport {
  /** Runs replay recorded output (Run.recorded). */
  replaying: boolean;
  beginStep: (index: number, step: ScenarioStep) => void;
  /** The HTTP transport for one agent run; called once per run, in the order runs start. */
  forRun: (runId: string) => typeof globalThis.fetch;
  /** The HTTP transport for this step's media calls. */
  media: () => typeof globalThis.fetch;
}

export type Focus = DemoFocus;

export interface PlayOptions {
  services: Services;
  /** workspaceId is the notebook to play in. */
  ctx: SessionCtx;
  scenario: ScenarioDefinition;
  transport: Transport;
  apiKey: string;
  baseUrl?: string;
  model: string;
  signal: AbortSignal;
  /** "Today" for dated titles (Photo notes, 30 Oct), so replay matches what the recording's agents saw. */
  date?: Date;
  /** Pause after each step so viewers can read the caption. */
  gapMs: number;
  /** Multiplies each step's minMs (its shortest time on screen); 0 or absent while recording. */
  holdScale?: number;
  onStep: (index: number, focus: Focus) => void;
}

async function addAttachment(services: Services, ws: string, file: string, kind: "image" | "audio", mime: string): Promise<Attachment> {
  const bytes = await fs.readFile(path.join(ASSETS_DIR, file));
  const id = newId();
  const stored = `${id}${path.extname(file)}`;
  await fs.writeFile(path.join(services.uploadsDir, stored), bytes, { flag: "wx" });
  return insertAttachmentRow(services.db, ws, { id, kind, name: file, mime, size: bytes.length, path: stored });
}

/** Play every step in order. Resolves when finished; rejects with the abort reason when stopped. */
export async function playScenario(o: PlayOptions): Promise<void> {
  const { services: s, ctx, transport, signal } = o;
  const ws = ctx.workspaceId;
  const created: Page[] = [];
  let step = -1;
  let lensShownAt: number | undefined;
  let focus: Focus = {};
  const setFocus = (next: Focus) => {
    focus = next;
    o.onStep(step, focus);
  };
  const unsubscribe = s.bus.subscribe(ws, (event) => {
    if (event.type === "lens.shown") lensShownAt = Date.now();
    if (event.type === "page.created") created.push(event.page);
    // The camera and peek follow the agent to the page it writes.
    if (event.type === "agent.moved" && event.action === "writing" && event.toPageId && event.toPageId !== focus.pageId) {
      setFocus({ pageId: event.toPageId, agentId: event.agentId, runId: event.runId });
    }
  });
  const media = () => createMetaClient({ apiKey: o.apiKey, baseUrl: o.baseUrl, fetch: transport.media() });
  const meta = { apiKey: o.apiKey, baseUrl: o.baseUrl, model: o.model, source: "server" as const, fetchForRun: transport.forRun, recorded: transport.replaying };

  const ask = async (agentName: string, prompt: string, attachments: Attachment[] = [], guidance?: string, scopePageIds?: string[]) => {
    const agent = listAgents(s.db, ws).find((a) => a.name === agentName);
    if (!agent) throw new Error(`demo agent ${agentName} is missing`);
    const thread = insertDiaryThread(s.db, ws, prompt.slice(0, 80));
    const entry = insertDiaryEntry(s.db, ws, { threadId: thread.id, role: "person", text: prompt, attachments, pageIds: scopePageIds });
    s.bus.publish(ws, { type: "diary.entry", entry });
    const started = s.runtime.start({ workspaceId: ws, agentId: agent.id, threadId: thread.id, prompt, meta, scopePageIds, ...(guidance ? { guidance } : {}) });
    setFocus({ agentId: agent.id, runId: started.run.id, ...(started.run.pageId ? { pageId: started.run.pageId } : {}) });
    const cancel = () => { void s.runtime.cancel(ws, started.run.id); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const result = await started.done;
      if (result.run.status !== "succeeded") throw new Error(`Demo run ${result.run.status}: ${result.run.error}`);
    } finally { signal.removeEventListener("abort", cancel); }
  };

  try {
    for (const [index, def] of o.scenario.steps.entries()) {
      signal.throwIfAborted();
      step = index;
      const began = Date.now();
      transport.beginStep(index, def);
      setFocus({});
      const action = def.action;
      if (action.kind === "ask") {
        const scopePageIds = action.circle ? s.pages.listPages(ws).filter(p => action.circle!.test(p.title)).map(p => p.id) : undefined;
        if (scopePageIds) {
          setFocus({ circledPageIds: scopePageIds });
          await sleep(2500 * (o.holdScale ?? 0), signal);
        }
        await ask(action.agent, action.prompt, [], action.guidance, scopePageIds);
        const widget = listWidgets(s.db, ws).find(w => w.data.kind === (def.id === "cost" ? "total" : "progress"));
        if (widget && (def.id === "cost" || def.id === "lens")) setFocus({ widgetId: widget.id });
      } else if (action.kind === "edit") {
        if (def.id === "tick") clearLens(s.db, s.bus, ws);
        const target = s.pages.listPages(ws).find(p => action.title.test(p.title));
        if (!target) throw new Error(`Demo edit page missing: ${action.title}`);
        const widget = listWidgets(s.db, ws).find(w => w.pageIds.includes(target.id) && w.data.kind === (def.id === "tick" ? "progress" : "total"));
        setFocus({ pageId: target.id, ...(widget ? { widgetId: widget.id } : {}) });
        const json = await s.collab.getPageJSON(target.id, ws);
        if (!json) throw new Error("Demo source page missing");
        await s.collab.editPage(target.id, ws, current => applyFind(current, readView(json).version, action.find, action.replace).json, ctx.person);
        // Let the same 300ms reactor used by real editors publish before the next step.
        await sleep(400, signal);
      } else if (action.kind === "voice") {
        const audio = await addAttachment(s, ws, action.audio, "audio", "audio/wav");
        const bytes = await fs.readFile(path.join(ASSETS_DIR, action.audio));
        const { text } = await transcribe(new File([new Uint8Array(bytes)], action.audio, { type: "audio/wav" }), media());
        signal.throwIfAborted();
        await ask(action.agent, text.trim() || "Summarise what I've read this month.", [audio]);
      } else if (action.kind === "photo") {
        const photo = await addAttachment(s, ws, action.image, "image", "image/jpeg");
        const { pages } = await importPhoto(s, ctx, photo.id, media(), o.model, { date: o.date });
        if (pages[0]) setFocus({ pageId: pages[0].id });
      } else if (action.kind === "cover") {
        const target = created.find((p) => action.title.test(p.title) && s.pages.getPage(ws, p.id));
        if (target) {
          setFocus({ pageId: target.id });
          await illustratePage(s, ctx, target.id, media());
        }
      }
      signal.throwIfAborted();
      const last = index === o.scenario.steps.length - 1;
      const gap = last ? 0 : o.gapMs;
      // Quick steps (a photo, a cover) stay up long enough to read what landed.
      const visibleSince = def.id === "lens" && lensShownAt ? lensShownAt : began;
      const hold = (def.minMs ?? 0) * (o.holdScale ?? 0) - (Date.now() - visibleSince) - gap;
      if (hold > 0) await sleep(hold, signal);
      if (gap > 0) await sleep(gap, signal);
    }
  } finally {
    unsubscribe();
  }
}
