# Inkwell: submission

Answers for the submission form. The four TODOs at the bottom must be resolved before pasting.

## Project name

Inkwell

## Tagline (≤ 70 characters)

A notebook that rearranges itself around what you ask.

## Short description (~150 words)

Inkwell is a notebook where AI agents do the work inside your pages, and you can watch them do it. You write a request in the diary. Scout researches, Wren writes and Atlas organises, all running on Meta's Muse Wonder. Every page is a card on a map, and you watch the agents walk between the cards they read and change. Ask "What's left before we launch?" and the map rearranges itself to answer: the launch pages fly into Done, In progress and To do. Agents leave live widgets, like a countdown or a trip budget, whose numbers change as you edit the pages. Circle pages with the pen to ask about just those.

Muse Voice takes spoken requests, SAM 3.1 and Muse Wonder turn a photo of sticky notes into pages, and Muse Image paints covers.

Watch a two-minute recording of real runs replayed through the live app, with no setup. Or try it with your own Meta API key, which stays in your browser.

## Full description (~500 words)

Most AI help with notes happens somewhere else: you copy material into a chat and paste the answer back. Inkwell puts three agents inside the notebook, and lets you watch them work.

You write a request in the diary. Scout researches, Wren writes, Atlas organises, all on Muse Wonder with fourteen notebook tools: read, search, create, edit, link, move and delete pages, hand work to another agent, show a lens, and add or remove a widget. Every page is a card on a map; the agents walk between the cards they read and change, and their words arrive in the open page as you watch. An edit made against text you have since changed is refused, so an agent never writes over your typing.

Most canvases hold your notes where you left them. Inkwell's map changes shape around the question. Ask "What's left before we launch?" and Atlas lays the launch pages out as a lens: the cards lift into Done, In progress and To do while the rest of the notebook fades back. Agents also leave live widgets: a countdown, progress across every task list, a trip budget summed from prices scattered through the pages. The server recomputes them whenever a source page changes, so when you tick a task or change a price, the number moves. With the pen you circle the pages you mean, link two cards with a line, or strike one through.

The other Meta models cover the other ways in. Muse Voice turns a spoken request into text you check before sending. SAM 3.1 finds each sticky note in a photo, Muse Wonder reads the handwriting, and each note becomes a card about where it sat. Muse Image paints page covers, and painted the welcome screen.

Each agent is defined as files, following Vercel eve's conventions: short instructions, plus skills it loads only when a request needs them. We measured the difference against real Muse Wonder: without the demo's hidden guidance, four of the five demo requests failed at least once; with skills, every case passed. A twenty-case corpus checks what was saved, not what the agent claimed.

Judges can watch a two-minute tour with no setup. It isn't a video: every Meta response from real runs was recorded, and the app replays them through its live agent runtime, so pages are really written and widgets really update. Or try it with your own key, which stays in your browser.

"Build for Your World" here means the material people already have: a trip in five open tabs, a launch plan, a desk of sticky notes.

## Meta models used

- **Muse Wonder (`muse-wonder-1.0`):** the three agents, with streamed replies and fourteen tools through the OpenAI-compatible chat API (`tool_choice: "auto"` and `max_completion_tokens`, as the API requires). Reads images attached to a diary request, and reads the handwriting in Photo to cards. Code: [`src/server/agents/`](../src/server/agents/), [`photo.ts`](../src/server/media/photo.ts).
- **Muse Spark Contributor (`muse-spark-1.3-contributor`):** the visitor's cheaper option for the same jobs, chosen in the key dialog. Code: [`meta-access.ts`](../src/server/meta-access.ts).
- **Muse Voice Transcribe (`muse-voice-transcribe-1.0`):** the browser records 16 kHz WAV; the server posts it to `/asr/transcribe`; the text fills the composer for review. Code: [`recorder.ts`](../src/client/diary/recorder.ts), [`transcribe.ts`](../src/server/media/transcribe.ts).
- **SAM 3.1 (`sam-3.1`):** finds each note in a photo through `/responses`. Its boxes go to Muse Wonder with the image and set where each card lands. The notice credits SAM only when it found the notes. Code: [`photo.ts`](../src/server/media/photo.ts), [`boxes.ts`](../src/server/media/boxes.ts).
- **Muse Image (`muse-image-1.0`):** page covers through `/images/generations`, and all 14 welcome-screen objects ([`paint-objects.mjs`](../scripts/paint-objects.mjs)). Code: [`illustrate.ts`](../src/server/media/illustrate.ts).

