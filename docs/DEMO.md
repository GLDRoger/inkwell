# Inkwell: 2:30 video script

The video has two parts. Most of it is the in-app recorded demo, captured straight from **Watch it work**: real Muse Wonder, Muse Voice, SAM 3.1 and Muse Image runs replayed through the live app. Then a short hands-on segment with a real key, to show it isn't only a recording.

## Rules

- **Say what is recorded.** The demo bar reads "Recorded demo" and replies read "Recorded run · Muse Wonder". Keep both visible; the narration says it once.
- **The hands-on segment is live.** One request on the visitor's own notebook with a real key, recorded to completion. Any cut that shortens a wait gets a small "Wait shortened" caption. Never splice two attempts together.
- **Model labels.** The app shows the model chip on every demo step and the provenance line under every reply. Add a matching lower-third caption in the edit (listed per shot) so a viewer who misses the small text still sees it.
- **No keys on screen.** Paste the key with the field masked, or blur it in the edit.

## Before recording

- [ ] Use the live site (deployed at `3b2def4` or later), or a local production build without a server key.
- [ ] Fresh private window, 1920×1080, browser zoom 100%, light theme, notifications off, reduced motion off.
- [ ] A Meta API key with credit for the hands-on part. Run `node --env-file=.env scripts/smoke-meta.mjs` on it first: 5/5.
- [ ] Play the whole demo once off camera to learn its pacing. If it runs long, record with a local build and `INKWELL_DEMO_PACE=0.8` (lower is faster), or trim the pauses between steps in the edit.
- [ ] Try the hands-on request twice with the real key and note how long it takes; Wonder sometimes stalls 30 to 90 seconds before answering.

## Shot list

| Time | On screen, and what you do | Narrator | Caption |
| --- | --- | --- | --- |
| 0:00–0:10 | The welcome: "A notebook that writes back." with the objects around it. Click **Watch it work**. | "This is Inkwell, a notebook where AI agents do the work in your pages, and you can watch them do it. Everything on this screen was painted by Muse Image." | Muse Image |
| 0:10–0:35 | Demo step 1. The demo bar reads "Recorded demo · Muse Wonder". The camera follows Wren across the map; the new card "Plan: 5 days in Lisbon" appears and the peek panel opens beside the map as Wren writes the plan. | "This is a recording of real Muse Wonder runs, replayed through the live app. Wren reads the trip pages, creates a plan, and you see every edit land." | Muse Wonder · tool calls |
| 0:35–0:50 | Step 2. The chip reads "Muse Voice". The transcript "summarize my reading notes on a new page." goes to Scout; Scout's footprints visit the reading notes and a summary page appears. | "You can talk to it. Muse Voice transcribed this request; Scout summarises the reading notes on a new page." | Muse Voice Transcribe |
| 0:50–1:15 | Step 3. Scout finds the hiring decision, a step reads that it asked Wren for help, and Wren's footprints head off to write the job post. Scout's reply ends with Wren's report, quoted and signed. | "Agents hand work to each other. Scout finds what we decided about hiring and asks Wren to draft the job post. They share one budget, and Wren's report comes back inside Scout's reply." | Muse Wonder · handoff |
| 1:15–1:35 | Step 4. The chip reads "SAM 3.1 + Muse Wonder". The sticky-note photo becomes cards under "Photo notes", laid out roughly as the notes sat. | "Photo to cards. SAM 3.1 finds each sticky note, Muse Wonder reads the handwriting, and each note becomes a page." | SAM 3.1 + Muse Wonder vision |
| 1:35–1:45 | Step 5. The chip reads "Muse Image". The cover arrives on the Lisbon plan and its map card. | "Muse Image paints a cover from what the page says." | Muse Image |
| 1:45–1:55 | Step 6. Atlas links the new pages into their areas. The bar ends with "That's Inkwell. Try it with your own notebook." Click **Try it yourself**. | "Atlas tidies up. That was the recording. Now with my own key." | Muse Wonder |
| 1:55–2:05 | Your own notebook. Close the guide, open the **Inkwell** menu and choose **Add your Meta API key** (or step through the guide to its last step). Paste a key (masked), keep **Muse Wonder**, click **Check key**, then **Save**. | "Your key stays in your browser. It's sent only with your own requests and never saved on the server." | Your own Meta key |
| 2:05–2:22 | Click the **Lisbon itinerary** card to peek it. Open the diary, pick **Wren**, send: `Add a short rainy-day plan to the Lisbon itinerary, in case Sintra is wet on day 4.` Wren's footprints walk to the itinerary and the new lines arrive in the peek panel. "Written with Muse Wonder" appears under the reply. | "This one is live. Wren reads the itinerary and writes the rainy-day plan into the page I'm looking at. If I type while Wren works, Wren has to read the page again before it can write over it." | Muse Wonder · live |
| 2:22–2:30 | End card: the live URL and the repository. | "Inkwell. Write a request, and watch it get done across your pages." | inkwell.76-13-246-244.sslip.io · github.com/GLDRoger/inkwell |

Total: 150 seconds. The demo steps (0:10–1:55) depend on replay pacing; the hands-on shot depends on the live model.

## If something goes differently

- **The demo runs longer than 1:45.** Trim the pauses between steps, not the middle of a step, so each step still shows its run from start to finish.
- **The camera is somewhere else when you want it.** Don't touch the map while recording: moving it pauses the demo camera for 8 seconds.
- **The live reply is slow.** Keep recording until it finishes, cut the wait, and add "Wait shortened". If it fails with "Muse didn't start answering in time", that is the watchdog; click Try again off camera and record the shot again from the start.
- **Wren makes a new page instead of editing the itinerary.** Keep it and change the line to "and there's the rainy-day plan, as its own page", or record again.
- **Wren's write is refused because you typed.** That is the version check. Either keep it and say so, or record again without typing.
- **Practice without spending credit.** `npm run rehearse` runs the hands-on flow against a stand-in API. Use it for timing and camera moves only; nothing it produces goes in the video.
