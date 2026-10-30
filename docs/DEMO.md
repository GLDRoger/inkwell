# Inkwell: 2:30 demo script

One continuous story: someone opens Inkwell for the first time and gets their Lisbon trip into shape. Every request builds on the one before, and every Meta model shows its name on screen at the moment it does its work.

## Rules for the recording

- **Real models only.** The final video uses the real Meta API on a build with `META_API_KEY` set. `npm run rehearse` is for practising camera moves and timing; nothing it produces may appear in the video.
- **One run per shot.** The diary reply, the footprints and the page change in a shot all come from the same request. Record each request to completion, then cut. Any cut that shortens a wait gets a small "Wait shortened" caption.
- **Agents are not scripted.** Muse Spark decides which tools to call. Where this script says what an agent "usually" does, re-record if it does something else, or narrate what it actually did. Never stage a result.
- **On-screen model labels.** The app shows four of them by itself: "Written with Muse Spark" under a finished reply, "Transcribed by Muse Voice" in the composer, "Read by SAM 3.1 + Muse Spark" in the photo notice, and "Making a cover with Muse Image…" on the page. Add a matching lower-third caption in the edit for each (listed per shot), so a viewer who misses the small text still sees it.
- **SAM honesty.** The photo notice credits SAM even if SAM failed and Muse Spark found the notes alone. Before using the SAM line, check in the server log or a rehearsal run against the real API that `/responses` returned boxes for this photo. If it didn't, caption the shot "Muse Spark vision" and change the voiceover.

## Before recording

