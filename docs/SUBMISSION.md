# Inkwell: submission draft

Draft answers for the submission form. The form's exact fields haven't been checked; paste only after the TODOs at the bottom are resolved.

## Project name

Inkwell

## Tagline (≤ 70 characters)

A notebook that writes back, with a map of your agents at work.

## Short description (~150 words)

Inkwell is a notebook that writes back. You write a request in its diary, the reply writes itself in the agent's hand, and the agent does the work in your pages: drafting, editing, linking, filing. While it works, its footprints walk across a map of your notebook, so you can see which page it is reading and which it is changing. Open that page and the new words arrive in front of you as wet ink that dries.

Three agents run on Muse Spark: Scout researches, Wren writes, Atlas organises, and they can hand work to each other. Muse Voice turns speech into a request you check before sending. SAM 3.1 and Muse Spark turn a photo of sticky notes into pages on the map. Muse Image makes page covers.

It is for anyone whose plans live in scattered notes: a trip, a launch, a reading list. The work stays in the notebook, and you can watch it happen.

## Full description (~500 words)

Most AI help with notes happens somewhere else. You copy material into a chat, get an answer, and paste it back. Inkwell puts the assistant inside the notebook and shows you what it is doing there.

The diary is the way in. It borrows one idea from Tom Riddle's diary: you write, your ink sinks into the page, and a reply writes itself back. You can ask a particular agent, or leave it on Any agent and Inkwell picks one from what you asked for. Scout researches, Wren writes and Atlas organises. They don't just answer. They search, read, create, edit, rename, move and link pages, and they can ask each other for help. A handoff is a real child run with its own footprints, drawing on the same budget, and its report comes back quoted inside the first agent's reply.

The home screen borrows one idea from the Marauder's Map: you can see where everyone is. Every page is a card in a group, and each agent walks between them as it reads, writes and thinks. A greeting says what the agents did since you were last there. New pages arrive with an icon. Double-click a card and you are in the page, a live document where the agent's words appear in its colour, with its name on the caret, and dry to ordinary ink.

People type while agents write, so agents have to prove they have seen the latest text. Every read returns a version, and an edit with an old version is refused, so an agent never writes over what you just typed. Runs have step, token and time limits, can be stopped, survive a server restart as an honest "interrupted" note with Try again, and say plainly when they ran out of room, with a Continue button.

Meta's models cover the other ways in. Muse Voice transcribes a spoken request into the composer so you can check it before it goes. Photo to cards sends a picture of sticky notes to SAM 3.1, which finds each note; Muse Spark reads the notes using those regions, and each becomes a page placed about where it was in the photo. Muse Image makes covers that show on the page and its map card. Each feature names its model in the interface: "Written with Muse Spark", "Transcribed by Muse Voice", "Read by SAM 3.1 + Muse Spark".

Inkwell is one TypeScript app: React and Tiptap on the client, Hono, SQLite, Yjs and Hocuspocus on the server, and the Vercel AI SDK against the Meta Model API. Agents edit the same Yjs documents the editor uses, so there is no separate copy to merge.

"Build for Your World" here means the material people already have: a trip in five open tabs, a launch plan, a reading list, a desk full of sticky notes. Inkwell is built for students, small teams and anyone planning something, though we haven't tested it with them yet. Next we want to run it against the real models at scale, measure where agents go wrong, and add a way to review and undo an agent's edits.

## How Meta models are used

- **Muse Spark (`muse-spark-1.3`):** the three agents. Streamed replies and eleven notebook tools through the OpenAI-compatible chat API, with `tool_choice: "auto"` and `max_completion_tokens` as the API requires. Also reads images attached to a diary request, and reads the text of photographed notes. Code: [`src/server/agents/`](../src/server/agents/).
- **Muse Voice Transcribe (`muse-voice-transcribe-1.0`):** the browser records 16 kHz WAV; the server checks the format and calls `/asr/transcribe`. The text fills the composer for review. Code: [`recorder.ts`](../src/client/diary/recorder.ts), [`transcribe.ts`](../src/server/media/transcribe.ts).
- **SAM 3.1 (`sam-3.1`):** called through `/responses` with the photo and the prompt "each sticky note or distinct block of handwriting". Its boxes go to Muse Spark with the image and set where each card lands. Masks aren't used. Code: [`photo.ts`](../src/server/media/photo.ts), [`boxes.ts`](../src/server/media/boxes.ts).
- **Muse Image (`muse-image-1.0`):** `/images/generations` makes a cover from a page's title and excerpt, stored as an attachment. It also made the welcome screen's photographs ([`scripts/paint-objects.mjs`](../scripts/paint-objects.mjs)). Code: [`illustrate.ts`](../src/server/media/illustrate.ts).

