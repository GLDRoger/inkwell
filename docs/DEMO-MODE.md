# Demo, guide and hands-on: the contract

Inkwell is a hackathon entry. Visitors (judges included) arrive knowing nothing. The flow:

1. **Welcome** (exists): headline, objects, two buttons: **Watch it work** (primary) and **Try it yourself**.
2. **Demo** — the app plays itself in a separate, throwaway *demo notebook*. Recorded model runs are replayed through the real agent runtime, so pages, footprints, live edits, photo cards and covers really happen in the app — but no model is called and no key is needed. Captions explain each moment; the camera follows the agent and the peek panel shows edits landing. Clearly labelled as recorded.
3. **Try it yourself** — the visitor's own notebook (the existing per-visitor workspace), a short skippable guide, and an "Add your Meta API key" step. AI features use the visitor's key, kept only in their browser.

Decisions (owner, 2026-10-30): peek panel on single click; demo replays recorded real runs (recorded from the rehearsal fake until a key exists, re-recorded from Muse Spark after); the API key stays in the browser and is sent per request, never stored server-side.

## Notebook selection

A session owns two notebooks: `own` (always) and `demo` (created on first demo start, reset on each start).

| Channel | How the client picks the demo notebook |
|---|---|
| HTTP `/api/*` | header `X-Inkwell-Notebook: demo` (absent or `own` → own notebook); `?notebook=demo` also works |
| SSE | `GET /api/events?notebook=demo` |
| Collab websocket | `/collab?notebook=demo` |

The session middleware resolves `ctx.workspaceId` from this. Every existing route keeps working unchanged against whichever notebook was selected. The demo notebook is read-only for people (PATCH/POST/DELETE pages, diary POST, media POSTs → `403 {code: "demo_read_only"}`; collab connections to demo pages are read-only). Only the demo runner writes to it.

## Endpoints

