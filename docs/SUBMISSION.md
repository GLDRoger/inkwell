# Inkwell: submission

Answers for the submission form. The four TODOs at the bottom must be resolved before pasting.

## Project name

Inkwell

## Tagline (≤ 70 characters)

A notebook that writes back, and shows you its agents at work.

## Short description (~150 words)

Inkwell is a notebook where AI agents do the work inside your pages, and you can watch them do it. You write a request in the diary. Scout researches, Wren writes and Atlas organises, all running on Meta's Muse Wonder. They edit, link and file pages and hand work to each other. Every page is a card on a map, and the agent's footprints move between the cards it reads and changes. Click a card and the page opens beside the map, with new words arriving as the agent writes them.

Muse Voice turns a spoken request into text you check before sending. SAM 3.1 and Muse Wonder turn a photo of sticky notes into pages. Muse Image paints page covers.

Watch a two-minute recording of real runs replayed through the live app, with no setup. Or try it with your own Meta API key, which stays in your browser.

## Full description (~500 words)

Most AI help with notes happens somewhere else. You copy material into a chat, get an answer, and paste it back. Inkwell puts the assistant inside the notebook and shows you what it is doing there.

You write a request in the diary. Pick an agent or let Inkwell choose: Scout researches, Wren writes, Atlas organises. They run on Muse Wonder with eleven tools for the notebook: list, search, read, create, append, edit, rewrite, rename, move and delete pages, and ask another agent for help. A handoff is a real child run with its own footprints, and its report comes back quoted in the first agent's reply.

The home screen is a map. Every page is a card in a group, and each agent walks between them as it reads and writes. Click a card and the page opens in a panel beside the map; the agent's words arrive in its colour, with its name on the caret, and dry to ordinary ink. You can keep typing. Agents have to prove they have seen the latest text: every read returns a version, and an edit made against an old version is refused, so an agent never writes over what you just typed.

The other Meta models cover the other ways in. Muse Voice transcribes a spoken request into the composer so you can correct it before it goes. Photo to cards sends a picture of sticky notes to SAM 3.1, which finds each note; Muse Wonder reads the handwriting using those boxes, and each note becomes a page placed about where it sat on the desk. Muse Image paints page covers, and also painted every object on the welcome screen. Each feature names its model on screen when it works.

Judges arrive knowing nothing, so the first screen offers two paths. Watch it work plays a two-minute demo that is not a video: we recorded every Meta API response from real Muse Wonder, Muse Voice, SAM 3.1 and Muse Image runs, and the app replays them through its live agent runtime in a throwaway notebook. Pages are really created and edited, footprints really walk, and the camera follows the agent while captions explain each step. Try it yourself gives you your own notebook, a four-step guide, and a choice of Muse Wonder or the cheaper Muse Spark Contributor, using your own key. The key stays in your browser and is never stored on our server.

We tested the agents against the real model with a twelve-case corpus that checks what was saved, not what the agent claimed. The first run found real problems: mistyped page links, misrouted requests, replies longer than asked, and Wonder stalling for up to 90 seconds before answering. Each became a fix: links copied from tool results plus a repair pass, routing by every sentence, prompt rules, and a watchdog that retries a silent call.

"Build for Your World" here means the material people already have: a trip in five open tabs, a launch plan, a reading list, a desk of sticky notes.

## Meta models used

- **Muse Wonder (`muse-wonder-1.0`):** the three agents, with streamed replies and eleven tools through the OpenAI-compatible chat API (`tool_choice: "auto"` and `max_completion_tokens`, as the API requires). Reads images attached to a diary request, and reads the handwriting in Photo to cards. Code: [`src/server/agents/`](../src/server/agents/), [`photo.ts`](../src/server/media/photo.ts).
- **Muse Spark Contributor (`muse-spark-1.3-contributor`):** the visitor's cheaper option for the same jobs, chosen in the key dialog. Code: [`meta-access.ts`](../src/server/meta-access.ts).
- **Muse Voice Transcribe (`muse-voice-transcribe-1.0`):** the browser records 16 kHz WAV; the server posts it to `/asr/transcribe`; the text fills the composer for review. Code: [`recorder.ts`](../src/client/diary/recorder.ts), [`transcribe.ts`](../src/server/media/transcribe.ts).
- **SAM 3.1 (`sam-3.1`):** finds each note in a photo through `/responses`. Its boxes go to Muse Wonder with the image and set where each card lands. The notice credits SAM only when it found the notes. Code: [`photo.ts`](../src/server/media/photo.ts), [`boxes.ts`](../src/server/media/boxes.ts).
- **Muse Image (`muse-image-1.0`):** page covers through `/images/generations`, and all 14 welcome-screen objects ([`paint-objects.mjs`](../scripts/paint-objects.mjs)). Code: [`illustrate.ts`](../src/server/media/illustrate.ts).

