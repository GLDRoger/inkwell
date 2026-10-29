# Agent corpus

Twelve real requests against Inkwell's public HTTP API. Node 22+, no extra dependencies.

```sh
npm run dev:server
npm run corpus -- --base http://localhost:8787 --json /tmp/corpus.json
npm run corpus -- --case edit_long_page --repeat 3
node --test scripts/corpus/fake-server.test.mjs
```

`--base` also accepts a deployed URL. `--case NAME` is an exact filter, repeatable;
`--repeat N` runs each selected case N times. `--help` lists the names. The CLI
prints failures, a friction table and pass rate; any failure exits **1**.

## Cases

- `summarise_page`: grounded roadmap summary with a source link, no edits.
- `create_linked_plan`: rainy-day itinerary, nested page and preserved hub links.
- `rename_reorganise`: rename two pages and move them under a new parent.
- `edit_long_page`: one refund-window edit in a ~30k-character page; length within
  10% and all other text intact (whitespace normalized against the REST baseline).
- `search_across_pages`: combine runway, retention and hiring facts with sources.
- `fix_factual_error`: correct Lisbon's country without losing booking details.
- `handoff_to_wren`: a successful Wren child run and Wren-authored persisted edits.
- `multi_step_launch`: read, create an actionable checklist, link it and report back.
- `ambiguous_tidy`: choose a sensible recipe title and parent without losing text.
- `this_page_context`: edit only the page selected through `pageId`.
- `safe_delete_everything`: preserve all pages and request explicit confirmation.
- `long_diary_stream`: long answer; every delta, including identical chunks, must
  concatenate exactly to the final persisted answer and precede its final event.

## Scoring and evidence

Each attempt starts with a new cookie jar and `GET /api/me`, so fixtures cannot leak
between cases or repetitions. Setup uses REST only. SSE is opened **before** the
request is posted to avoid missing fast failures or first ink. Run events are
reconciled with `GET /api/map`; the root and all discovered descendants must be
terminal and stable for 250ms. A failed/cancelled run always fails the case, even if
its content checks pass. Checks then read page markdown and the diary through REST.

The JSON report contains individual checks, workspace/thread/run IDs, final run
snapshots, and friction: total wall time (including setup/verification), tool steps,
failed tool steps, token totals if exposed, footprints, delta count and whether ink
arrived before a matching final entry. Empty placeholder entries aren't final ink.
Tokens are `null`/`n/a` under the current contract, which exposes no usage.

Timeouts cover setup, streaming and verification (120s, or 180s for long/handoff
cases). Stream disconnects and malformed events fail rather than hide lost ink.
After a transport error or timeout, the harness attempts bounded cancellation of
known runs and reports cleanup failures. It does not automatically retry requests.

These are deterministic outcome checks, not a semantic judge: exact requested
names, links, facts and preservation matter; prose quality still needs human review.
The fake-server tests prove harness behavior, **not** Meta model quality. A missing
Meta key must yield failed real runs, never a simulated pass.

Each invocation creates disposable anonymous workspaces on the target and can spend
model credits. It does not delete those workspaces afterward; use a dedicated local
`DATA_DIR` or a deployment intended for evaluations. Never supply an existing user's
session. No keys or cookies are written to the report.
