#!/usr/bin/env node
// Node 22, no dependencies. Run: node --env-file=.env scripts/smoke-meta.mjs [--save]
// Exactly five model requests, no retries. --save writes smoke-meta-image.png (never overwrites).
// Provider contracts: https://dev.meta.ai/docs/protocols/chat-completions
// https://dev.meta.ai/docs/api-reference/images/schemas
// https://dev.meta.ai/docs/speech-to-text and https://dev.meta.ai/docs/sam/segmenting
import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";

const key = process.env.META_API_KEY?.trim();
if (!key) {
  console.error("META_API_KEY not set");
  process.exit(2);
}
const log = (message) => console.log(String(message).split(key).join("[redacted]"));
const base = (process.env.META_BASE_URL || "https://api.meta.ai/v1").replace(/\/+$/, "");
const textModel = process.env.META_TEXT_MODEL || "muse-spark-1.3";
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

class SmokeError extends Error {}

function shape(value, depth = 0) {
  if (value === null) return "null";
  if (typeof value === "string") return `string(${value.length})`;
  if (typeof value !== "object") return typeof value;
  if (depth >= 7) return Array.isArray(value) ? "array" : "object";
  if (Array.isArray(value)) return { length: value.length, items: value.slice(0, 2).map((v) => shape(v, depth + 1)) };
  return Object.fromEntries(Object.entries(value).slice(0, 40).map(([k, v]) => [k, shape(v, depth + 1)]));
}

function wavTone() {
  const rate = 16_000;
  const bytes = Buffer.alloc(44 + rate * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(rate * 2, 40);
  for (let i = 0; i < rate; i++) bytes.writeInt16LE(Math.round(4000 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
  return bytes;
}

function pngChunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length); payload.copy(out, 4); out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4);
  return out;
}

function rectanglesPng() {
  const width = 128, height = 128;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(height * (1 + width * 3), 255);
  for (let y = 0; y < height; y++) {
    pixels[y * (1 + width * 3)] = 0; // PNG filter: none
    for (let x = 0; x < width; x++) {
      const color = x >= 12 && x < 56 && y >= 20 && y < 108 ? [210, 40, 40]
        : x >= 72 && x < 116 && y >= 20 && y < 108 ? [40, 80, 210] : [255, 255, 255];
      pixels.set(color, y * (1 + width * 3) + 1 + x * 3);
    }
  }
  return Buffer.concat([pngSignature, pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(pixels)), pngChunk("IEND", Buffer.alloc(0))]);
}