All five paths were run live on 2026-10-30: `scripts/smoke-meta.mjs` passed 5/5, and the demo cassette was recorded from the real API with every one of them.

## Technical depth

- **Recorded runs replayed through the live runtime.** A cassette holds every Meta exchange of the demo scenario in order (31 exchanges, 153k input tokens, 12k output). On replay the agent runtime and media routes run unchanged, with a transport that answers from the cassette and translates page ids and version tokens from the recording notebook to the demo notebook. The tool calls really execute, so the demo exercises the same code a live run does. Code: [`src/server/demo/`](../src/server/demo/).
- **Agents and people in one live document.** Agent tools write through Yjs into the document the Tiptap editor is connected to. Version-checked edits refuse a write made against stale text; per-page locks queue writes across runs.
- **Bounded handoffs.** `ask_agent` starts a child run. Parent and children share one tool-call budget; each child gets a share of its parent's tokens and time. Handoffs stop three levels deep, and stopping a parent stops its children.
- **Agents defined as files, skills on demand.** Following Vercel eve's conventions, each agent is a folder in [`src/server/agents/defs/`](../src/server/agents/defs/): a short `instructions.md` and skills (`status-lens`, `trip-budget`, `tidy-links`, `long-page`, `plan-trip`, `delegate`) whose one-line descriptions sit in the prompt and whose bodies the agent loads with a `load_skill` tool. Before the change, Muse Wonder failed four of the demo's five requests at least once when it had no hidden guidance; with skills, every case passed. A delete guard reads only what the person typed, so text planted in a page can't make an agent delete it.
- **Reactive widgets.** A widget stores its kind and source pages; the server recomputes its data from the live Yjs documents on every change (debounced per widget), including people's keystrokes, and pushes it over SSE. Totals parse amounts like `€1,200`, `12,50 €` and `€12–15` and skip subtotal lines. Code: [`widgets.ts`](../src/server/widgets.ts).
- **Lenses are a view, not a move.** The agent picks the groups; the client animates each card from its place to the lens on a spring, and back, without ever writing a position. Code: [`lens.ts`](../src/client/map/lens.ts), [`lens-motion.ts`](../src/client/map/lens-motion.ts).
- **Recovery.** A run left running by a restart is closed as interrupted on boot, with Try again; a retry continues the interrupted reply instead of redoing it.
- **Bring your own key, never persisted.** The key is sent per request as a header and held in memory only for the runs it starts. It is never written to the database, logs, errors or events. The model header is allow-listed.
- **Safety nets from the real-model eval.** A link-repair pass fixes page links whose id the model mistyped. A first-byte watchdog abandons a silent call after 30 s and retries once with 60 s.
- **Testing.** 721 unit and integration tests with mocked models; a local stand-in for the Meta API (`npm run rehearse`) that makes real tool calls; and a twenty-case corpus run against real Muse Wonder (including the demo's requests with no hidden guidance) that checks saved state through the public API.

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

- [ ] **TODO: video link.** The video is recorded and edited (2:47, 1920×1080, narrated; kept outside the repo as `inkwell-submission.mp4`). Upload it and add the link above.
- [ ] **TODO: team details** for the form.
- [ ] **TODO: AI-assistance disclosure.** Check the draft above against the wording the form asks for.
- [ ] **TODO: confirm track and eligibility** on the official event page (our notes: due November 4, 2026, 9:00 PM ET; judged on impact 30%, use of Meta AI tooling 25%, technical depth 20%, demo 25%).
