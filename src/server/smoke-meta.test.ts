// @vitest-environment node
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { validateWav } from "./media/transcribe.ts";

const exec = promisify(execFile);
const script = resolve("scripts/smoke-meta.mjs");
const secret = "smoke-test-secret-never-print";
const dirs: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((done) => server.close(() => done()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function run(baseUrl: string, args: string[] = [], key = secret) {
  const cwd = await mkdtemp(join(tmpdir(), "inkwell-smoke-"));
  dirs.push(cwd);
  try {
    const result = await exec(process.execPath, [script, ...args], {
      cwd, env: { ...process.env, META_API_KEY: key, META_BASE_URL: baseUrl }, timeout: 10_000,
    });
    return { ...result, code: 0, cwd };
  } catch (error) {
    const result = error as Error & { stdout: string; stderr: string; code: number };
    return { stdout: result.stdout, stderr: result.stderr, code: result.code, cwd };
  }
}

async function provider(mode: "pass" | "http-failure" | "no-tool" | "incomplete-stream" = "pass") {
  const requests: { url: string; headers: Record<string, string | string[] | undefined>; body: Buffer }[] = [];
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWHsAAAAASUVORK5CYII=", "base64");
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    requests.push({ url: req.url!, headers: req.headers, body });
    res.setHeader("content-type", "application/json");
    if (mode === "http-failure") {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: { message: secret }, [secret]: "must be redacted" }));
    } else if (req.url === "/v1/chat/completions") {
      if (JSON.parse(body.toString()).stream) {
        res.setHeader("content-type", "text/event-stream");
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\r\n\r`);
        res.end(mode === "incomplete-stream" ? "\n" : "\ndata: [DONE]\n\n");
      } else {
        res.end(JSON.stringify({ choices: [{ message: mode === "no-tool" ? { content: "Hello" } : {
          tool_calls: [{ type: "function", function: { name: "smoke_ping", arguments: '{"message":"hello"}' } }],
        } }] }));
      }
    } else if (req.url === "/v1/images/generations") {
      res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
    } else if (req.url === "/v1/asr/transcribe") {
      res.end(JSON.stringify({ transcript: "", audioDurationMs: 1000, turns: [] }));
    } else if (req.url === "/v1/responses") {
      res.setHeader("content-type", "text/event-stream");
      res.end(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "<0f>0<|box;x1=12;y1=20;x2=56;y2=108;w=128;h=128|>" })}\n\ndata: ${JSON.stringify({ type: "response.completed", response: { output: [] } })}\n\n`);
    } else { res.statusCode = 404; res.end("{}"); }
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  return { baseUrl: `http://127.0.0.1:${port}/v1`, requests, png };
}

function checkPng(png: Buffer) {
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const chunks: Buffer[] = [];
  let width = 0, height = 0;
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const kind = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    let crc = 0xffffffff;
    for (const byte of png.subarray(offset + 4, offset + 8 + length)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    expect(png.readUInt32BE(offset + 8 + length)).toBe((crc ^ 0xffffffff) >>> 0);
    if (kind === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (kind === "IDAT") chunks.push(data);
    offset += length + 12;
  }
  expect([width, height]).toEqual([128, 128]);
  const pixels = inflateSync(Buffer.concat(chunks));
  expect(pixels.length).toBe(height * (1 + width * 3));
  const pixel = (x: number, y: number) => [...pixels.subarray(y * (1 + width * 3) + 1 + x * 3, y * (1 + width * 3) + 4 + x * 3)];
  expect(pixel(20, 30)).toEqual([210, 40, 40]);
  expect(pixel(80, 30)).toEqual([40, 80, 210]);
  expect(pixel(60, 30)).toEqual([255, 255, 255]);
}

describe("Meta smoke CLI (local protocol fixtures, not live model evidence)", () => {
  it("exits 2 without a key and makes no calls", async () => {
    const p = await provider();
    const result = await run(p.baseUrl, [], "");
    expect(result.code).toBe(2);
    expect(result.stderr.trim()).toBe("META_API_KEY not set");
    expect(p.requests).toHaveLength(0);
  });

  it("makes one call per path, reports shapes and timing, generates valid media without saving", async () => {
    const p = await provider();
    const result = await run(p.baseUrl);
    expect(result.code).toBe(0);
    expect(result.stdout.match(/^PASS .+ \(\d+ ms\)/gm)).toHaveLength(5);
    expect(result.stdout).toContain("5/5 model paths passed");
    expect(result.stdout).toContain("tool_calls");
    expect(result.stdout).toContain("audioDurationMs");
    expect(result.stdout).toContain("response.output_text.delta");
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(await readdir(result.cwd)).toEqual([]);
    expect(p.requests.map((r) => r.url)).toEqual(["/v1/chat/completions", "/v1/chat/completions", "/v1/images/generations", "/v1/asr/transcribe", "/v1/responses"]);
    expect(p.requests.every((r) => r.headers.authorization === `Bearer ${secret}`)).toBe(true);
    expect(JSON.parse(p.requests[0]!.body.toString())).toMatchObject({ tool_choice: "auto", tools: [expect.objectContaining({ type: "function" })] });
    const voice = p.requests[3]!.body;
    expect(voice.toString()).toContain('name="request"');
    expect(voice.toString()).toContain('name="audio"');
    const start = voice.indexOf("RIFF");
    const wav = voice.subarray(start, start + 44 + 16_000 * 2);
    expect(() => validateWav(wav)).not.toThrow();
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readInt16LE(46)).not.toBe(0);
    const sam = JSON.parse(p.requests[4]!.body.toString());
    checkPng(Buffer.from(sam.input[0].content[1].image_url.split(",")[1], "base64"));
  });

  it("saves only when requested", async () => {
    const p = await provider();
    const result = await run(p.baseUrl, ["--save"]);
    expect(result.code).toBe(0);
    expect(await readdir(result.cwd)).toEqual(["smoke-meta-image.png"]);
    expect(await readFile(join(result.cwd, "smoke-meta-image.png"))).toEqual(p.png);
  });

  it("continues after HTTP failures without retries or leaking the key", async () => {
    const p = await provider("http-failure");
    const result = await run(p.baseUrl);
    expect(result.code).toBe(1);
    expect(result.stdout.match(/^FAIL /gm)).toHaveLength(5);
    expect(p.requests).toHaveLength(5);
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(result.stdout).toContain("[redacted]");
  });

  it.each(["no-tool", "incomplete-stream"] as const)("fails semantic validation for %s", async (mode) => {
    const p = await provider(mode);
    const result = await run(p.baseUrl);
    expect(result.code).toBe(1);
    expect(result.stdout.match(/^FAIL /gm)).toHaveLength(1);
    expect(p.requests).toHaveLength(5);
    expect(result.stdout).toContain("4/5 model paths passed");
  });
});
