# Inkwell: plan

Hackathon: Meta Global AI Developer Hackathon. Submissions due **Nov 4 2026, 9:00 PM ET**.
Judging: impact 30%, use of Meta AI tooling 25%, technical depth 20%, demo 25%.
Theme: "Build for Your World".

## The idea

A notebook that writes back, and a map that shows where everyone is.

- **The diary** (Tom Riddle's diary): you write a request in ink. The ink soaks in, and the
  answer writes itself back in the agent's hand. Then the agent goes and does the work
  across your pages. ChatGPT-level capability, but it acts on your notebook.
- **The map** (the Marauder's Map): every page is a place on a parchment map. Zoom out
  for the whole territory, zoom in until the page itself is readable. Agents and people
  are named footprints walking between pages in real time, with ink trails behind them.
- **The pages** (Notion): a calm, fast block editor with nesting, slash commands and
  markdown. Agents edit the same live document you're looking at; you see their ink
  appear as they write.

The canvas is the home screen from day one, not a feature bolted on.

## Meta models (beyond a basic integration)

- **Muse Spark**: the agents' reasoning and tool use (read, search, write, reorganise, hand off).
- **Muse Voice Transcribe**: speak to the diary.
- **Muse Spark vision + SAM 3.1**: photograph a whiteboard or handwritten notes; SAM cuts out
  each sticky note or block, vision reads it, and each becomes a card on the map where it was.
- **Muse Image**: illustrated landmarks/covers for regions of the map.
- **Muse Spark Open / Glimmer (open weights)**: optional fully local mode for self-hosting.

## Architecture

One TypeScript app, one container.

- `src/server`: Hono on Node 22, SQLite (better-sqlite3), Hocuspocus for live Yjs documents
  at `/collab`, SSE at `/api/events`, agent runtime with the Vercel AI SDK against the
  Meta Model API (OpenAI-compatible). Agents edit pages server-side through Yjs, so edits
  stream to open editors.
- `src/client`: Vite + React 19. Tiptap 3 editor with Collaboration. Routes: `/` map,
  `/p/:id` page, diary as a panel available everywhere.
- `src/shared/types.ts`: the contract. Read it first.
- Anonymous per-visitor workspaces seeded with a demo notebook.

## Ownership (disjoint files)

| Area | Paths | Owner |
|---|---|---|
| Server: data, pages, collab, events, sessions, seed | `src/server/**` except `src/server/agents/**`, `src/server/media/**` | Muse (server) |
| Agent runtime and tools | `src/server/agents/**` | Muse (agents) |
| Meta media: transcribe, image, photo import | `src/server/media/**` | Muse (later) |
| App shell, pages, editor, diary | `src/client/**` except `src/client/map/**` | Opus (app) |
| Map canvas | `src/client/map/**` | Opus (map) |
| Contract, plan, eval corpus, integration | `src/shared`, `docs`, `scripts` | Orchestrator |

## Sub-goals (riskiest first; each leaves the app working)

1. Meta Model API works with tool calling (research + smoke test). Blocked on an API key in `.env`.
2. Server foundation: sessions, pages CRUD, Yjs collab, SSE, seed.
3. Agent runtime: runs, tools, live Yjs edits, footprint events, diary streaming.
4. Client: map home with semantic zoom and live footprints; page editor; diary panel.
5. Multimodal: voice, photo-to-cards (SAM 3.1), illustrated covers.
6. Hill-climb: eval corpus of real requests + friction log, iterate until it's fluid.
7. Deploy publicly, README, demo video script, submission.

## Status log

- 2026-10-29: repo created (github.com/GLDRoger/inkwell), contract written. Workers: Muse server foundation, Opus app+diary, Opus map. Deploy target chosen: Hostinger box, subdomain inkwell.questili.com (same host as Spaces, `ssh hostinger-hermes`; keep it separate from /opt/spaces).

## Meta Model API facts (verified 2026-10-29, dev.meta.ai/docs)

- Base `https://api.meta.ai/v1`, `Authorization: Bearer`. Chat Completions, Responses and Messages APIs.
- `muse-spark-1.3`: text/image/video/audio/PDF in, 1M context, parallel tool calls. **`tool_choice` must be `"auto"`** (others 400). No `stop`, `n>1`, `logprobs`. Use `max_completion_tokens`. `reasoning_effort` minimal..xhigh.
- `muse-wonder-1.0` (preview): stronger, $4/$20 per M.
- `muse-image-1.0`: `/v1/images/generations` and `/edits`, $0.01/image.
- `muse-voice-transcribe-1.0`: `POST /v1/asr/transcribe` multipart WAV 16/24 kHz ≤10 min, or realtime `wss://api.meta.ai/v1/asr/realtime`.
- `sam-3.1`: via `/v1/responses` with `input_text` + `input_image`, returns boxes and masks (format: docs/sam/reading-segmentation, to verify).
- Hackathon credit: $150 for a 10-day window. Rate limit 3,000 RPM / 4M TPM per model.

## Checkpoint 2026-10-29 15:05 UTC (resume here)

- Done and committed: scaffold, contract, tokens, Meta API facts; client app shell + editor + diary (first pass, a09ba8c, fb23004); map first pass (1aa5cf1).
- In flight at checkpoint (T3 delegated tasks; they commit locally, don't push):
  - Opus: finish server foundation from Muse's uncommitted `src/server/*` (Muse hit its quota).
  - Opus: app/diary worker; Opus: map worker (uncommitted `src/client/map/*` was theirs).
- On resume: read each worker's report, review diffs, run `npm run typecheck && npx vitest run`, `npm run dev`, look at it; push.
- Next: agent runtime (`src/server/agents/**`, Muse: Spark tool calling with tool_choice "auto", live Yjs edits, footprints, diary streaming, ask_agent); media (`src/server/media/**`: transcribe, SAM 3.1 photo-to-cards, Muse Image covers); port the Spaces corpus to `scripts/corpus` and hill-climb; deploy to the Hostinger box; README, demo video script, submit by Nov 4 9 PM ET.
- Needs from owner: `META_API_KEY` in `.env`; DNS A `inkwell.questili.com` → 76.13.246.244 (fallback `inkwell.76-13-246-244.sslip.io`).
- Spaces prod note: restored after a 6-day outage (nightly backup refused when the app was SIGKILLed on stop, fence left closed). Root cause of the slow shutdown unknown; open sockets ruled out. Proposed: health alert + auto-recover when backup refuses before touching data.
- 15:40 UTC: server foundation landed (Opus finished Muse's work; c1853c9, 2848091; 25/25 server tests). Internal API for the agent runtime is in `src/server/services.ts` (`createServices` → db, bus, pages, collab with transact/appendMarkdown/replaceMarkdown/showAgent). Open item for the app worker: `src/client/lib/events.ts` drops consecutive identical SSE messages, which would lose repeated `diary.delta` chunks.
