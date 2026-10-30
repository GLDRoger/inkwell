# Inkwell: design direction

The Harry Potter ideas (a map that shows where everyone is, a diary that writes back) shape what Inkwell *does*. They don't shape how it looks. The look is a calm, modern notebook: warm near-white paper, near-black ink, one display serif, one sans, generous air, and photographs of real things. Reference: knowspace.si.

The magic is in what moves: replies writing themselves, agents walking between pages, ink drying on a fresh edit. Static chrome stays quiet.

All tokens live in `src/client/theme.css`. Use the tokens; don't hard-code colours.

## Palette

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#f8f7f4` | `#121211` | App background, map background |
| `--paper-raised` | `#ffffff` | `#1b1b19` | Cards, chrome pills, panels, palette |
| `--paper-sunken` | `#f0eee9` | `#0c0c0b` | Hover fills, kbd, inset wells |
| `--rule` | `#e8e5df` | `#292825` | Hairlines, dividers |
| `--rule-strong` | `#d5d1c9` | `#3b3a36` | Hover borders, dashed "new" outlines |
| `--ink` | `#161513` | `#edece8` | Text, primary pill button fill |
| `--ink-soft` | `#5d5b56` | `#b3b1ab` | Secondary text |
| `--ink-faint` | `#8e8b84` | `#7e7c77` | Meta text, placeholders, icons at rest |
| `--wax` (accent) | `#2d4ec0` | `#93a8f4` | Links, focus, selection, a live caret. Small areas only |
| `--wax-soft` | `#e9edfb` | `#1d2340` | Tinted backgrounds behind accent text |
| `--working` / `--waiting` / `--failed` | `#2f7a55` / `#9a6a12` / `#b23a2c` | `#7cc9a0` / `#e3b866` / `#f08f80` | Status dots and short labels |

- **One accent.** `--wax` is a deep ink blue (the name is historical). Never use it for a large fill or a primary button. The primary button is a near-black pill (`--ink` on `--paper`) and inverts in dark mode.
- **Agents.** Each agent has a colour, used for its name, footprints, caret and signature, and for nothing else.

  | Token | Light | Dark |
  |---|---|---|
  | `--agent-scout` | `#c0602f` clay | `#eb9a6e` |
  | `--agent-wren` | `#3b7a58` sage | `#86c9a2` |
  | `--agent-atlas` | `#6b56a8` violet | `#b3a3ec` |

  Atlas moves from navy to violet so it can't be mistaken for the link accent. Agent colours come from the server (`agents.color`, seeded in `src/server/seed.ts`), so the next server round should change the seed to `#c0602f`, `#3b7a58` and `#6b56a8`. For dark mode, lift a server colour with `color-mix(in oklab, <colour> 55%, #f2f1ed)` rather than a parchment cream.
- **People** (`PERSON_INKS` in `lib/ui.ts`) stay in the same calm range.

## Type

| Token | Value | Use |
|---|---|---|
| `--font-display` / `--font-serif` | Newsreader (variable: opsz 6–72, wght 300–600, italic) | Headlines, page titles, map area names, quotes |
| `--font-ui` | Inter (wght 400–650) | Everything else: UI, body text, cards |
| `--font-hand` | Cedarville Cursive | The one bit of magic: see below |

- **Display.** Light weights with tight tracking: weight 340–400, letter-spacing −0.03 to −0.035em, line-height 1.0–1.1. The welcome headline is `clamp(42px, 4.9vw, 68px)` at weight 360. Page titles should be about 40–44px at weight 400, not 600.
- **Map area names** are huge, faint and italic: Newsreader italic at weight 300–400, `--ink-faint` at around 35–50% opacity, normal letter-spacing, sentence case. No small caps, no letter-spaced capitals, no flourishes.
- **Body.** Inter 15–16px, line-height 1.55–1.6. Headings inside pages use Newsreader 500.
- **Handwriting.** Keep it, but only in three places: an agent's signature under a diary reply, the agent's name on its caret while it edits, and the reply while it is being written. Once a reply has finished writing, it can stay in the hand or settle into Newsreader italic. Never use it for buttons, chips, labels or the map's agent roster. Elsewhere, write agent names in Inter 500 in the agent's colour.
- **Loading.** `index.html` loads Inter, Newsreader and Cedarville Cursive in one Google Fonts request with `display=swap` and preconnects. The map no longer needs its own font request (see Next rounds).