async function request(endpoint, body, stream = false) {
  const multipart = body instanceof FormData;
  const response = await fetch(`${base}${endpoint}`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${key}`, Accept: stream ? "text/event-stream" : "application/json",
      ...(multipart ? {} : { "Content-Type": "application/json" }) },
    body: multipart ? body : JSON.stringify(body),
  });
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > 32 * 1024 * 1024) throw new SmokeError("Response exceeds 32 MiB");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  const contentType = response.headers.get("content-type") ?? "unknown";
  const events = [];
  let done = false;
  let data;
  if (contentType.includes("text/event-stream")) {
    for (const block of raw.split(/\r?\n\r?\n/)) {
      const payload = block.split(/\r?\n/).filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart()).join("\n");
      if (!payload) continue;
      if (payload === "[DONE]") { done = true; continue; }
      events.push(JSON.parse(payload));
    }
    const shapes = [...new Set(events.map((event) => JSON.stringify({ type: event.type ?? "chat.chunk", shape: shape(event) })))];
    log(`  HTTP ${response.status}; ${contentType}; bytes=${size}; event shapes=${JSON.stringify(shapes.slice(0, 16).map((s) => JSON.parse(s)))}`);
  } else {
    try { data = JSON.parse(raw); } catch { data = raw; }
    log(`  HTTP ${response.status}; ${contentType}; bytes=${size}; shape=${JSON.stringify(shape(data))}`);
  }
  if (!response.ok) throw new SmokeError(`HTTP ${response.status}`);
  if (events.some((event) => event.error || event.type === "error" || event.type === "response.failed") || data?.error) {
    throw new SmokeError("Provider returned an error payload");
  }
  return { data, events, done, contentType, size };
}

let failures = 0;
async function check(name, fn) {
  const start = performance.now();
  log(`CHECK ${name}`);
  try {
    const detail = await fn();
    log(`PASS ${name} (${Math.round(performance.now() - start)} ms) ${detail}`);
  } catch (error) {
    failures++;
    // Fetch errors can carry request details. Only print our validation errors or the error type.
    const message = error instanceof SmokeError ? error.message : error?.name ?? "Request failed";
    log(`FAIL ${name} (${Math.round(performance.now() - start)} ms) ${message}`);
  }
}

await check("Muse Spark tool call", async () => {
  const { data } = await request("/chat/completions", {
    model: textModel, max_completion_tokens: 256, reasoning_effort: "minimal", tool_choice: "auto",
    messages: [{ role: "user", content: "Call the smoke_ping tool now with message hello. Do not answer with text." }],
    tools: [{ type: "function", function: { name: "smoke_ping", description: "Acknowledge the smoke test.",
      parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"], additionalProperties: false } } }],
  });
  const calls = data?.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(calls) || !calls.some((call) => call.function?.name === "smoke_ping")) throw new SmokeError("Expected smoke_ping tool call");
  return `tool_calls=${calls.length}`;
});

await check("Muse Spark streaming text", async () => {
  const { events, done, contentType } = await request("/chat/completions", {
    model: textModel, max_completion_tokens: 256, reasoning_effort: "minimal", stream: true,
    messages: [{ role: "user", content: "Reply with exactly: Hello from Inkwell." }],
  }, true);
  const text = events.map((event) => event.choices?.[0]?.delta?.content ?? "").join("");
  if (!contentType.includes("text/event-stream") || !done || !text.trim()) throw new SmokeError("Expected completed SSE stream with text deltas");
  return `events=${events.length}; text_chars=${text.length}`;
});

await check("Muse Image generation", async () => {
  const { data } = await request("/images/generations", {
    model: process.env.META_IMAGE_MODEL || "muse-image-1.0", prompt: "A red square on white.",
    n: 1, response_format: "b64_json", output_format: "png", reasoning_strength: "low",
  });
  const encoded = data?.data?.[0]?.b64_json ?? data?.b64_json;
  if (typeof encoded !== "string") throw new SmokeError("Expected b64_json image bytes");
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.subarray(0, 8).equals(pngSignature)) throw new SmokeError("Expected PNG image bytes");
  if (process.argv.includes("--save")) await writeFile("smoke-meta-image.png", bytes, { flag: "wx" });
  return `image_bytes=${bytes.length}${process.argv.includes("--save") ? "; saved smoke-meta-image.png" : "; not saved"}`;
});

await check("Voice Transcribe", async () => {
  const form = new FormData();
  form.set("request", new Blob([JSON.stringify({ model: process.env.META_TRANSCRIBE_MODEL || "muse-voice-transcribe-1.0",
    mode: "PUSH_TO_TALK", audioEncoding: "WAV" })], { type: "application/json" }), "request.json");
  form.set("audio", new Blob([wavTone()], { type: "audio/wav" }), "tone.wav");
  await request("/asr/transcribe", form);
  return "2xx shape recorded (synthetic tone, not speech accuracy)";
});

await check("SAM 3.1 segmentation", async () => {
  const { data, events } = await request("/responses", {
    model: process.env.META_SEGMENT_MODEL || "sam-3.1", stream: true,
    input: [{ type: "message", role: "user", content: [
      { type: "input_text", text: "colored rectangles" },
      { type: "input_image", image_url: `data:image/png;base64,${rectanglesPng().toString("base64")}` },
    ] }],
  }, true);
  if (events.length && !events.some((event) => event.type === "response.completed")) throw new SmokeError("SAM stream did not complete");
  const output = events.filter((event) => event.type === "response.output_text.delta").map((event) => event.delta ?? "").join("") || data?.output_text || "";
  log(`  raw output_text sample=${JSON.stringify(output.slice(0, 320))}`);
  return `response shape recorded; output_chars=${output.length} (zero matches is valid)`;
});

log(`${5 - failures}/5 model paths passed`);
process.exitCode = failures ? 1 : 0;
