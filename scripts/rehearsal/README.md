# Rehearsal Meta API

A local stand-in for `api.meta.ai`, so the agents, voice, photo import and covers run end to end in a browser without a key. Dev and rehearsal only: nothing it returns comes from a model.

```sh
npm run rehearse
# client  http://localhost:5174
# server  http://127.0.0.1:8788   (data: ./data/rehearsal)
# fake    http://127.0.0.1:8799/v1
```

`npm run rehearse` starts the fake API, the Inkwell server with `META_BASE_URL=http://127.0.0.1:8799/v1 META_API_KEY=rehearsal`, and Vite proxying to that server. It does not read `.env`, so a real key is never used. Ctrl-C stops all three.

Override with `REHEARSAL_META_PORT`, `REHEARSAL_APP_PORT`, `REHEARSAL_CLIENT_PORT` and `REHEARSAL_DATA_DIR`. `REHEARSAL_FAST=1` removes the artificial delays.

To run only the fake (for example against `npm run dev:server`):

```sh
node scripts/rehearsal/fake-meta.mjs --port 8799
META_BASE_URL=http://127.0.0.1:8799/v1 META_API_KEY=rehearsal npm run dev:server
```

## What it answers

| Endpoint | Behaviour |
| --- | --- |
| `POST /v1/chat/completions` (stream) | Streams OpenAI-compatible chunks with real tool calls. A keyword planner reads the latest user message and the tool results so far, then picks the next call. It pauses 400–900 ms before each step and streams text in 30–60 ms chunks. |
| `POST /v1/chat/completions` (photo vision) | Returns five note cards as strict JSON, using the SAM boxes it was given. |
| `POST /v1/asr/transcribe` | Checks for the multipart `request` and WAV `audio` parts, then returns `{ transcript, turns }` with a fixed transcript: "Ask Wren to draft a packing checklist for the Lisbon trip." |
| `POST /v1/images/generations` | Returns a procedurally drawn parchment PNG (640×400) as `b64_json`. |
| `POST /v1/responses` (SAM 3.1) | Streams `response.output_text.delta` events with native `<\|box;…\|>` tokens sized to the uploaded image, then `response.completed`. |

Like the real API, it returns 401 without a bearer token. It returns 400 for `max_tokens`, `stop`, `n`, `logprobs` or a `tool_choice` other than `"auto"`. Each request is logged as `[fake-meta] POST /v1/... model=... agent=Scout step=3 -> tool read_page`.

### Agent intents

| The message says | The agent does |
| --- | --- |
| summarise, overview, recap | search, read up to two pages, `create_page` "Summary: …" under the first |
| plan, draft, write, checklist, outline | search, read, `create_page` with a goal, a task list and open questions |
| polish, improve, edit, fix | search, read, `edit_page` adding a one-line lede |
| add … to …, expand | search, read, `append_to_page` with a new section |
| rename … "New title" / tidy / move … under … | `list_pages`, read, then `rename_page`, `move_page`, or links appended to the page and its children |
| another agent's name ("Ask Wren to …") | search, read, `ask_agent`; the child run works on the page id it's given |
| delete everything / all | `list_pages`, then a polite refusal; it never calls `delete_page` |
| anything else | search, read, answer from the page with links |

It finds pages with `search_pages` on up to three keywords from the message, then falls back to `list_pages` or the page the person has open. If a tool schema asks for a page `version`, it passes the version from its latest read or write.

## Test

```sh
npx tsx --test scripts/rehearsal/fake-meta.test.mjs
```

The test boots the fake and drives the real agent runtime, transcription, cover, SAM parser and photo import against it. `node scripts/smoke-meta.mjs` also passes 5/5 when `META_BASE_URL` points at the fake.