- [ ] Deploy the build you will record, with the key set (see [deploy/README.md](../deploy/README.md); a restart alone doesn't reload the env file). Run `node --env-file=.env scripts/smoke-meta.mjs` on that key first: 5/5.
- [ ] Fresh private window, 1920×1080, browser zoom 100%, light theme, notifications off, reduced motion off.
- [ ] Open `/?welcome` so the welcome plays even if this browser has seen it.
- [ ] Microphone permission granted; test one transcription.
- [ ] A photo of three handwritten sticky notes on a plain desk: "Book Sintra train", "Fado in Alfama – Thu", "Buy tiles at the market". No personal data in the frame.
- [ ] Rehearse every request below twice against the real API. Note how long each takes; that decides where the cuts go.
- [ ] Keep the take in one workspace from start to finish so the map shows everything the story added.

## Shot list

| Time | On screen, and what you do | Narrator | Caption |
| --- | --- | --- | --- |
| 0:00–0:10 | The welcome. The ink drop, then "A notebook that writes back." rises; the photographs settle around it. Click **Open your notebook**. The objects fly outward and the map comes forward. | "This is Inkwell. A notebook that writes back." | |
| 0:10–0:20 | The map: "Good morning." and four groups of cards. Atlas's welcome note writes itself into the diary on the right, with three "Try asking" chips. | "Every page is a place on this map. Scout, Wren and Atlas are agents that work in it. You'll see where they are." | |
| 0:20–0:42 | Tap **Plan my 5 days in Lisbon**, with the agent picker on **Any agent**. Your words sink into the page. The reply is signed by Wren. Hold on the map: Wren's footprints walk from Trip to Lisbon to Lisbon itinerary while the reply writes itself. A new card fades in with an icon (usually ✈️ or 🗺️). "Written with Muse Spark" appears under the finished reply. | "I tap a suggestion. Inkwell sends it to Wren, the writer. The answer writes itself back, and the footprints show what Wren is reading. And there's the plan, as a new page on the map." | Muse Spark · tool calling |
| 0:42–1:05 | Double-click the **Lisbon itinerary** card to open it. Click **Ask an agent**, keep Wren, type: `Add a short rainy-day plan under the table, in case Sintra is wet on day 4.` Send and stay on the page. Wren's caret appears with its name; new lines arrive in green and dry to black. Type one word in the opening line while Wren works, to show both writing in the same page. | "This is the itinerary itself. I ask Wren for a rainy-day plan and watch it arrive. Wren writes into the page I have open, the ink dries, and I can keep typing. If I change something Wren read, Wren has to read it again before it can write." | Muse Spark · live edits |
| 1:05–1:22 | Open the diary, pick **Scout**, tap the microphone and say: "What do I still need to book for Lisbon?" Tap stop. "Transcribing…", then the text appears in the composer with "Transcribed by Muse Voice". Send. Scout's footprints go to Packing & logistics; the reply lists what isn't booked, with links. | "I can also just say it. Muse Voice turns it into text I can check before it goes. Scout reads the logistics page and tells me what's left." | Muse Voice Transcribe |
| 1:22–1:45 | Hold the sticky-note photo to camera for one second. Close the diary and click **Photo to cards** on the map; choose the photo. Notices: "Pinning up your photo…", "Reading your notes…", then "3 notes are on the map. Read by SAM 3.1 + Muse Spark." The map flies to the new cards: a parent page and one card per note, laid out roughly as the notes sat on the desk. Open one to show its text. | "Some of my plans are on sticky notes. Photo to cards: SAM finds each note, Muse Spark reads it, and each one becomes a page, placed about where it was on the desk." | SAM 3.1 + Muse Spark vision |
| 1:45–1:58 | Open the new trip plan page from 0:42. Click **Make a cover**. "Making a cover with Muse Image…" over a soft placeholder, then the cover. Go back to the map: the card now shows it. | "Muse Image makes a cover from what the page says, so it's easy to spot on the map." | Muse Image |
| 1:58–2:18 | Open the diary, pick **Scout**, type: `Check the itinerary against my food notes, then ask Wren to add a lunch spot to each day.` Scout's footprints visit Lisbon itinerary and Lisbon food & neighbourhoods. A step reads "Asked Wren for help"; Wren's footprints set off to the itinerary. Scout's reply ends with Wren's report, quoted and signed "— Wren". | "Agents can hand work to each other. Scout checks my notes, then asks Wren to make the edit. Wren's report comes back inside Scout's reply." | Muse Spark · handoff |
| 2:18–2:30 | Close the diary and click empty map. Type, with nothing focused: `I solemnly swear that I am up to no good`. The map draws itself in again and "Messrs … are proud to present The Map" appears, naming the three agents. Cut to an end card: live URL and repository. | "Write a request, and watch it get done across your pages. Inkwell." | Inkwell · inkwell.76-13-246-244.sslip.io |

Totals: 150 seconds. The 0:20, 0:42 and 1:58 shots depend on model speed; rehearse them first.

## If a live call is slow or goes wrong

- **Slow reply (most likely in the 0:20, 0:42 and 1:58 shots).** Keep recording until it finishes, then cut the wait and add "Wait shortened". Keep the reply, footprints and page change from that one run.
- **Wren edits the existing itinerary instead of making a new page at 0:20.** Either re-record from the welcome in a fresh window, or keep it and change the line to "and there's the plan, written into my itinerary"; then make the cover at 1:45 on Lisbon itinerary.
- **Any agent picks someone other than Wren.** Re-record; don't narrate a route that didn't happen.
- **The agent fails or runs out of steps.** The diary shows Try again or Continue. Use them off camera and record the request again from the start; don't splice a retry into the first attempt.
- **Wren's write is refused because you typed (0:42).** That is the version check working. Either keep it and say "Wren has to read it again first", or type further from Wren's paragraph on the next take.
- **Transcription mishears.** Correct the text in the composer on camera; that is what the review step is for.
- **SAM returns nothing.** Cards may still appear (Muse Spark finds the notes alone). Don't use the SAM narration; caption it "Muse Spark vision" or re-shoot with a clearer photo.
- **Cover is slow or fails.** Make the cover off camera on that page first, then record the shot on a second page. Don't show a cover from an earlier session as if it were new.
- **Practice without spending credit.** `npm run rehearse` runs the whole story with a stand-in API (its fixed transcript is "Ask Wren to draft a packing checklist for the Lisbon trip."). Use it for camera moves and timing only.
