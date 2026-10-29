# Backend smoke 2: the five upgrade streams wired together (fixture mode, 29 Oct 2026)

Run: Thu 29 Oct 2026, about 23:05 to 23:10 MYT (15:05 to 15:10 UTC), by the integration worker.
Server: `next dev -p 3411` with `QLOO_MODE=fixture TF_MODE=replay TAVILY_MODE=replay STORE_DRIVER=file SPEND_CAP_USD=0.5`, a throwaway
`LE_JOB_SECRET` (random 48 hex characters, held in a 0600 file in the session scratchpad, never printed), and a fresh data directory.
Qloo had no key; Tavily and the app's Token Factory calls were replay (with fixture fallback), so nothing reached Qloo or Tavily.
The only live model calls were the job script's Lightning self-checks: certify 32 calls, $0.000709; eval 10 calls, $0.000179; total about
$0.0009 of the $0.5 cap, 0 Tavily credits. Each section is a real request to the running server; bodies are cut at 600 characters and the
cookie id is redacted. The server and the CSV helper were stopped by PID afterwards; the regenerated root `AGENTS.md` was deleted.

## The four command lines

| Command | Result |
|---|---|
| `npm run typecheck` (`next typegen && tsc --noEmit`) | exit 0 |
| `npm run lint` (`eslint`) | exit 0, no warnings |
| `npm test` (`vitest run`) | `Test Files  74 passed (74)`, `Tests  997 passed (997)`; `guardrails/.venv/bin/python -m pytest -q guardrails`: 125 passed |
| `npm run build` (`next build`) | compiled, 28 API routes plus `/` (new: `/api/proof`, `/api/limits`, `/api/editions/review`, `/api/chain/brand-voice`, `/api/jobs/{pending,results,eval}`) |

