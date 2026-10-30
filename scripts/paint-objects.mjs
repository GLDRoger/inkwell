#!/usr/bin/env node
// Paints the welcome screen's object cut-outs from one prompt list.
//
//   node --env-file-if-exists=.env scripts/paint-objects.mjs                  # Meta Muse Image (META_API_KEY)
//   node scripts/paint-objects.mjs --provider openai                          # OpenAI (OPENAI_API_KEY)
//   node scripts/paint-objects.mjs --provider openai --only nata,lemon        # repaint a few
//   node scripts/paint-objects.mjs --optimise-only                            # re-crop/re-encode the raw PNGs
//
// Raw PNGs go to $TMPDIR/inkwell-objects-raw; optimised WebP (alpha, cropped,
// longest side 400px) go to src/client/public/objects/<id>.webp.
// Needs ffmpeg (to read alpha for cropping) and cwebp on PATH. No npm deps.
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** One shared look, so the set reads as one shoot. */
const STYLE =
  "Studio product photograph of a single real object, isolated on a fully transparent background. " +
  "Three-quarter view from slightly above. One large soft key light from the upper left, gentle fill from the right, " +
  "natural true-to-life colours, slightly muted, realistic materials and texture, crisp focus, high detail. " +
  "The whole object is in frame and centred with a generous empty margin. " +
  "No background, no surface, no cast shadow, no glow or soft halo around the edges, no props, no hands, no people, no logos, no brand names, no watermark.";

/** The demo notebook's world: a Lisbon trip, a launch plan, reading notes, recipes. */
export const OBJECTS = [
  { id: "boarding-pass", defringe: true, subject: "a paper airline boarding pass, slightly curled, off-white card with a thin blue stripe, the route reads LIS in bold, other print small and simple" },
  { id: "nata", subject: "a single Portuguese pastel de nata custard tart with a blistered caramelised top and flaky golden pastry" },
  { id: "espresso", subject: "a small white ceramic espresso cup on its saucer, filled with espresso with a light crema" },
  { id: "sourdough", subject: "a round rustic sourdough loaf with a deep scored ear and a dusting of flour" },
  { id: "paperback", subject: "a well-read closed paperback novel lying flat at an angle, soft matte terracotta cover with a creased spine and slightly dog-eared corners, cream page edges visible, no lettering" },
  { id: "pen", subject: "a black lacquered fountain pen with a gold nib, cap posted, lying diagonally" },
  { id: "sticky-notes", subject: "a small square pad of pale yellow sticky notes, the top note slightly lifted at one corner, blank" },
  { id: "phone", subject: "a modern smartphone lying at a slight angle, its screen shows a clean white app with a simple rising line chart in green, no text" },
  { id: "camera", subject: "a compact silver and black 35mm film camera with a leather strap tucked behind" },
  { id: "plant", subject: "a small potted pilea plant with round green leaves in a matte white ceramic pot" },
  { id: "tile", subject: "a single square Portuguese azulejo ceramic tile, glossy, blue and white floral pattern, slightly chipped corner, tilted" },
  { id: "glasses", subject: "a pair of folded reading glasses with thin tortoiseshell frames and perfectly clear, colourless lenses" },
  { id: "lemon", subject: "a single ripe lemon with one green leaf still attached" },
  { id: "sardines", subject: "an open vintage-style tin of sardines in olive oil, the peeled lid curled back, plain colourful tin with no lettering" },
];

function args(argv) {
  const out = { provider: "meta", only: null, quality: "high", optimiseOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--provider") out.provider = argv[++i];
    else if (a === "--only") out.only = new Set(argv[++i].split(","));
    else if (a === "--quality") out.quality = argv[++i];
    else if (a === "--optimise-only") out.optimiseOnly = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!["meta", "openai"].includes(out.provider)) throw new Error("--provider must be meta or openai");
  return out;
}

const rawDir = path.join(tmpdir(), "inkwell-objects-raw");
const outDir = path.join(root, "src/client/public/objects");

async function post(url, key, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${res.status} ${text.slice(0, 400).split(key).join("[redacted]")}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return JSON.parse(text);
}

async function imageBytes(json) {
  const item = Array.isArray(json.data) ? json.data[0] : json;
  if (typeof item?.b64_json === "string") return Buffer.from(item.b64_json, "base64");
  if (typeof item?.url === "string") return Buffer.from(await (await fetch(item.url)).arrayBuffer());
  throw new Error("provider returned no image");
}

