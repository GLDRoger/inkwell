# Inkwell: submission draft

Draft for a typical Cerebral Valley form, not a verified copy of the live form. Paste only after resolving the relevant TODOs below.

## Project name

Inkwell

## Tagline

A notebook that writes back, with a living map of your agents at work.

## Short description (~150 words)

Inkwell is a notebook that writes back. It combines Notion-style pages with ChatGPT-style agents that can act on those pages. The diary takes its cue from Tom Riddle's diary: a request sinks into the paper, and a reply writes itself in ink. The home screen borrows from the Marauder's Map. Pages become places; agents leave named footprints as they read and edit.

Muse Spark powers notebook tools and handoffs between agents. Changes reach the same live document the person is editing. Muse Voice Transcribe turns speech into a draft to review before sending. Server endpoints combine SAM 3.1 and Spark vision to turn photographed notes into cards, and use Muse Image to paint page covers. Their client controls are wired in source; browser and live-model verification remain outstanding.

The intended users are students, researchers and small teams working across scattered notes. Inkwell keeps the work in the notebook and makes the agent's path visible.

## Full description (~500 words)

Inkwell starts with a familiar problem: a notebook holds useful material, but turning that material into a plan often means moving it into a separate chat and copying the answer back. We wanted the assistant to work where the notes already live, while showing enough of its activity for the person to follow along.

The result is a notebook that writes back. Its diary is inspired by Tom Riddle's diary: you write a request, the ink sinks into the paper, and an answer appears in the agent's handwriting. The pages are editable documents with headings, lists and links. The agent can change them, not just discuss them. A person can keep the editor open while an agent's changes arrive.

The home screen is a living map inspired by the Marauder's Map. Every page has a place. Zoom out to see the notebook's structure, zoom in to read an excerpt, and open the full page when needed. Named footprints move between pages in response to agent activity. The diary also lists tool steps with links, so a walk across the map has a corresponding record of operations.

Muse Spark powers three seeded agents: Scout researches, Wren writes, and Atlas organises. They use tools to search and read pages, create linked material, make targeted edits, rename or move pages, and request help from another agent. A handoff creates a child run linked to its parent. Runs have time, step and tool limits, and cancellation propagates to active child work. Stopping a run does not roll back completed edits.

Meta's other models extend the input and output paths. Muse Voice Transcribe turns a microphone recording into text that the person can review before sending. A server-side photo workflow asks SAM 3.1 for note regions, then gives the original image and those boxes to Spark vision for transcription. It creates a parent page and positioned note cards in one transaction. If segmentation is unavailable, vision can supply its own regions. Muse Image generates a parchment-style cover from a page title and excerpt. The diary exposes photo import and the page toolbar exposes cover generation. These controls still need a live-model browser rehearsal.

Underneath, Inkwell is one TypeScript application with a React client, a Hono server and SQLite storage. Tiptap, Yjs and Hocuspocus keep live documents connected. Server-sent events carry diary text, page updates and movement. Agents edit the live document through server-side tools rather than maintaining a separate copy that must later be pasted into the editor.

“Build for Your World” means helping people work with the material they already have: study notes, research pages, project plans and photographed workshop notes. Students, researchers and small teams are our intended audience, not a claim of existing adoption. The repository includes a twelve-case agent corpus that checks persisted outcomes and streaming behaviour. Real-model quality, latency and usefulness still need recorded evaluation. Our next step is to verify those paths, check the media controls and test whether visible agent activity helps people spot and correct mistakes.

## How Meta models are used

- **Muse Spark (`muse-spark-1.3`):** streamed diary responses and notebook tool calls. The runtime uses the Vercel AI SDK with an OpenAI-compatible provider adapter. It also uses Spark's image input to transcribe photographed notes.
- **Muse Voice Transcribe (`muse-voice-transcribe-1.0`):** browser recording is converted to WAV and sent through the server to `/asr/transcribe`. The transcript fills the composer; the person decides when to send it.
- **SAM 3.1 (`sam-3.1`):** `/responses` returns candidate note regions. The importer parses bounding boxes and supplies them to Spark. It does not crop images or use segmentation masks. Vision-only fallback is supported.
- **Muse Image (`muse-image-1.0`):** `/images/generations` returns a PNG illustration. The server stores it as a workspace attachment and updates the page cover.

