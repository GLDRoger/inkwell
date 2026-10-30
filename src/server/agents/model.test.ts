// @vitest-environment node
import { describe, expect, it } from "vitest";
import { streamText, generateText, tool } from "ai";
import { z } from "zod";
import { createMetaModel, metaRequestBody } from "./model.ts";

describe("Meta provider wire contract", () => {
  it("captures the installed provider's actual streaming and non-streaming JSON", async () => {
    const captured: Record<string, unknown>[] = [];
    const model = createMetaModel({ apiKey: "test-key", fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      captured.push(body);
      if (body.stream) return new Response(
        `data: ${JSON.stringify({ id: "test", created: 0, model: "muse-spark-1.3", choices: [{ index: 0, delta: { content: "OK" }, finish_reason: null }] })}\n\n` +
        `data: ${JSON.stringify({ id: "test", created: 0, model: "muse-spark-1.3", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n` + "data: [DONE]\n\n",
        { headers: { "Content-Type": "text/event-stream" } });
      return Response.json({ id: "test", created: 0, model: "muse-spark-1.3", choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    } });
    const options = { model, messages: [{ role: "user" as const, content: [
      { type: "text" as const, text: "Hello" },
      { type: "file" as const, data: new Uint8Array([137, 80, 78, 71]), mediaType: "image/png" },
    ] }], maxOutputTokens: 4096,
      tools: { read_page: tool({ inputSchema: z.object({ pageId: z.string() }), execute: async () => "text" }) },
      toolChoice: "auto" as const, providerOptions: { meta: { reasoningEffort: "low" } } };
    expect(await streamText(options).text).toBe("OK");
    expect((await generateText(options)).text).toBe("OK");
    for (const body of captured) {
      expect(body).toMatchObject({ model: "muse-wonder-1.0", max_completion_tokens: 4096, tool_choice: "auto", reasoning_effort: "low" });
      for (const key of ["max_tokens", "stop", "n", "logprobs", "top_logprobs"]) expect(body).not.toHaveProperty(key);
    }
    expect(captured[0]!.messages).toEqual([{ role: "user", content: [
      { type: "text", text: "Hello" },
      { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw==" } },
    ] }]);
    expect(Object.keys(captured[0]!).sort()).toEqual([
      "max_completion_tokens", "messages", "model", "reasoning_effort", "stream", "tool_choice", "tools",
    ]);
    expect(Object.keys(captured[1]!).sort()).toEqual([
      "max_completion_tokens", "messages", "model", "reasoning_effort", "tool_choice", "tools",
    ]);
  });
  it("strips forbidden fields and overrides non-auto tool choices", () => {
    expect(metaRequestBody({ max_tokens: 42, stop: ["END"], n: 2, logprobs: true, top_logprobs: 5, tool_choice: "required" })).toEqual({ max_completion_tokens: 42, tool_choice: "auto" });
  });
});