/** Meta Muse Image. Same request shape as src/server/media/illustrate.ts. */
async function paintMeta(prompt) {
  const key = process.env.META_API_KEY?.trim();
  if (!key) throw new Error("META_API_KEY not set (or use --provider openai)");
  const base = (process.env.META_BASE_URL || "https://api.meta.ai/v1").replace(/\/+$/, "");
  const body = {
    model: process.env.META_IMAGE_MODEL ?? "muse-image-1.0",
    prompt,
    response_format: "b64_json",
    output_format: "png",
    background: "transparent",
  };
  try {
    return await imageBytes(await post(`${base}/images/generations`, key, body));
  } catch (e) {
    // If Muse Image doesn't take `background`, paint on plain white and say so.
    if (e.status === 400 && /background/i.test(e.body ?? "")) {
      console.warn("  Muse Image rejected `background`; retrying on a plain white backdrop (cut it out before shipping)");
      delete body.background;
      body.prompt = prompt.replace("isolated on a fully transparent background", "isolated on a seamless pure white background");
      return imageBytes(await post(`${base}/images/generations`, key, body));
    }
    throw e;
  }
}

/** OpenAI image generation, transparent PNG. */
async function paintOpenAI(prompt, quality) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const json = await post("https://api.openai.com/v1/images/generations", key, {
    model: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2.5-flare",
    prompt,
    size: "1024x1024",
    quality,
    background: "transparent",
    output_format: "png",
  });
  return imageBytes(json);
}

/** Crop to the opaque pixels (plus a little air) and encode a small alpha WebP. */
async function optimise({ id, defringe }) {
  let raw = path.join(rawDir, `${id}.png`);
  if (defringe) {
    // White paper tends to come back with a soft light glow baked into the alpha,
    // which reads as a halo on the dark theme. Fade out pale, semi-transparent pixels.
    const clean = path.join(rawDir, `${id}.clean.png`);
    await run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-vf",
      "format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(alpha(X,Y),235)*gt(min(min(r(X,Y),g(X,Y)),b(X,Y)),150),alpha(X,Y)*pow(alpha(X,Y)/235,3),alpha(X,Y))'", clean]);
    raw = clean;
  }
  const probe = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", raw]);
  const [w, h] = probe.stdout.trim().split(",").map(Number);
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", raw, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], {
    encoding: "buffer",
    maxBuffer: w * h * 4 + 1024,
  });
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (stdout[(y * w + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) throw new Error(`${id}: image is fully transparent`);
  const corners = [0, w - 1, (h - 1) * w, h * w - 1].map((i) => stdout[i * 4 + 3]);
  if (corners.every((a) => a > 200)) console.warn(`  ${id}: corners are opaque - the background was not removed`);
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const resize = cw >= ch ? ["400", "0"] : ["0", "400"];
  const out = path.join(outDir, `${id}.webp`);
  await run("cwebp", ["-quiet", "-q", "82", "-alpha_q", "90", "-m", "6", "-sharp_yuv",
    "-crop", String(x0), String(y0), String(cw), String(ch), "-resize", ...resize, raw, "-o", out]);
  const size = (await stat(out)).size;
  console.log(`  ${id}.webp ${cw}x${ch} -> ${Math.round(size / 1024)} KB`);
}

async function main() {
  const opts = args(process.argv.slice(2));
  await mkdir(rawDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  const list = OBJECTS.filter((o) => !opts.only || opts.only.has(o.id));
  if (opts.only && list.length !== opts.only.size) throw new Error("--only names an unknown object");
  let failed = 0;
  // A few at a time: providers rate-limit image generation.
  const queue = [...list];
  const worker = async () => {
    for (let o; (o = queue.shift()); ) {
      try {
        if (!opts.optimiseOnly) {
          console.log(`painting ${o.id} (${opts.provider})`);
          const prompt = `${STYLE}\nThe object: ${o.subject}.`;
          const bytes = opts.provider === "openai" ? await paintOpenAI(prompt, opts.quality) : await paintMeta(prompt);
          await writeFile(path.join(rawDir, `${o.id}.png`), bytes);
        } else await readFile(path.join(rawDir, `${o.id}.png`));
        await optimise(o);
      } catch (e) {
        failed++;
        console.error(`  ${o.id} failed: ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log(`${list.length - failed}/${list.length} objects in ${path.relative(root, outDir)}; raw PNGs in ${rawDir}`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
