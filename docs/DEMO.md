# Inkwell: 3:00 video script

The video has two parts. Most of it is the in-app recorded demo, captured straight from **Watch it work**: real Muse Wonder, Muse Voice, SAM 3.1 and Muse Image runs replayed through the live app. Then a short hands-on segment with a real key, to show it isn't only a recording.

## Rules

- **Say what is recorded.** The demo bar reads "Recorded demo" and replies read "Recorded run · Muse Wonder". Keep both visible; the narration says it once.
- **The hands-on segment is live.** One request on the visitor's own notebook with a real key, recorded to completion. Any cut that shortens a wait gets a small "Wait shortened" caption. Never splice two attempts together.
- **Model labels.** The app shows the model chip on every demo step and the provenance line under every reply. Add a matching lower-third caption in the edit (listed per shot) so a viewer who misses the small text still sees it.
- **No keys on screen.** Paste the key with the field masked, or blur it in the edit.

## Before recording

- [ ] Use the live site (deployed at the final submission commit), or a local production build without a server key.
- [ ] Fresh private window, 1920×1080, browser zoom 100%, light theme, notifications off, reduced motion off.
- [ ] A Meta API key with credit for the hands-on part. Run `node --env-file=.env scripts/smoke-meta.mjs` on it first: 5/5.
- [ ] Play the whole demo once off camera to learn its pacing. If it runs long, record with a local build and `INKWELL_DEMO_PACE=0.8` (lower is faster), or trim the pauses between steps in the edit.
- [ ] Try the hands-on request twice with the real key and note how long it takes; Wonder sometimes stalls 30 to 90 seconds before answering.

## Shot list

The demo plays for about 2:20 at normal pace. Record it with `INKWELL_DEMO_PACE=0.8` (local production build) and trim the pauses between steps in the edit, never the middle of a step.

| Time | On screen, and what you do | Narrator | Caption |
| --- | --- | --- | --- |
| 0:00–0:08 | Cold open, cut from the lens step later in the recording: the launch cards lift out of the map into Done, In progress and To do, and the countdown and progress widgets land beside them. | "Ask your notes a question, and the notebook rearranges itself to answer." | Muse Wonder |
| 0:08–0:14 | The welcome: "A notebook that writes back." Click **Watch it work**. | "This is Inkwell. Three agents on Meta's Muse models work inside your pages, and you can watch them do it. This is a recording of real runs, replayed through the live app." | Muse Image (the welcome objects) |
| 0:14–0:32 | Step 1. The camera follows Wren; "Plan: 5 days in Lisbon" appears and the page opens beside the map as Wren writes. | "Wren reads the trip pages and writes a plan. You see every edit land." | Muse Wonder · tool calls |
| 0:32–0:42 | Step 2. The chip reads "Muse Voice"; Scout summarises the reading notes on a new page. | "You can talk to it. Muse Voice transcribed this one." | Muse Voice Transcribe |
| 0:42–0:58 | Step 3. Scout finds the hiring decision and asks Wren for help; Wren's avatar heads off to write the job post. | "Agents hand work to each other. Scout finds the decision, Wren drafts the post." | Muse Wonder · handoff |
| 0:58–1:10 | Step 4. The sticky-note photo becomes cards under "Photo notes". | "SAM 3.1 finds each sticky note, Muse Wonder reads the handwriting." | SAM 3.1 + Muse Wonder |
| 1:10–1:16 | Step 5. The cover lands on the Lisbon plan. | "Muse Image paints a cover." | Muse Image |
| 1:16–1:22 | Step 6. Atlas links the new pages into their areas. | "Atlas tidies up." | Muse Wonder |
| 1:22–1:42 | Step 7. "What's left before we launch?" The cards fly into Done, In progress and To do; a countdown (31 days) and progress (5 of 13) appear. | "Now the part other canvases can't do. I ask a question and the map changes shape to answer it. Atlas sorts the launch pages and leaves two live widgets." | Muse Wonder · show_lens, create_widget |
| 1:42–1:50 | Step 8. The page opens beside the progress widget; a task is ticked and the count goes to 6 of 13. | "The widgets are live. Tick a task and the count goes up." | Recomputed from the page |
| 1:50–2:06 | Step 9. A pen stroke circles the trip cards ("3 pages circled"); Atlas adds a "Lisbon budget" widget at €1,027. | "Circle the pages you mean, and ask about just those. Atlas adds up every price in them." | Muse Wonder · pen scope |
| 2:06–2:14 | Step 10. A price changes; the total counts to €1,087. | "Change a price, and the total follows." | Recomputed from the page |
| 2:14–2:20 | The ending: the whole notebook with its widgets, "Good afternoon." Click **Try it yourself**. | "That was the recording. Now live, with my own key." | |
| 2:20–2:28 | Your own notebook. Add the key from the **Inkwell** menu (field masked), keep **Muse Wonder**, **Check key**, **Save**. | "The key stays in my browser." | Your own Meta key |
| 2:28–2:52 | Open the diary and send: `What's left before we launch?` Atlas walks the launch pages and the lens forms live, with its widgets. Cut the wait if Wonder stalls, with "Wait shortened". | "This one is live: Atlas reads my launch plan and lays it out." | Muse Wonder · live |
| 2:52–3:00 | End card: the live URL and the repository. | "Inkwell. A notebook that rearranges itself around what you ask." | inkwell.76-13-246-244.sslip.io · github.com/GLDRoger/inkwell |

Total: 3:00. If the event's limit is shorter, drop the cold open and the cover step first.

## If something goes differently

- **The demo runs longer than 2:00.** Trim the pauses between steps, not the middle of a step, so each step still shows its run from start to finish.
- **The camera is somewhere else when you want it.** Don't touch the map while recording: moving it pauses the demo camera for 8 seconds.
- **The live reply is slow.** Keep recording until it finishes, cut the wait, and add "Wait shortened". If it fails with "Muse didn't start answering in time", that is the watchdog; click Try again off camera and record the shot again from the start.
- **The live lens groups pages differently from the recording.** Keep it: it is live. If Atlas answers without a lens, record again.
- **Wren's write is refused because you typed.** That is the version check. Either keep it and say so, or record again without typing.
- **Practice without spending credit.** `npm run rehearse` runs the hands-on flow against a stand-in API. Use it for timing and camera moves only; nothing it produces goes in the video.