## Shape and depth

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 8px | Small controls, kbd |
| `--radius` | 10px | Buttons, menu items, inputs |
| `--radius-lg` | 16px | Cards, panels |
| `--radius-pill` | 999px | All floating chrome: brand, search, Diary, zoom, notices |
| `--shadow-chrome` | 1px hairline ring + 0 2px 10px at 6% | Floating pills on the map |
| `--shadow-card` | 0 1px 2px at 4% + 0 6px 24px at 6% | Cards on the map, page cards |
| `--shadow-pop` | ring + 0 4px 12px + 0 24px 64px at 12% | Palette, menus, notices |

Prefer the soft shadow over a border. Cards are white on the off-white paper, with no borders and no double rules.

## Chrome

- **Floating pills on the map**, in the knowspace pattern: the brand top left (mark and wordmark), the search pill centred (`Search your pages or ask an agent…  ⌘K`), and the Diary as a black pill top right. Map controls (zoom, minimap, "From a photo") use the same white pill with `--shadow-chrome`.
- **On a page**, the top bar is translucent paper with a hairline rule underneath.
- **Notices** are white pills with `--shadow-pop`; an error adds a 3px `--failed` bar on the left. No black toasts.
- **Icons** come from lucide at 16px with a 1.75–2px stroke. No quills or feathers (we use `NotebookPen`), no wands, no compasses.
- **The mark** (`shell/Mark.tsx`) is an ink drop in a dot. It's used for the brand, the session gate, the welcome and the favicon.

## Motion

Things move to tell you something has changed, or to show continuity. Nothing loops just to decorate, except the welcome's drift.

| Token | Value |
|---|---|
| `--ease-ink` | `cubic-bezier(0.22, 1, 0.36, 1)`: arrivals and settles |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)`: crossfades |
| `--dur-fast` / `--dur` / `--dur-slow` | 140ms / 240ms / 700ms |

- **What moves:** agents' footprints and walk; a reply writing itself; ink drying on fresh edits (colour fading to `--ink`); panels sliding in; the welcome.
- **The welcome.** A logo beat lasts about 1s and also waits briefly for the display font. Then the words rise in sequence, 90ms apart, and the objects settle outward from just inside their spots. Objects drift ±7px over 7–11s, with a contact shadow that breathes in sync, and lean slightly away from a fine pointer. On "Open your notebook", every object travels straight outward from the centre while the paper fades and the map scales from 0.94 to 1. It reads as the view moving forward into the map.
- **Reduced motion** (`prefers-reduced-motion: reduce`): no logo beat, no drift, no parallax, no travel. Opacity fades of 240ms or less only. Every new animation needs a reduced branch.
- **Layout.** Animate only `transform` and `opacity`. Never animate layout properties, and never shift layout as fonts or images arrive.

## Dark mode

Dark mode is the same notebook at night: a neutral near-black (`#121211`) with warm-white ink, raised surfaces one step lighter, and shadows that get deeper rather than lighter. It is not candlelight. Drop all brown, gold and amber washes, glows and vignettes. Photographs dim slightly (`brightness(0.9)`). The primary pill inverts to a light pill.

## Welcome

- `src/client/welcome/`. It shows on a first visit to `/` (remembered in `localStorage["inkwell-welcomed"]`), never on deep links (`/p/:id`, `/?focus=`), and always with `?welcome`. Automated browsers (`navigator.webdriver`) skip it unless `?welcome` is present, so scripted checks land on the map.
- The copy:
  - Headline: "A notebook that writes back."
  - Line: "Write a request. Watch it get done across your pages."
  - Button: "Open your notebook".