- `GET /api/me` → `{ workspaceId, person, metaConnected, demoWorkspaceId: Id | null }`. `metaConnected` = the **server** has a key (owner's own deployment); the client treats "connected" as `metaConnected || hasBrowserKey`.
- `POST /api/demo/start` → resets the demo notebook to a fresh seed and starts the scenario. Answers with the `DemoState` (`{ playing: true, scenario, stepIndex: 0 }`); `503 {code: "demo_unavailable"}` if no recording is installed. Starting again restarts from the top.
- `POST /api/demo/stop` → stops playback (runs cancelled, notebook kept as is). `204`.
- `GET  /api/demo` → `{ playing: boolean; scenario: DemoScenario | null; stepIndex: number }` (for reloads mid-demo).
- `POST /api/key/check` with header `X-Meta-Key` → `{ ok: true }` or `{ ok: false, error }` (one cheap authenticated Meta call; the key is not stored or logged).

## The visitor's key

AI requests (`POST /api/diary`, `/api/transcribe`, `/api/import/photo`, `/api/pages/:id/illustrate`) accept header `X-Meta-Key`. The server uses it for that request and keeps it **in memory only** for the life of any run it starts (child runs inherit it). Never written to the database, logs, errors or events. If neither the header nor the server env key is present, the server answers as today with `code: "meta_not_connected"` (status 503), and the client opens the key dialog instead of showing an error.

## Which model

Default text/vision model: `muse-wonder-1.0` (owner, 2026-10-30: the others are much worse). Wonder has no Contributor tier (`muse-wonder-1.0-contributor` → 404). In hands-on mode the visitor picks next to their key: **Muse Wonder** (`muse-wonder-1.0`, default) or **Muse Spark Contributor** (`muse-spark-1.3-contributor`, far cheaper; Meta may train on prompts). Sent as header `X-Meta-Model`, allow-listed server-side to exactly those two; anything else → default. Runs record the model they used (`Run.model`), and provenance copy names it ("Written with Muse Wonder"). Recorded demo runs use Wonder. Image (`muse-image-1.0`), voice (`muse-voice-transcribe-1.0`) and SAM (`sam-3.1`) are unchanged.

## Demo events (SSE, demo notebook only)

```ts
type DemoStep = {
  id: string;
  caption: string;          // one plain sentence shown to the viewer, e.g. "Wren is planning your trip. Watch her walk the map."
  model?: "muse-wonder" | "muse-spark" | "muse-voice" | "sam-3.1+muse-wonder" | "sam-3.1+muse-spark" | "muse-image"; // shown as a provenance chip
};
type DemoScenario = { id: string; title: string; steps: DemoStep[]; recordedFrom: "rehearsal" | "meta" };

| { type: "demo.step"; index: number; step: DemoStep; focus: { pageId?: Id; agentId?: Id; runId?: Id } }
| { type: "demo.ended"; reason: "finished" | "stopped" }
```

`demo.step` repeats with the same `index` whenever the focus changes (the run starts, an agent starts writing a page, photo cards land): treat it as a focus update.

Replayed runs carry `Run.recorded = true` and `Run.model`; their diary entries show "Recorded run · Muse Wonder" instead of "Written with Muse Wonder". Files in the demo notebook (cover, photo, voice clip) are served at their usual `/api/files/:id` URLs to the session that owns the notebook, without the header.

## Recording ("cassettes")

`node --env-file=.env scripts/demo/record.mjs` (or `--fake` for the rehearsal fake) runs the scenario against whatever `META_BASE_URL` points at on a scratch data dir, captures every Meta HTTP exchange in order, and writes `src/server/demo/cassettes/<scenario>.json` with `recordedFrom` (generated images sit beside it as `<scenario>.<n>.png`). It stores responses, never request headers, and scrubs key-like strings. Replay serves those responses in order instead of calling Meta, translating page ids from the recording notebook to the demo notebook (seed pages by title, created pages by creation order). Tool calls then execute for real against the demo notebook.

## Scenario (first version)

1. Person writes "Plan my 5 days in Lisbon" → Wren reads the trip pages, creates "Plan: 5 days in Lisbon", edits the itinerary live (peek shows ink arriving).
2. Person speaks "Summarise my reading notes on a new page" (a bundled voice clip, really transcribed by Muse Voice during recording; step model `muse-voice`) → Scout summarises reading notes into a new page.
3. "Ask Scout to find what we decided about hiring, then have Wren draft the job post" → handoff Scout → Wren.
4. Photo to cards on a bundled sample photo of sticky notes (`muse` SAM + vision recorded) → cards land under "Photo notes".
5. Make a cover for the new Lisbon plan (recorded Muse Image PNG).
6. Atlas tidies: links the new pages into their areas. End caption: "That's Inkwell. Try it with your own notebook." with the Try it yourself button.

Pacing: read-only replies (list, read, search) wait 0.8–1.5 s; replies that write or answer wait 2–5.5 s; anything past 30 s in one step plays at 0.4 s per reply. Steps can hold a minimum time on screen (photo and cover: 14 s), and steps are 3.5 s apart so viewers can read the caption. Whole demo ≈ 110 s; `INKWELL_DEMO_PACE` scales it.

Visible requests are what a person would type ("Plan my 5 days in Lisbon"). Any steering a step needs lives in the scenario's hidden `guidance`, added to that run's system prompt only (never shown in the diary, not inherited by child runs). Photo import, real and demo, puts the photo on the "Photo notes" page as its cover with "N notes read from this photo."

## Guide (own notebook, first time after "Try it yourself")

Four skippable coach marks, re-openable from the brand menu ("Show the guide"): (1) the map — click a page to peek, (2) the diary — ask Scout, Wren or Atlas, (3) Photo to cards and voice, (4) add your Meta API key (opens the key dialog). Plain copy, from the user's side.

## Peek panel

Single click on a map card opens the page in a panel beside the map (right side ≥ 900px wide; bottom sheet on phones), live and editable in the own notebook, read-only in the demo. "Open full page" goes to `/p/:id`; Esc or × closes; clicking another card swaps it. Double-click still opens the full page. The map stays interactive and keeps animating footprints. In the demo, the runner's `focus.pageId` opens the peek automatically when an agent writes.