The [README model table](../README.md#meta-models-in-the-code) links to each implementation. **TODO:** verify these configured model paths with the actual credentials and capture live outputs. Mocked tests are not provider certification or a quality result.

## Technical depth

- **One document for human and agent edits.** Server tools write through Yjs into the document connected to the Tiptap editor. Per-page locks serialize competing agent writes.
- **Visible execution.** Page operations publish movement events and persisted run steps. SSE carries those events and streamed diary deltas; the map renders footprints from them.
- **Bounded handoffs.** `ask_agent` waits for a child result, records parentage and shares family budgets. Parent cancellation reaches active descendants.
- **Targeted edits.** The exact-match editing tool rejects missing or ambiguous matches. Long reads return continuation offsets rather than silently truncating the page.
- **Transactional photo import.** The parent and note cards commit together. Page events are buffered until commit, so a failed import does not publish phantom cards.
- **Outcome-based evaluation.** The corpus reads persisted pages and diary entries, follows child runs, and compares streamed deltas with final text. Its fake-server tests validate the harness, not model ability.

## Challenges

- **Keeping model output and notebook state aligned:** diary text, live documents, persisted pages and map events are different channels. The implementation gives them shared page and run IDs and tests the resulting state rather than trusting a final “done” message.
- **Handling concurrent work:** parallel tool calls are serialized within a run; page-level agent locks and run-specific carets avoid mixing independent agent operations. This is not a claim that conflicting human and agent edits always preserve intent.
- **Adapting model protocols:** agent requests need a provider adapter, transcription uses WAV and multipart settings, and SAM output requires box parsing. The code tests these shapes with fixtures. Live compatibility remains a TODO.
- **Showing failure honestly:** failed, cancelled and limited runs have explicit states. Photo import can fall back to vision, so a successful import alone cannot establish that SAM worked.

## What's next

1. Verify the full diary-to-edit loop and all media paths with live Meta responses; publish a dated corpus report and review output quality by hand.
2. Rehearse photo import and cover generation in the browser, including progress, failure and retry states. Check the deployed build matches the verified source.
3. Test the workflow with students, researchers and small teams. Ask whether footprints and linked steps help them understand and correct changes.
4. Add a review-and-undo workflow for agent edits, then evaluate an optional local-model mode. Neither is claimed as a completed feature here.

## Track

Indie. **TODO:** confirm eligibility and the exact track label in the submission form.

## Links

- Live app: https://inkwell.76-13-246-244.sslip.io
- Public repository: https://github.com/GLDRoger/inkwell
- Video: **TODO: upload the final 2:30 demo and insert its public URL.**
- Recording script: [DEMO.md](DEMO.md)
- Evaluation instructions: [scripts/corpus/README.md](../scripts/corpus/README.md)

## Before submitting

- [ ] **TODO: confirm the official form, eligibility, track and deadline.** The supplied brief and project plan say November 4, 2026, 9:00 PM ET; theme “Build for Your World”; weights Impact 30%, Meta tooling 25%, Technical depth 20%, Demo 25%. These have not been checked against an official event page in this documentation pass.
- [ ] **TODO: verify live credentials and each model path.** Capture an actual tool-using agent run, Wren handoff, voice transcript, SAM-backed photo import and generated PNG. Record any vision-only fallback accurately.
- [ ] **TODO: run the live-model corpus and review quality.** Retain its report and tested revision. Do not invent a pass rate, latency, token cost, user count or time-saving metric.
- [ ] **TODO: verify the media controls and deployed revision.** The photo-import and Paint a cover controls were being added concurrently during this documentation pass. The source has call sites; a working browser flow is not yet established here. Use the labelled API fallback if the recording build lacks those controls.
- [ ] **TODO: record, caption and publish the video.** Check the final duration, readability and public viewing permissions; label shortened waits.
- [ ] **TODO: rehearse the public build in a fresh browser.** The app root returned HTTP 200 and `/api/health` returned `{"ok":true}` during the documentation pass. That is reachability evidence only, not proof of the editor, streaming, media, model quality or deployed revision.
- [ ] **TODO: validate impact with intended users.** Intended audience and expected benefit are hypotheses. No adoption or measured productivity result is claimed.
- [ ] **TODO: add submitter/team details and any required AI-assistance disclosure.** This documentation pass used GPT-6 Astra. Confirm code-author details separately; do not infer them from this draft.