All five paths were run live on 2026-10-30: `scripts/smoke-meta.mjs` passed 5/5, and the demo cassette was recorded from the real API with every one of them.

## Technical depth

- **Recorded runs replayed through the live runtime.** A cassette holds every Meta exchange of the demo scenario in order (39 exchanges, 229k input tokens, 18k output). On replay the agent runtime and media routes run unchanged, with a transport that answers from the cassette and translates page ids and version tokens from the recording notebook to the demo notebook. The tool calls really execute, so the demo exercises the same code a live run does. Code: [`src/server/demo/`](../src/server/demo/).
- **Agents and people in one live document.** Agent tools write through Yjs into the document the Tiptap editor is connected to. Version-checked edits refuse a write made against stale text; per-page locks queue writes across runs.
- **Bounded handoffs.** `ask_agent` starts a child run. Parent and children share one tool-call budget; each child gets a share of its parent's tokens and time. Handoffs stop three levels deep, and stopping a parent stops its children.
- **Recovery.** A run left running by a restart is closed as interrupted on boot, with Try again; a retry continues the interrupted reply instead of redoing it.
- **Bring your own key, never persisted.** The key is sent per request as a header and held in memory only for the runs it starts. It is never written to the database, logs, errors or events. The model header is allow-listed.
- **Safety nets from the real-model eval.** A link-repair pass fixes page links whose id the model mistyped. A first-byte watchdog abandons a silent call after 30 s and retries once with 60 s.
- **Testing.** 547 unit and integration tests with mocked models; a local stand-in for the Meta API (`npm run rehearse`) that makes real tool calls; and a twelve-case corpus run against real Muse Wonder that checks saved state through the public API.

## Challenges

- **Muse Wonder's latency stalls.** In the corpus and the demo recordings, some steps got no first byte for 30 to 90 seconds, then answered normally. A run would hang with nothing on screen. The first-byte watchdog in [`model.ts`](../src/server/agents/model.ts) aborts a step that hasn't started answering in 30 s and retries once with 60 s, so the worst case is about 1.5 minutes before a plain "Try again in a moment" message. Recording uses the same watchdog with longer waits (60, 120, 180 s), and refuses to keep a cassette in which any run failed. This is also why judges see a recording first: the demo can't stall.
- **Muse Image has no transparency.** The API rejects a `background` option, but the welcome objects need clean cut-outs on light and dark themes. We prompt for each object on a plain grey backdrop and cut it out locally: Apple Vision's subject mask, tightened with a colour matte that unmixes the grey from soft edge pixels so nothing haloes on dark backgrounds.
- **Agents and people writing at once.** An agent works from what it last read, and a person may have typed since. Every read returns a version, every stale write is refused, and the agent is told to read again.
- **Model mistakes that look like success.** Wonder sometimes typed a page id instead of copying it, so a link pointed nowhere. Tool results now carry ready-made links, and a repair pass fixes the rest. The corpus checks every diary link against live pages.
- **Replaying a run in a different notebook.** Recorded responses name page ids and versions from the recording notebook. The player translates them by title, creation order and position, so the same recording works in every visitor's fresh demo notebook.

## What's next

1. A review step for agent edits: see the change, then accept or undo it.
2. A larger evaluation: more cases, several runs each, and Spark Contributor alongside Wonder.
3. Accounts and sharing, so a notebook isn't tied to one browser.
4. Put Inkwell in front of students and small teams, and find out whether watching the agents helps them catch mistakes.
5. More recorded scenarios, so the demo isn't the same Lisbon trip every time.

## Links

- Live app: https://inkwell.76-13-246-244.sslip.io
- Repository: https://github.com/GLDRoger/inkwell
- Video: **TODO**
- Video script: [DEMO.md](DEMO.md)

## AI-assistance disclosure (draft)

Inkwell's code and documentation were written with AI coding agents under the author's direction and review. Most of the work, including the current version, was done with Claude Code using Claude Opus. Earlier phases also used GPT and Muse coding agents for parts of the server, deployment and evaluation corpus. Every AI feature inside the product runs on Meta's models only: Muse Wonder, Muse Spark Contributor, Muse Voice Transcribe, SAM 3.1 and Muse Image.

## Before submitting

- [ ] **TODO: video link.** Record from Watch it work following [DEMO.md](DEMO.md), upload, and add the link above.
- [ ] **TODO: team details** for the form.
- [ ] **TODO: AI-assistance disclosure.** Check the draft above against the wording the form asks for.
- [ ] **TODO: confirm track and eligibility** on the official event page (our notes: due November 4, 2026, 9:00 PM ET; judged on impact 30%, use of Meta AI tooling 25%, technical depth 20%, demo 25%).