- The objects are photographic cut-outs of things from the demo notebook's world: a boarding pass to Lisbon, a pastel de nata, an espresso, a sourdough loaf, a paperback, a fountain pen, sticky notes, a phone with a chart, a film camera, a pilea, an azulejo tile, reading glasses, a lemon, a tin of sardines. Wide screens show 14 objects; phones show 6, in a row above and a row below the text.
- `scripts/paint-objects.mjs` paints and optimises them from one prompt list (shared style: studio light from the upper left, transparent background). It uses Meta Muse Image by default; pass `--provider openai` to use OpenAI. The output is alpha WebP, 400px on the long side, 7–50 KB each. To add an object, add it to the prompt list, then to `welcome/objects.ts` with its aspect ratio and position.

## Don't

- Parchment, paper grain, stains, damp mottling, fold creases, burnt or darkened edges, vignettes.
- Faux-antique lettering: IM Fell, blackletter, letter-spaced small caps, swashes and flourishes (`~ Title ~`), drop caps.
- Wizard props: quills, wands, wax seals, scrolls, banners, compass roses, owls, candles, "Mischief managed" in the chrome. Easter eggs stay hidden until someone triggers them.
- Candlelit or sepia dark mode, gold ink, glowing text.
- Double-rule frames, hand-drawn boxes, dotted "ink" borders around cards.
- Wizard language in the UI ("Unfolding the parchment", "Paint", "Swear"). Use plain verbs: open, write, ask, make.
- More than one accent colour, coloured primary buttons, gradients on chrome.
- Handwriting outside its three places.

## Next rounds (not changed here)

These files belong to other workers. After this round's token changes they look half-converted:

- **Map** (`src/client/map/**`):
  - Remove the layers that draw parchment: `.paper` radial stains and the inset vignette (`--map-stain` and `--map-glow` are now transparent, and `--map-paper-deep` equals the paper), `.mottle`, the fold creases (the visible vertical and horizontal bands), and the compass rose.
  - Drop the `map/fonts.ts` request for IM Fell English; `--font-map` now points at Newsreader.
  - Turn area names into big, faint Newsreader italic in sentence case, with no flourishes and no letter-spacing.
  - Replace the double-rule region frames and hand-drawn room boxes with nothing: an area is just its name and the cards near it.
  - Make page cards white `--paper-raised` with `--shadow-card` and `--radius-lg`, an Inter 550 title and an Inter excerpt.
  - Restyle the minimap as a white pill card; its blocks currently render as dark grey squares, and should be `--rule` with agent dots.
  - Write agent chips as Inter names in the agent's colour (no handwriting), on white pills.
  - Footprints can stay: they are the magic. Draw them in the agent colour at 50–70% opacity.
  - Remove `--fallback-ink: #8a2b1f` (oxblood) and use `--ink-faint`.
  - Consider a centred greeting on the map ("Good evening." plus one line about what the agents did), in the knowspace pattern.
- **Diary** (`src/client/diary/**`, `styles/diary.css`):
  - The diary title is 40px handwriting in `--wax` and rotated; make it a Newsreader 28–32px headline, upright, in `--ink`.
  - The handwriting placeholder and "sinking ink" effects can stay subtle, but the soaking colour should be `--ink-soft`, not the accent.
  - The Stop button uses `--wax` as a fill; use `--ink`.
  - Apply the handwriting rule above.
- **Page** (`src/client/page/**`, `styles/page.css`):
  - Set the page title to Newsreader 400, 40–44px, −0.03em; at 600 it is too heavy in Newsreader.
  - Set prose h1–h3 to weight 500.
  - Links use the new blue `--wax` with a dotted underline; consider a solid 1px underline at 35% instead.
  - The cover placeholder gradient uses `--wax`, so it now turns blue; make it neutral.
  - "Paint a cover" should read "Make a cover" (the palette already says this).
  - In `illustrate.ts`, the prompt still asks for "antique parchment map vignette" covers; ask for a calm editorial photograph or flat illustration instead (server round).
- **Server seed**: change the agent colours as listed above.