## Technical depth

- **Agents and people in one live document.** Agent tools write through Yjs into the document the Tiptap editor is connected to. Remote text is drawn as wet ink anchored to Yjs relative positions, so it survives paragraph rewrites while it dries.
- **Version-checked edits.** `read_page` returns a hash of the page's markdown; `edit_page` and `rewrite_page` refuse a stale version. `edit_page` needs one exact match and rejects ambiguous ones. Blocks that can't round-trip through markdown (complex table cells) are refused rather than flattened.
- **Visible execution.** Each tool call publishes an `agent.moved` event (reading, writing, thinking, leaving) and a run step. Server-sent events carry them with the diary's streamed text; the map turns them into footprints.
- **Bounded handoffs.** `ask_agent` starts a child run and waits for it. Parent and children share one tool-call budget; a child gets a share of its parent's tokens and time and returns what it didn't use. Handoffs stop three levels deep, and stopping a parent stops its children.
- **Recovery.** On boot, any run still marked running is closed as "Interrupted by a server restart". Shutdown flushes live documents to SQLite.
- **Transactional photo import.** The parent page and every note card commit together, and page events wait for the commit, so a failed import leaves nothing behind.
- **Testing without a key.** 387 unit and integration tests with mocked models; a local stand-in for the Meta API (`npm run rehearse`) that makes real tool calls so every flow runs in a browser; and a twelve-case corpus that checks what was saved through the public API.

## Challenges

- **Agents and people writing at once.** An agent works from what it last read, and a person may have typed since. Every read now returns a version and every stale write is refused, with per-page locks between agents.
- **Making streamed ink match the saved page.** Diary text, page edits, map events and the database travel on different channels. We gave them shared run and page IDs and test the saved state rather than the agent's "done".
- **Fitting the Meta API's shape.** Tool choice must be `auto`, the token limit field differs, transcription wants multipart WAV, and SAM returns boxes as tokens in streamed text. Each has an adapter and tests against fixtures of those shapes; none has run against the live API yet.
- **Keeping the look quiet.** The first version looked like parchment. We kept the Harry Potter ideas in what the app does and moved the look to a plain modern notebook ([`DESIGN.md`](DESIGN.md)).

## What's next

1. Run every model path and the corpus against the real API, read the output by hand, and fix what breaks.
2. A review step for agent edits: see the change, accept or undo it.
3. Photo to cards should say when SAM found nothing and Muse Spark did the work alone.
4. Put Inkwell in front of students and small teams and see whether watching the agents helps them catch mistakes.
5. Accounts and sharing, so a notebook isn't tied to one browser.

## Track

**TODO:** confirm the track and eligibility in the form.

## Links

- Live app: https://inkwell.76-13-246-244.sslip.io (custom domain to follow)
- Repository: https://github.com/GLDRoger/inkwell
- Video: **TODO**
- Demo script: [DEMO.md](DEMO.md)

## Before submitting

- [ ] **TODO: live smoke of each model.** Set `META_API_KEY` locally and on the host, run `node --env-file=.env scripts/smoke-meta.mjs` (5/5), then try each flow in the browser: an agent run with tool calls, a Wren handoff, a voice transcript, Photo to cards with SAM boxes confirmed in the log, and a cover.
- [ ] **TODO: corpus run.** `npm run corpus` against the real API with a throwaway `DATA_DIR`; keep the report and the commit it ran on. Don't quote a pass rate, latency or cost until it exists.
- [ ] **TODO: redeploy.** The host was last deployed at `36d1631`, before round 2, and has no key set. Deploy the commit being submitted.
- [ ] **TODO: record the demo** following [DEMO.md](DEMO.md) with real models, caption it, upload it, and add the link above.
- [ ] **TODO: team details** for the form.
- [ ] **TODO: AI-assistance disclosure.** Code and docs were written with AI coding agents (Claude Opus, Muse, GPT); confirm the exact wording the form asks for and who reviewed what.
- [ ] **TODO: confirm the form, track and deadline** against the official event page (our notes: November 4, 2026, 9:00 PM ET; impact 30%, Meta tooling 25%, technical depth 20%, demo 25%).
- [ ] **Optional before recording:** change the cover prompt in `illustrate.ts` away from "antique parchment map vignette", and make the photo notice honest when SAM returns no boxes.
