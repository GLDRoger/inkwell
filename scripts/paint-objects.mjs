#!/usr/bin/env node
// Paints the welcome screen's object cut-outs from one prompt list.
//
//   node --env-file-if-exists=.env scripts/paint-objects.mjs                  # Meta Muse Image (META_API_KEY)
//   node scripts/paint-objects.mjs --provider openai                          # OpenAI (OPENAI_API_KEY)
//   node scripts/paint-objects.mjs --provider openai --only nata,lemon        # repaint a few
//   node scripts/paint-objects.mjs --optimise-only                            # re-cut/re-encode the raw Meta PNGs
//   node scripts/paint-objects.mjs --provider openai --optimise-only          # re-encode raw OpenAI PNGs
//
// Raw PNGs go to $TMPDIR/inkwell-objects-raw; optimised WebP (alpha, cropped,
// longest side 400px) go to src/client/public/objects/<id>.webp.
// Needs ffmpeg (to read alpha for cropping) and cwebp on PATH. No npm deps.
//
// Muse Image has no transparent output (the API rejects `background`), so Meta
// paints on a plain light-grey backdrop and the object is cut out here, on the
// Mac: Apple Vision's subject mask (swiftc, macOS 14+) finds the object, then a
// colour matte (python3 with numpy, scipy and Pillow) tightens the edge and
// unmixes the grey from soft edge pixels so nothing haloes on the dark theme.
// Each Meta paint keeps the previous raw as <id>.prev-<n>.png, so a worse
// repaint can be undone with --optimise-only after copying the old one back.
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
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

/** Muse Image can't paint transparency: same look, on a backdrop that's easy to cut out. */
const metaStyle = (backdrop = "plain light grey") => STYLE.replace(
  "isolated on a fully transparent background",
  `isolated on a seamless, evenly lit, ${backdrop} studio backdrop`,
).replace("No background, no surface, no cast shadow", "No visible floor or horizon, no surface, no cast shadow, no reflection");

/**
 * The demo notebook's world: a Lisbon trip, a launch plan, reading notes, recipes.
 * `backdrop` (Meta only) picks a darker grey for white things, which a light
 * grey backdrop leaves too little edge to cut.
 */
