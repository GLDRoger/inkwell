/** Shared helpers for agent runtime tests (mock model streams and a seeded workspace). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { ServerEvent } from "../../shared/types.ts";
import { insertDiaryEntry, insertDiaryThread, listAgents } from "../db.ts";
import { createServices, type Services } from "../services.ts";
import { createWorkspaceSession } from "../session.ts";
import { readView } from "./page-edit.ts";
import type { RuntimeOptions } from "./runtime.ts";

export const usage = { inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };

export function output(parts: LanguageModelV4StreamPart[], reason: "stop" | "tool-calls" = "stop", outputTokens = 5) {
  const used = { ...usage, outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 } };
  return { stream: new ReadableStream<LanguageModelV4StreamPart>({ start(c) {
    c.enqueue({ type: "stream-start", warnings: [] });
    for (const part of parts) c.enqueue(part);
    c.enqueue({ type: "finish", finishReason: { unified: reason, raw: reason }, usage: used });
    c.close();
  } }) };
}

export const textParts = (text: string, id = "text"): LanguageModelV4StreamPart[] => [
  { type: "text-start", id }, { type: "text-delta", id, delta: text }, { type: "text-end", id },
];
export const answer = (text: string) => output(textParts(text));
export const toolCall = (toolName: string, input: object, toolCallId = toolName): LanguageModelV4StreamPart =>
  ({ type: "tool-call", toolName, input: JSON.stringify(input), toolCallId });
export const call = (toolName: string, input: object, toolCallId = toolName) =>
  output([toolCall(toolName, input, toolCallId)], "tool-calls");

/** The version token read_page would hand the model for this page right now. */
export async function versionOf(services: Services, ws: string, pageId: string) {
  return readView((await services.collab.getPageJSON(pageId, ws))!).version;
}

export function createFixture(registry: { services: Services; dir: string }[], options: RuntimeOptions = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inkwell-agents-"));
  const services = createServices(dir, options);
  registry.push({ services, dir });
  const session = createWorkspaceSession(services);
  const ws = session.workspaceId;
  const agent = listAgents(services.db, ws)[0]!;
  const page = services.pages.createPage(ws, session.person, { title: "Billing", markdown: "Original billing notes." });
  const events: ServerEvent[] = [];
  services.bus.subscribe(ws, (event) => events.push(event));
  const start = (prompt = "Improve billing", pageId: string | undefined = page.id) => {
    const thread = insertDiaryThread(services.db, ws, prompt);
    insertDiaryEntry(services.db, ws, { threadId: thread.id, role: "person", text: prompt });
    return services.runtime.start({ workspaceId: ws, agentId: agent.id, threadId: thread.id, pageId, prompt });
  };
  return { services, ws, agent, page, events, start, session, dir };
}
