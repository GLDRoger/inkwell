#!/usr/bin/env python3
"""Render the demo's sample photo: sticky notes on a desk, in handwriting-style fonts.

  python3 scripts/demo/make-sticky-photo.py src/server/demo/assets/sticky-notes.jpg

Needs Pillow and macOS's bundled handwriting fonts. Deterministic (fixed seed),
so re-running it reproduces the committed asset.
"""
import math, random, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

random.seed(7)
W, H = 1600, 1100
FONTS = "/System/Library/Fonts/Supplemental/"
NOTES = [
    # (colour, font file, size, lines)
    ((252, 232, 120), FONTS + "Bradley Hand Bold.ttf", 46, ["Launch week", "- fix signup email", "- press list by Thu"]),
    ((250, 180, 196), "/System/Library/Fonts/Noteworthy.ttc", 44, ["Hire a designer!", "portfolio reviews", "on Monday"]),
    ((160, 214, 236), "/System/Library/Fonts/MarkerFelt.ttc", 42, ["Lisbon:", "book Pena Palace", "for 9am"]),
    ((182, 226, 160), FONTS + "Bradley Hand Bold.ttf", 46, ["Idea:", "weekly digest", "email for users"]),
    ((255, 196, 120), "/System/Library/Fonts/Noteworthy.ttc", 44, ["Ask Sam about", "pricing tiers", "before Friday"]),
]
SPOTS = [(150, 130), (620, 90), (1090, 150), (330, 590), (840, 560)]

# Desk: warm wood grain with soft vignette lighting.
desk = Image.new("RGB", (W, H))
px = desk.load()
for y in range(H):
    for x in range(W):
        grain = math.sin((x * 0.012) + math.sin(y * 0.004) * 3.0) * 10 + math.sin(x * 0.11 + y * 0.002) * 4
        light = 1.0 - 0.35 * (((x - W * 0.45) / W) ** 2 + ((y - H * 0.4) / H) ** 2) * 2.2
        n = random.uniform(-6, 6)
        px[x, y] = tuple(max(0, min(255, int((c + grain + n) * light))) for c in (176, 132, 92))
desk = desk.filter(ImageFilter.GaussianBlur(0.8))

for (colour, font_path, size, lines), (sx, sy) in zip(NOTES, SPOTS):
    side = random.randint(360, 390)
    note = Image.new("RGBA", (side, side), colour + (255,))
    d = ImageDraw.Draw(note)
    # Paper: a slightly darker adhesive strip and gentle shading toward the bottom.
    for y in range(side):
        shade = int(18 * (y / side) ** 2)
        d.line([(0, y), (side, y)], fill=tuple(max(0, c - shade - (8 if y < 46 else 0)) for c in colour) + (255,))
    # Shrink until the longest line fits inside the note with a margin.
    while True:
        font = ImageFont.truetype(font_path, size)
        if max(d.textlength(line, font=font) for line in lines) <= side - 70: break
        size -= 2
    ink = random.choice([(28, 38, 92), (30, 30, 34), (24, 52, 110)])
    y = 70
    for i, line in enumerate(lines):
        x = 30 + random.randint(-2, 6)
        d.text((x, y), line, font=font, fill=ink + (255,))
        if i == 0:
            left, top, right, bottom = d.textbbox((x, y), line, font=font)
            d.line([(left, bottom + 8), (right, bottom + 5)], fill=ink + (255,), width=3)
        y += int(size * 1.6)
    note = note.rotate(random.uniform(-6, 6), resample=Image.BICUBIC, expand=True)
    shadow = Image.new("RGBA", note.size, (0, 0, 0, 0))
    shadow.paste((0, 0, 0, 110), mask=note.split()[3])
    shadow = shadow.filter(ImageFilter.GaussianBlur(12))
    desk.paste(shadow, (sx + 10, sy + 14), shadow)
    desk.paste(note, (sx, sy), note)

# A phone photo: slight blur, sensor noise, warm cast.
photo = desk.filter(ImageFilter.GaussianBlur(0.6))
noise = Image.effect_noise((W, H), 9).convert("RGB")
photo = Image.blend(photo, noise, 0.04)
photo.save(sys.argv[1] if len(sys.argv) > 1 else "sticky-notes.jpg", quality=86)