export const OBJECTS = [
  { id: "boarding-pass", backdrop: "plain mid-grey", defringe: true, subject: "a paper airline boarding pass, slightly curled, off-white card with a thin blue stripe, the route reads LIS in bold, other print small and simple" },
  { id: "nata", subject: "a single Portuguese pastel de nata custard tart with a blistered caramelised top and flaky golden pastry" },
  { id: "espresso", backdrop: "plain mid-grey", subject: "a small white ceramic espresso cup on its saucer, filled with espresso with a light crema" },
  { id: "sourdough", subject: "a round rustic sourdough loaf with a deep scored ear and a dusting of flour" },
  { id: "paperback", subject: "a well-read closed paperback novel lying flat at an angle, soft matte terracotta cover with a creased spine and slightly dog-eared corners, cream page edges visible, no lettering" },
  { id: "pen", subject: "a black lacquered fountain pen with a gold nib, cap posted, lying diagonally" },
  { id: "sticky-notes", backdrop: "plain mid-grey", subject: "a small square pad of pale yellow sticky notes, the top note slightly lifted at one corner, blank" },
  { id: "phone", backdrop: "plain mid-grey", subject: "a modern smartphone lying at a slight angle, its screen shows a clean white app with a simple rising line chart in green, no text" },
  { id: "camera", subject: "a compact silver and black 35mm film camera with a leather strap tucked behind" },
  { id: "plant", backdrop: "plain mid-grey", subject: "a small potted pilea plant with round green leaves in a matte white ceramic pot" },
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

/** Meta Muse Image, opaque PNG on a grey backdrop (1600px square). */
async function paintMeta(prompt) {
  const key = process.env.META_API_KEY?.trim();
  if (!key) throw new Error("META_API_KEY not set (or use --provider openai)");
  const base = (process.env.META_BASE_URL || "https://api.meta.ai/v1").replace(/\/+$/, "");
  return imageBytes(await post(`${base}/images/generations`, key, {
    model: process.env.META_IMAGE_MODEL ?? "muse-image-1.0",
    prompt,
    size: "1024x1024",
    response_format: "b64_json",
    output_format: "png",
  }));
}

/** Apple Vision's foreground mask for the whole subject, as an 8-bit grey PNG. */
const MASK_SWIFT = `import Foundation
import Vision
import CoreImage
import ImageIO
import UniformTypeIdentifiers
let a = CommandLine.arguments
let handler = VNImageRequestHandler(url: URL(fileURLWithPath: a[1]))
let req = VNGenerateForegroundInstanceMaskRequest()
try handler.perform([req])
guard let obs = req.results?.first else { FileHandle.standardError.write("no subject found\\n".data(using: .utf8)!); exit(2) }
let buf = try obs.generateScaledMaskForImage(forInstances: obs.allInstances, from: handler)
let ci = CIImage(cvPixelBuffer: buf)
let cg = CIContext().createCGImage(ci, from: ci.extent, format: .L8, colorSpace: CGColorSpaceCreateDeviceGray())!
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, cg, nil)
if !CGImageDestinationFinalize(dest) { exit(3) }
`;

/**
 * Turns the painted image + Vision mask into a clean RGBA cut-out. Vision's
 * mask is soft, blocky and sits a few px outside the real edge, so a colour
 * guided filter snaps it to the image's edges and it is cut at its midline.
 * Where the object's colour stands well apart from the backdrop, alpha comes
 * from colour instead (how far each edge pixel is from the backdrop towards the
 * nearby solid colour) and edge colours are unmixed from the backdrop, so a
 * soft edge carries the object's colour, not grey.
 */
const MATTE_PY = `import sys, numpy as np
from PIL import Image
from scipy import ndimage as nd
src, mpath, out = sys.argv[1:4]
C = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
m = np.asarray(Image.open(mpath).convert("L")).astype(np.float32) / 255
h, w = m.shape
k = max(3, h // 200)
bgm = (m < 0.01).astype(np.float32)
bw = nd.gaussian_filter(bgm, h / 16)
bg = np.dstack([nd.gaussian_filter(C[..., i] * bgm, h / 16) for i in range(3)]) / np.maximum(bw, 1e-4)[..., None]
# colour guided filter: snaps Vision's soft, blocky mask to the image's real edges
I = C / 255
r = k
box = lambda x: nd.uniform_filter(x, 2 * r + 1)
mI = np.dstack([box(I[..., i]) for i in range(3)])
mp = box(m)
cov = np.dstack([box(I[..., i] * m) for i in range(3)]) - mI * mp[..., None]
S = np.empty((h, w, 3, 3), np.float32)
for i in range(3):
    for j in range(3):
        S[..., i, j] = box(I[..., i] * I[..., j]) - mI[..., i] * mI[..., j]
S += np.eye(3, dtype=np.float32) * 1e-4
A = np.linalg.solve(S, cov[..., None])[..., 0]
b = mp - (A * mI).sum(-1)
A = np.dstack([box(A[..., i]) for i in range(3)])
g = np.clip((A * I).sum(-1) + box(b), 0, 1)
t = np.clip((g - 0.35) / 0.3, 0, 1)
g = t * t * (3 - 2 * t)                        # a crisp, smooth contour at the mask's midline
inner = nd.binary_erosion(m > 0.98, iterations=2)
# the colour of the nearest solid pixel (keeps thin coloured borders, e.g. a stripe on white card)
_, (iy, ix) = nd.distance_transform_edt(~inner, return_indices=True)
Fin = nd.median_filter(C, size=(3, 3, 1))[iy, ix]
iw = (np.hypot(iy - np.arange(h)[:, None], ix - np.arange(w)[None, :]) < 3 * k).astype(np.float32)
d = Fin - bg
dist = np.sqrt((d * d).sum(-1))
ac = np.clip(((C - bg) * d).sum(-1) / np.maximum(dist * dist, 1), 0, 1)
wt = np.clip((dist - 40) / 40, 0, 1) * (iw > 0.02)
near = nd.maximum_filter(m, size=2 * k + 1) > 0.5   # only within reach of Vision's subject
a = (wt * np.minimum(ac, nd.maximum_filter(g, 3)) + (1 - wt) * g) * near
a = np.where(inner, 1, a)
a = np.where(a < 0.03, 0, a)
F = bg + (C - bg) / np.maximum(a, 0.05)[..., None]
# unmix only where alpha came from colour; on low-contrast edges the pixel is already near the object's colour
F = np.clip(np.where((a[..., None] > 0.97) | (wt[..., None] < 0.5), C, F), 0, 255)
Image.fromarray(np.dstack([F, a * 255]).round().astype(np.uint8), "RGBA").save(out)
`;

let maskBin;
/** Cut <id>.meta.png out into <id>.png (RGBA). */
async function cutOut(id) {
  if (!maskBin) {
    maskBin = (async () => {
      const src = path.join(rawDir, "mask.swift");
      const bin = path.join(rawDir, "mask");
      await writeFile(src, MASK_SWIFT);
      await run("swiftc", ["-O", src, "-o", bin]);
      await writeFile(path.join(rawDir, "matte.py"), MATTE_PY);
      return bin;
    })();
  }
  const bin = await maskBin;
  const painted = path.join(rawDir, `${id}.meta.png`);
  const mask = path.join(rawDir, `${id}.mask.png`);
  await run(bin, [painted, mask]);
  await run("python3", ["-I", path.join(rawDir, "matte.py"), painted, mask, path.join(rawDir, `${id}.png`)]);
}

/** Keep the last raw paint as <id>.prev-<n>.png before overwriting it. */
async function keepPrevious(file) {
  try {
    await stat(file);
  } catch {
    return;
  }
  for (let n = 1; ; n++) {
    const prev = file.replace(/\.png$/, `.prev-${n}.png`);
    try {
      await stat(prev);
    } catch {
      await rename(file, prev);
      return;
    }
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
async function optimise({ id, defringe }, provider) {
  let raw = path.join(rawDir, `${id}.png`);
  if (defringe && provider === "openai") {
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
        if (opts.optimiseOnly) {
          if (opts.provider === "meta") await cutOut(o.id);
          else await readFile(path.join(rawDir, `${o.id}.png`));
        } else if (opts.provider === "openai") {
          console.log(`painting ${o.id} (openai)`);
          const bytes = await paintOpenAI(`${STYLE}\nThe object: ${o.subject}.`, opts.quality);
          await writeFile(path.join(rawDir, `${o.id}.png`), bytes);
        } else {
          console.log(`painting ${o.id} (meta)`);
          const bytes = await paintMeta(`${metaStyle(o.backdrop)}\nThe object: ${o.subject}.`);
          const painted = path.join(rawDir, `${o.id}.meta.png`);
          await keepPrevious(painted);
          await writeFile(painted, bytes);
          await cutOut(o.id);
        }
        await optimise(o, opts.provider);
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