Cloudflare (run in a copy under the scratchpad so this tree's `.next` stayed untouched; nothing deployed):

| Command | Result |
|---|---|
| `npx opennextjs-cloudflare build` | "OpenNext build complete", `.open-next/worker.js` saved |
| `npx wrangler deploy --dry-run --outdir <tmp>` | `Total Upload: 9902.33 KiB / gzip: 1957.04 KiB`; `index.js` 10,139,981 bytes (9.67 MiB raw), 2,002,853 bytes gzipped by `gzip -c`; assets 32 files, about 3.1 MiB. Under Workers' 3 MB free and 10 MB paid compressed limits. Bindings seen: SpendMeterDO, BuildLockDO, EditionBuild and WeeklyRebuild workflows, LE_KV, LE_DB, LE_BLOB, ASSETS, vars STORE_DRIVER, BUILD_MODE, APP_URL, NEBIUS_PROJECT_ID. `workers_dev` is false. |

Nebius, from this machine with the shared service account (nothing created, nothing billed): `npx tsx scripts/nebius-weekly-dry-run.ts` signed the
RS256 JWT with the real key, exchanged it for an IAM token in 1.4 s, and a `POST /ai/v1/jobs` with `dryRun: true` for the real weekly job
(certify then eval, 15 injected files, secrets as files) was accepted: `dry run accepted: local-edition-certify-eval-202610291504`.

## Result per new or changed route

| Route | Result in this smoke |
|---|---|
| `GET /api/proof` | Empty state: no runs, `eval: null`, ratios `null`, no cookie minted. After the work: the newest run of each of the four modes (rebuild, certify, eval, import) with job ids, `eval` 40 of 40 caught and 0 of 10 benign blocked (model Lightning), `scriptSha` from the certify run, `gitSha` from `GIT_SHA`, `spendPerEditionUsd` 0.000132 and `cachedRatio` 0 (from the persisted `step_metrics`; replay data, and Token Factory returned no cached tokens). |
| `GET /api/limits` | Fresh workspace: eight "no edition has been built yet" gaps, nulls, zeros. After: one gap (32 of 32 Qloo evidence records are sample data), `falsePositiveRate` 0, `costPerEditionUsd` 0.000132, `droppedForEvidence` 0 (the seeded fixture test item is counted apart, as designed), `tavilyCreditsUsed` 0 (the Tavily budget only counts live calls). |
| `POST /api/editions/build` (inline, dev) | HTTP 200, 8 of 8 stores, 282 events: 103 `step_metrics` (roles agent, copy, embed), 32 `item_drafted`, 32 `guardrail`, 1 `error` (`seeded_test_dropped`, the labelled fixture-mode verifier test). All 32 items carry `verification`. In dev there is no Workflow, so no `progress` events and `Last-Event-ID` is ignored. |
| `POST /api/editions/review` | HTTP 200, 8 verdicts, no errors. Needed a fix (below): the sample model's reply named none of our stores, so every store was `review_missing`. Now a labelled code-only reviewer answers in fixture mode: 6 approve, 2 `needs_change` from a real shared-artists clash. Bad `weekOf` is 400. The real Ultra path was live-checked by its stream, not here. |
| `POST /api/chain/brand-voice` | Public URL: 200 with 3 lines and fixture evidence rows. Reserved `.example` name and `169.254.169.254`: 400 `private_url`. Non-string url: 400 `invalid_input`. |
| `POST /api/menu/read` | 200, 22 items, `x-le-verify: verified`, `x-le-mode: replay`, 0 unseen, 0 illegible prices. The photo was stored through the blob module (dev filesystem fallback). Malformed multipart: 400. |
| `GET /api/jobs/pending` | No headers 400; bad signature 401 `bad_signature`; signed 200 with 32 items; the same signature again 401 `replayed_signature`. |
| `POST /api/jobs/results` | Bad signature 401. Exercised end to end by `certify.py`: 32 items certified, 32 updated. |
| `POST /api/jobs/eval` | Wrong body 400 with the missing fields. Exercised end to end by `certify.py --mode eval`. |
| `POST /api/jobs/monday` | Bad signature 401; signed 200, built 8 of 8 demo editions, `mode: "rebuild"` run now reaches the proof ledger. |
| `POST /api/stores/import` (job path) | `certify.py --mode import` imported 2 stores into the demo workspace. |
| `PATCH /api/editions/:id/items/:itemId` (live guardrails) | Clean edit: `passed`, now carrying `checkedBy: "live"` and the "Skipped self check output" note (it dropped both before; fixed). Health claim: `blocked` by the TS regex mirror, item `flagged`. |
| regenerate | Williamsburg partner with a hint: replaced, the stale `review` cleared to `null`, new item verified. West Village sound with no hint used the review's hint, and answered `no_alternative` in fixtures (fewer than 8 spare artists), so the review stayed. |
| `GET /api/editions/:id/card` | 200, card written. |
| Workflow-backed build route, Durable Objects, D1, R2, cron | Not runnable under `next dev`. Covered by unit tests with fakes (see the handbacks) and by the bundle building and the dry run; not exercised in workerd. |

## Changes made while wiring (all non-UI)

- `src/server/handlers/proof-ledger.ts` now reads the numbers the other streams already write (`agent/stats.ts` totals and verifier counts,
  `tavily/budget.ts` per-workspace credits) instead of keys nothing wrote. `/api/limits` reads the visitor's own Tavily total.
  Contract: `spendPerEditionUsd`, `cachedRatio` and `costPerEditionUsd` are now `number | null` in `src/contract/routes-upgrade.ts`.
- The Monday route and the weekly Workflow record their runs through `recordJobRun`, so rebuilds show in `/api/proof` next to certify and eval.
- GitHub is out (owner, 29 Oct 23:00): `.github/workflows/` deleted, `src/server/workflows/dispatch.ts` replaced by `nebius-start.ts`, and the weekly
  Workflow starts ONE Nebius job (certify, then eval) through the REST client in `src/server/nebius/`, with the code shipped as injected files from
  `src/server/jobs/job-bundle.generated.ts` (`npm run gen:job-bundle`; a test fails when it is stale). The job name is fixed by the run's start
  time, so a retried step finds its own job (409 then get-by-name). `wrangler.jsonc`: `workers_dev: false`, `APP_URL`, `NEBIUS_PROJECT_ID`.
  `edge/pages/` holds the "localedition" Pages front (`_worker.js` plus `wrangler.toml` with the `APP` service binding), not deployed.
- `recheckItem` (item edit) dropped `checkedBy` and any pass-with-a-note; fixed, with `tests/e/recheck-label.test.ts`.
- `reviewEditions` in fixture mode answers from the clashes code found (`src/server/agent/review-fixture.ts`), labelled `code-clash-check (fixture mode, no model)`.

## Part 1. Status, workspace, new read routes (empty state)

### GET /api/status
`GET /api/status` -> HTTP 200 in 0.01s
headers: content-type: application/json
```
{"qloo":"fixture","tokenfactory":"replay","tavily":"replay","guardrails":"local","spend":{"usd":0,"capUsd":0.5}}
```

### GET /api/workspace (first visit sets the le_ws cookie)
`GET /api/workspace` -> HTTP 200 in 0.08s
headers: content-type: application/json; set-cookie: le_ws=<redacted>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000
8 stores, 22 menu items, 0 latest editions
```
{"workspace":{"id":"ws_1r1f5v1c0a6l2n3i","chainId":"chain_kettle_kiln~1r1f5v1c0a6l2n3i","createdAt":"2026-10-29T15:05:40.408Z"},"chain":{"id":"chain_kettle_kiln~1r1f5v1c0a6l2n3i","name":"Kettle & Kiln (sample chain)","category":"coffee","brandVoice":["Warm and plain-spoken, like the person who knows ...[truncated, 6340 chars total]
```

### GET /api/proof (nothing recorded yet)
`GET /api/proof` -> HTTP 200 in 0.07s
headers: content-type: application/json
```
{"jobRuns":[],"eval":null,"scriptSha":null,"gitSha":"fab1d4de38479ba419370fbf821bce333ab1d0b8","spendPerEditionUsd":null,"cachedRatio":null}
```

### GET /api/limits (fresh workspace)
`GET /api/limits` -> HTTP 200 in 0.06s
headers: content-type: application/json
```
{"droppedForEvidence":0,"guardrailBlocks":0,"falsePositiveRate":null,"qlooCoverageGaps":["Williamsburg: no edition has been built yet.","Park Slope: no edition has been built yet.","Astoria: no edition has been built yet.","Harlem: no edition has been built yet.","West Village: no edition has been built yet.","Lower East Side: no edition has been built yet.","Upper East Side: no edition has been built yet.","Long Island City: no edition has been built yet."],"costPerEditionUsd":null,"tavilyCredi ...[truncated, 510 chars total]
```

## Part 2. Menu read (blob + verify), brand voice

### POST /api/menu/read (sample board photo)
`POST /api/menu/read` -> HTTP 200 in 0.46s
headers: x-le-mode: replay; x-le-verify: verified; content-type: application/json
22 items; seen=false: 0; priceLegible=false: 0
```
[{"id":"mi_1o5l0z0h0e6m3r6p","name":"Espresso","category":"coffee","price":3.5,"currency":"USD","description":"Double shot of our house blend, pulled short","source":"vl","seen":true,"priceLegible":true},{"id":"mi_254b176j495s695b","name":"Cortado","category":"coffee","price":4.75,"currency":"USD","description":"Equal parts espresso and steamed milk, served in a small glass","source":"vl","seen":true,"priceLegible":true},{"id":"mi_5c6m133u1z4d1b1e","name":"Flat White","category":"coffee","price" ...[truncated, 4679 chars total]
```

### POST /api/menu/read (malformed multipart)
`POST /api/menu/read` -> HTTP 400 in 0.01s
headers: content-type: application/json
```
{"error":"The request body is not valid multipart form data.","code":"invalid_multipart"}
```

### POST /api/chain/brand-voice (public URL; Tavily replay with no recording falls back to the labelled fixture)
`POST /api/chain/brand-voice` -> HTTP 200 in 0.07s
headers: content-type: application/json
```
{"lines":["Sample site text.","We are a neighbourhood coffee house.","We keep things plain and warm."],"sources":[{"id":"ev_tv_6j2h3b21103r6164","source":"tavily","endpoint":"/crawl","params":{"url":"https://example.com","limit":"10","extract_depth":"basic","max_depth":"1"},"summary":"Brand voice drawn from this page of the chain's own site: \"Sample site text.\" \"We are a neighbourhood coffee house.\" \"We keep things plain and warm.\"","metrics":{},"entityIds":[],"url":"https://example.com/ab ...[truncated, 859 chars total]
```

### POST /api/chain/brand-voice (reserved .example name refused)
`POST /api/chain/brand-voice` -> HTTP 400 in 0.01s
headers: content-type: application/json
```
{"error":"That address is not a public website. Use the chain's own public site.","code":"private_url"}
```

### POST /api/chain/brand-voice (private address refused)
`POST /api/chain/brand-voice` -> HTTP 400 in 0.01s
headers: content-type: application/json
```
{"error":"That address is not a public website. Use the chain's own public site.","code":"private_url"}
```

### POST /api/chain/brand-voice (bad body)
`POST /api/chain/brand-voice` -> HTTP 429 in 0.00s
headers: content-type: application/json
```
{"error":"Too many requests. Wait a moment and try again.","code":"rate_limited"}
```

## Part 3. Full 8-store build (SSE), review pass, re-attach

### POST /api/editions/build (all 8 stores, inline in dev)
`POST /api/editions/build` -> HTTP 200 in 0.4s, 282 events
event counts: `{"error": 1, "guardrail": 32, "item_drafted": 32, "run_done": 1, "run_started": 1, "step_metrics": 103, "store_done": 8, "store_started": 8, "tool_call": 48, "tool_result": 48}`
step_metrics: 103 calls, roles ['agent', 'copy', 'embed'], total usd 0.00102, cached tokens 0 of 6344 prompt
error events: [["seeded_test_dropped", "store_williamsburg~1"]]
run_done: {"type": "run_done", "runId": "run_1s071r4a1o0p1c4p", "editionIds": ["ed_5f68380z2305401r", "ed_594s081c0h0k0i61", "ed_3y236c5f2z4a212b", "ed_570b2t3004332y1w", "ed_2d09110c4m2v3s3f", "ed_5m4s1i6x6u0g6e5c", "ed_38353v184i6v4i3r", "ed_376x131w0c5q395m"]}
first step_metrics: `{"type": "step_metrics", "storeId": "store_williamsburg~1r1f5v1c0a6l2n3i", "role": "agent", "model": "nvidia/Nemotron-3.5-Super-VL", "tool": "block_profile", "ms": 1, "promptTokens": 60, "cachedTokens": 0, "completionTokens": 20, "usd": 3.6e-05}`

### GET /api/editions (after the build)
`GET /api/editions` -> HTTP 200 in 0.11s
headers: content-type: application/json
8 editions, item kinds {"event": 8, "partner": 8, "sound": 8, "special": 8}, items with verification: 32, statuses ['draft']
```
[{"id":"ed_5f68380z2305401r","storeId":"store_williamsburg~1r1f5v1c0a6l2n3i","weekOf":"2026-10-26","issueNo":1,"items":[{"id":"it_0l0j346e704q085v","status":"draft","evidenceIds":["ev_to_x5rz37","ev_0 ...[truncated, 66315 chars total]
```

### POST /api/editions/review (review pass over the workspace's editions)
`POST /api/editions/review` -> HTTP 200 in 0.2s, 12 events, counts `{"review": 8, "run_done": 1, "run_started": 1, "step_metrics": 2}`
- `{"type": "review", "storeId": "store_williamsburg~1r1f5v1c0a6l2n3i", "verdict": "approve", "reason": "No clash with another store found by code. Williamsburg's brand fit was not judged: this is fixture mode.", "clashWith": [], "hint": null, "reviewedBy": "code-clash-check (fixture mode, no model)"}`
- `{"type": "review", "storeId": "store_park-slope~1r1f5v1c0a6l2n3i", "verdict": "approve", "reason": "No clash with another store found by code. Park Slope's brand fit was not judged: this is fixture mode.", "clashWith": [], "hint": null, "reviewedBy": "code-clash-check (fixture mode, no model)"}`
- `{"type": "review", "storeId": "store_astoria~1r1f5v1c0a6l2n3i", "verdict": "approve", "reason": "No clash with another store found by code. Astoria's brand fit was not judged: this is fixture mode.", "clashWith": [], "hint": null, "reviewedBy": "code-clash-check (fixture mode, no model)"}`
- verdicts across the 8 stores: 6 approve, 2 needs_change (West Village and Upper East Side: "share 8 of their artists", hint `sound: choose different artists than the other store's brief.`); every verdict `reviewedBy` the labelled code reviewer
- error events: []

### POST /api/editions/review (bad weekOf)
`POST /api/editions/review` -> HTTP 400 in 0.01s
headers: content-type: application/json
```
{"error":"body.weekOf: Invalid ISO date","code":"invalid_input"}
```

### POST /api/editions/build with `Last-Event-ID: 3` (the re-attach path, Workflow mode only)
In `next dev` there is no Workflow, so the header is ignored and the route builds inline again: HTTP 200, counts `{"error": 1, "guardrail": 32, "item_drafted": 32, "run_done": 1, "run_started": 1, "step_metrics": 96, "store_done": 8, "store_started": 8, "tool_call": 48, "tool_result": 48}` (production behaviour is covered by `src/server/workflows/route.test.ts` and `tail.test.ts`).

## Part 4. Job routes (signed), monday build of the demo workspace

### POST /api/jobs/monday (bad signature)
`POST /api/jobs/monday` -> HTTP 401 in 0.07s
headers: content-type: application/json
```
{"error":"The request signature is not valid.","code":"bad_signature"}
```

### POST /api/jobs/monday (signed; builds the 8 demo stores in the background)
`POST /api/jobs/monday` -> HTTP 200 in 0.02s
headers: content-type: application/json
```
{"id":"job_183v5746381y1d19","trigger":"manual","startedAt":"2026-10-29T15:05:47.213Z","finishedAt":null,"mode":"rebuild","storeIds":["store_williamsburg","store_park-slope","store_astoria","store_harlem","store_west-village","store_lower-east-side","store_upper-east-side","store_long-island-city"],"status":"running","nebiusJobId":null,"note":"Building 8 stores."}
```

### GET /api/jobs/latest (after the build)
`GET /api/jobs/latest` -> HTTP 200 in 0.05s
headers: content-type: application/json
```
{"id":"job_183v5746381y1d19","trigger":"manual","startedAt":"2026-10-29T15:05:47.213Z","finishedAt":"2026-10-29T15:05:47.383Z","mode":"rebuild","storeIds":["store_williamsburg","store_park-slope","store_astoria","store_harlem","store_west-village","store_lower-east-side","store_upper-east-side","store_long-island-city"],"status":"done","nebiusJobId":null,"note":"Built 8 of 8 editions; 1 error(s): seeded_test_dropped. Drafts await approval."}
```

### GET /api/jobs/pending (bad signature)
`GET /api/jobs/pending` -> HTTP 401 in 0.04s
headers: content-type: application/json
```
{"error":"The request signature is not valid.","code":"bad_signature"}
```

### GET /api/jobs/pending (no headers)
`GET /api/jobs/pending` -> HTTP 400 in 0.00s
headers: content-type: application/json
```
{"error":"headers.x-le-signature: Invalid input: expected string, received undefined","code":"invalid_input"}
```

### GET /api/jobs/pending (signed)
`GET /api/jobs/pending` -> HTTP 200 in 0.02s
headers: content-type: application/json
32 pending items
```
{"items":[{"editionId":"ed_214c4m2x5k3d176x","itemId":"it_0a5b1q533a5c621t","kind":"special","text":"Hojicha, Williamsburg edition\nRoasted green tea with a toasty, caramel finish. This week's pick for Williamsburg, where the block leans Hojicha.\nTry the Hojicha. It is our Williamsburg pick this week.","brandVoice":["Warm and plain-spoken, like the person who knows your order.","Neighbourly first ...[truncated, 14858 chars total]
```

### GET /api/jobs/pending (the same signature again: replay)
`GET /api/jobs/pending` -> HTTP 401 in 0.00s
headers: content-type: application/json
```
{"error":"This signed request was already used. Sign a new one.","code":"replayed_signature"}
```

### POST /api/jobs/results (bad signature)
`POST /api/jobs/results` -> HTTP 401 in 0.04s
headers: content-type: application/json
```
{"error":"The request signature is not valid.","code":"bad_signature"}
```

### POST /api/jobs/eval (signed, body is not an EvalResult)
`POST /api/jobs/eval` -> HTTP 400 in 0.04s
headers: content-type: application/json
```
{"error":"body.at: Invalid input: expected string, received undefined; body.cases: Invalid input: expected number, received undefined; body.caught: Invalid input: expected number, received undefined; body.falsePositives: Invalid input: expected number, received undefined","code":"invalid_input"}
```

## Part 4b. The Nebius batch script against the dev server (`jobs/certify.py`, run locally, not on Nebius)

Run with the NeMo Guardrails venv (`guardrails/.venv/bin/python`, nemoguardrails 0.24.1), `APP_URL=http://127.0.0.1:3411`, the throwaway
`LE_JOB_SECRET`, and the real Token Factory key in the environment for the Lightning self-check (the only live call in this smoke).
The dev server itself stayed in replay and fixture modes. Secrets never appear in these logs (searched for both values: 0 hits).

### `certify.py --mode certify`  (exit 0)
```
Local Edition certify job local-edition-smoke2-certify against http://127.0.0.1:3411
Pending items: 32
Verdicts: 32 passed, 0 rewritten, 0 blocked, 0 without a verdict
App updated 32 item(s). wall 4.2 s, 32 model calls, 11562 in / 64 out tokens (0 reasoning), Token Factory spend about $0.000709
```
### `certify.py --mode eval`  (exit 0)
```
Local Edition eval job local-edition-smoke2-eval against http://127.0.0.1:3411
Eval: caught 40 of 40 red-team phrases (100%), 0 of 10 benign wrongly blocked (0%)
Misses: none
wall 2.1 s, 10 model calls, 2903 in / 20 out tokens (0 reasoning), Token Factory spend about $0.000179
```
### `certify.py --mode import`  (exit 0, CSV of 2 stores served by a throwaway local HTTP server that was stopped afterwards)
```
Local Edition import job local-edition-smoke2-import against http://127.0.0.1:3411
Imported 2 store(s) into the demo workspace (job local-edition-smoke2-import, trigger manual).
```

## Part 5. /api/proof and /api/limits after the work

### GET /api/proof
`GET /api/proof` -> HTTP 200 in 0.31s
headers: content-type: application/json
runs: import/done/manual job=local-edition-smoke2-import; eval/done/manual job=local-edition-smoke2-eval; certify/done/manual job=local-edition-smoke2-certify; rebuild/done/manual job=None
eval: {"cases": 40, "caught": 40, "falsePositives": 0, "benign": 10, "catchRate": 1, "falsePositiveRate": 0, "model": "nvidia/Nemotron-3_5-Lightning", "jobId": "local-edition-smoke2-eval"}
scriptSha=6e7affccc0e9ad9135adf1d7b68dd65aef8d2cbe86b19b951111135ffd5ab1d1 gitSha=fab1d4de38479ba419370fbf821bce333ab1d0b8 spendPerEditionUsd=0.00013156666666666705 cachedRatio=0
```
{"jobRuns":[{"id":"job_import_4d2067a33d6b","trigger":"manual","startedAt":"2026-10-29T15:06:12.696Z","finishedAt":"2026-10-29T15:06:12.697Z","storeIds":["store_6h5z2b2s2j0o1t1u~demo","store_1b2j5m5r5x1x4y4n~demo"],"status":"done","nebiusJobId":"local-edition-smoke2-import","note":"Imported 2 stores ...[truncated, 5794 chars total]
```

### GET /api/limits
`GET /api/limits` -> HTTP 200 in 0.04s
headers: content-type: application/json
```
{"droppedForEvidence":0,"guardrailBlocks":0,"falsePositiveRate":0,"qlooCoverageGaps":["32 of 32 Qloo evidence records in these editions are sample data, not live Qloo responses."],"costPerEditionUsd":0.00013156666666666705,"tavilyCreditsUsed":0}
```

## Part 6. Seams: live guardrails on edit, review hint into regenerate, staff card

### PATCH item edit, clean copy (live guardrails: regex rail, then the Lightning self-check, skipped in replay mode)
`PATCH /api/editions/:id/items/:itemId` -> HTTP 200 in 0.05s
headers: content-type: application/json
guardrail: status=passed checkedBy=live rail=None reasons=["Skipped self check output: the model is not live in this mode."]
```
{"id":"it_2x2e1s02530z322i","status":"edited","evidenceIds":["ev_to_1gjz8o0","ev_00270e11f785ff","ev_116e1aa107cc4e"],"guardrail":{"status":"passed","reasons":["Skipped self check output: the model is not live in this mode."],"checkedBy":"live"},"version":3,"v ...[truncated, 642 chars total]
```

### PATCH item edit, health claim (TS regex mirror blocks it, no model call)
`PATCH /api/editions/:id/items/:itemId` -> HTTP 200 in 0.01s
headers: content-type: application/json
guardrail: status=blocked checkedBy=live rail=check health claims reasons=["Health claim: copy may not mention immunity. Matched \"immune\".", "Diet or allergen claim: no '-free' claims (gluten, dairy, nut, sugar and similar). Matched \"Gluten-free\".", "Allergen claim: cop ...[truncated, 285 chars total]
```
{"id":"it_2x2e1s02530z322i","status":"flagged","evidenceIds":["ev_to_1gjz8o0","ev_00270e11f785ff","ev_116e1aa107cc4e"],"guardrail":{"status":"blocked","reasons":["Health claim: copy may not mention immunity. Matched \"immune\".","Diet or allergen claim: no '-f ...[truncated, 944 chars total]
```

### POST /api/editions/:id/items/:itemId/regenerate with no hint (West Village sound brief; the review's hint is used)
`POST ...regenerate` -> HTTP 200 in 0.04s, counts `{"error": 2, "run_started": 1, "step_metrics": 3, "store_started": 1, "tool_call": 2, "tool_result": 2}`
- `{"type": "tool_call", "storeId": "store_west-village~1r1f5v1c0a6l2n3i", "tool": "block_profile", "args": {}}`
- `{"type": "tool_call", "storeId": "store_west-village~1r1f5v1c0a6l2n3i", "tool": "artists_local", "args": {}}`
- `{"type": "error", "storeId": "store_west-village~1r1f5v1c0a6l2n3i", "code": "item_dropped", "message": "The sound item was dropped: fewer than 8 artists were found."}`
- `{"type": "error", "storeId": "store_west-village~1r1f5v1c0a6l2n3i", "code": "no_alternative", "message": "No new sound candidate with evidence was found."}`

Nothing was replaced (fixture mode has no spare artists), so the review stays: `review.verdict` = needs_change

### POST /api/editions/:id/items/:itemId/regenerate (Williamsburg partner, explicit hint)
`POST ...regenerate` -> HTTP 200 in 0.03s, counts `{"guardrail": 1, "item_drafted": 1, "run_done": 1, "run_started": 1, "step_metrics": 6, "store_done": 1, "store_started": 1, "tool_call": 3, "tool_result": 3}`; review before: approve
partner item replaced: True; stale review cleared: `review` = None; new partner verification: {'lift': 'recomputed', 'entities': 'found'}

### GET /api/editions/:id/card (written on first request)
`GET /api/editions/:id/card` -> HTTP 200 in 0.04s
headers: content-type: application/json
```
{"editionId":"ed_2d09110c4m2v3s3f","storeId":"store_west-village~1r1f5v1c0a6l2n3i","token":"1q70731c081a6h4r3q4m3n4z","lines":[{"heading":"On the speakers","body":"Keep the room Jazz. Start with Chet Baker, Samara Joy, Bill Evans and play artists in their orbit."},{"heading":"Next door","body":"The Jazz Cellar at Barrow. The Jazz Cellar at Barrow is 170 m from the counter and shares the taste of B ...[truncated, 807 chars total]
```


## Remaining gaps (what this smoke did not prove)

1. **Nothing ran in workerd.** The Workflow-backed build route and its D1 tail, the spend meter and build lock Durable Objects, the D1, KV and R2
   drivers, and the cron all have unit tests with fakes and bundle into the Worker (dry run above), but none was run on Cloudflare or in `wrangler dev`.
   The D1 and KV ids in `wrangler.jsonc` are placeholders until `wrangler d1 create`, `kv namespace create`, `r2 bucket create` run.
2. **No real Nebius job has run.** The JWT exchange and a dry-run create were proven live; `run.sh` (pip install, mode loop) was only simulated, and the
   job-side script was run locally here. The first real run is one create (the Monday cron does it, or call `jobs.create` once from a script), wait for `COMPLETED`, then delete the job.
3. **Worker secrets are not set.** `NEBIUS_SA_CREDENTIALS`, `LE_JOB_SECRET`, `NEBIUS_API_KEY`, `QLOO_API_KEY`, `TAVILY_API_KEY`. `GIT_SHA` is read by `/api/proof`
   and must be passed at deploy (`wrangler deploy --var GIT_SHA:$(git rev-parse HEAD)`), else `gitSha` is `null`; `scriptSha` comes from the certify run.
4. **Ultra review, live Tavily chain and Qloo are not in this smoke.** The review verdicts above are the labelled fixture reviewer; Ultra was live-checked by its
   stream (about $0.0013 a review). Tavily credits read 0 because the budget counts live calls only. Qloo is fixtures throughout.
5. **Prompt caching is unproven.** `cachedRatio` is 0 here and S3 saw `cached_tokens: 0` on two identical 1,179-token live calls; the prompt may be under the
   provider's cache threshold. The proof page shows the measured number either way.
6. **Smaller gaps from the streams:** the `check` role emits no `step_metrics` (the NeMo job reports its own spend); the card route's model calls are in the
   ledger but not streamed; a DNS name that resolves to a private address cannot be seen from a Worker (brand-voice URL check); sound regenerate in fixture
   mode answers `no_alternative`; the dev-mode build has no `progress` events and ignores `Last-Event-ID` (production re-attach is covered by `tail.test.ts`).
7. **The Pages front is not deployed**, and `https://localedition.pages.dev` does not exist until `wrangler pages deploy` runs in `edge/pages/`.

## How to repeat

Start `next dev` as above with `LE_JOB_SECRET` set to any 32+ character value, then run the requests in each section; run the job script with
`guardrails/.venv/bin/python jobs/certify.py --mode certify|eval|import` and `APP_URL`, `LE_JOB_SECRET`, `NEBIUS_API_KEY` (from
`~/.secret-store/inject.sh get NEBIUS_API_KEY --dir .`) in its environment.

