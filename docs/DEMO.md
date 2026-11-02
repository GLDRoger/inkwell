# Inkwell: submission video script

The submission video (2:25, 1920×1080, narrated, with English captions) is one visitor's notebook on a production build with no server key. The Meta key is typed into the masked key dialog in the browser. Every agent request is live on Meta's models and was recorded once: no take is spliced from two attempts. Waits are sped up and tagged on screen ("2.5× speed" and so on). The narration is Gemini TTS; the music was synthesized for the video.

## Lines and picture

| Time | Picture (source master, speed) | Narration | Lower third |
|---|---|---|---|
| 0:00.0–0:05.2 | Hook: the lens flight, cards gather into Done / In progress / To do (lens 16.4–21.6), punch-in 1.0→1.22 | hook: "I asked my notebook one question, and it rearranged itself to answer." | Live tag |
| 0:05.2–0:14.2 | Welcome, Try it yourself (open 0.6–3.3); Inkwell menu → Add your Meta API key → key typed masked → Check key → Save (open 7.2–16.0, 1.5×/2×/1.5×/1×), punch-in on the dialog | key: "This is Inkwell. I bring my own Meta key, and it stays in my browser. Everything from here is live, on Meta's models." | Your key · Meta API key, masked |
| 0:14.2–0:26.3 | **Canvas**: zoom out (1.5×), drag (2×), zoom in until cards are pages (2.5×), click Open (2×), the full Lisbon itinerary (1×) | canvas1: "First of all, it's a notebook, on an infinite canvas. Zoom out to see everything. Pan around. Zoom in, and the cards become pages you can read. Open one full screen." | No model call · An infinite canvas |
| 0:26.3–0:33.9 | Back to the map (1.5×), search → "New page called …" (2×), typing in the new page (2×, punch-in), flight to the new card | canvas2: "Or create a new page yourself. Title it, write a sentence, and it settles onto the canvas." | (continues) |
| 0:33.9–0:38.5 | Diary: "What's left before we launch?" typed and sent (lens 2.0–6.6) | lens1: "Now, let's ask it something. What's left before we launch?" | none |
| 0:38.5–0:42.5 | Atlas walks the launch pages (lens 6.6–16.4, 2.5×) | lens2: "Atlas reads the launch pages and sorts them: done, in progress, and to do." | Muse Wonder · show_lens · create_widget |
| 0:42.5–0:48.9 | **Score drop 1.** The lens settled; punch-in to the countdown and progress widgets (lens 21.6–28.0) | lens3: "Then, it adds a countdown to launch day, and a live progress count." | (continues) |
| 0:48.9–0:57.6 | Product roadmap in the peek; tick "Billing"; Launch readiness 5 → 6 of 13; back to the map (tick 5.9–12.0, 15.6–18.2) | tick: "I tick a box on the roadmap. No model call here. The widget re-reads the page, and the count goes up." | No model call · The widget re-reads the page |
| 0:57.6–1:05.7 | Pen on; the hand-drawn loop around the four Lisbon cards, punch-in 1.45 (pen 0.6–8.7). **Score drop 2** on the pen going down at 1:00.5 | pen1: "Next, the pen. I circle the Lisbon trip, and ask what it will cost." | none |
| 1:05.7–1:12.1 | "4 pages circled" chip, "What will this trip cost?" (1.5×); Atlas reads the circled pages (3×) | pen2: "Atlas reads only the four circled pages, and totals every price it finds." | Muse Wonder · pen scope: 4 pages · create_widget |
| 1:12.1–1:17.5 | "Trip to Lisbon — total cost €1,027" widget appears; punch-in (pen 24.6–30.0) | pen3: "Moments later, the total appears, in a widget beside the trip." | (continues) |
| 1:17.5–1:25.2 | Packing & logistics in the peek; flights €380 → €440; widget €1,027 → €1,087 (price 6.3–14.0) | price: "Flights went up? I change one number on the page, and the total follows. Again, no model call." | No model call · Total recomputed from the page |
| 1:25.2–1:32.4 | Lisbon itinerary peeked, diary open; mic on; the user's spoken request (Kore TTS as the microphone, 1:28.1) | voice1: "Or, I can simply say it." · user: "Add a rainy day plan to my Lisbon itinerary." | Muse Voice Transcribe → Muse Wonder |
| 1:32.4–1:44.2 | Transcribing (2×), transcript lands and is sent; Wren works (3×); "Rainy day plan" writes itself into the page and the reply (1.5×) | voice2: "Muse Voice transcribes my request, and then Wren gets to work." · voice3: "It adds a rainy-day plan, straight into the itinerary I'm reading, and replies in the diary." | (continues) |
| 1:44.2–1:55.1 | Photo to cards → sticky-notes.jpg; "Reading your notes…" (4×); five cards land under "Photo notes, 2 Nov" with the toast | photo1: "Got sticky notes on your desk? Snap a photo. SAM 3.1 finds each note, and Muse Wonder reads the handwriting." · photo2: "Five handwritten notes, now five new cards on the map." | SAM 3.1 + Muse Wonder |
| 1:55.1–2:05.1 | Whole map: Wren, then Scout walking with footprints, Wren writing "Investor update: draft" (handoff2 13–46.9, 4× / 2× / 4×) | handoff: "Agents pass work along, too. Wren asks Scout for the fundraising facts, Scout goes and finds them, and then Wren drafts the investor update." | Muse Wonder · ask_agent: Wren → Scout |
| 2:05.1–2:13.6 | Lisbon itinerary full page → Make a cover → "Making a cover…" (3×) → the cover lands; punch-in | cover: "Finally, Muse Image illustrates a cover for this page, inspired by what's written there." | Muse Image · page cover |
| 2:13.6–2:18.5 | Pull back from 1.25× to the whole notebook | close: "One notebook. Three agents. And every answer lands right where I'm looking." | Live tag |
| 2:18.5–2:24.6 | End card, hit.wav on its first frame: "A notebook that rearranges itself around what you ask." · inkwell.76-13-246-244.sslip.io · github.com/GLDRoger/inkwell | card: "Inkwell. A notebook that rearranges itself around what you ask." | none |

