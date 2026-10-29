# Backend smoke 3: the two fix streams verified (workerd, then one live run), 29 Oct 2026

Run: Thu 29 to Fri 30 Oct 2026, about 23:45 to 00:10 MYT (15:45 to 16:10 UTC), by the Verify worker. Nothing was committed or deployed.
No secret appears here: the throwaway job secret lived in a 0600 scratchpad file, the Tavily key in the one workerd pass that used it was a
deliberately invalid string, and the real keys were only in `.env.local` for the `next dev` run.

## The four command lines (last run after the one fix below)

| Command | Result |
|---|---|
| `npm run typecheck` (`next typegen && tsc --noEmit`) | exit 0 (the `run-log.test.ts` error the fix stream reported is gone) |
| `npm run lint` (`eslint`) | exit 0, no warnings |
| `npm test` (`vitest run`) | `Test Files  86 passed (86)`, `Tests  1153 passed (1153)`; `guardrails/.venv/bin/python -m pytest -q guardrails`: 125 passed; `... pytest -q tests/e`: 12 passed |
| `npm run build` (`next build`) | exit 0, 28 API routes plus `/` |

Fix-A's two stray failures (`menu-verify.test.ts` expecting the old R2 key shape, `tests/s2/batch.test.ts`) no longer fail: Fix-B's L5 work landed and
the full run is green. Fix-A and Fix-B did not conflict.

## One defect found and fixed (breakage between the streams, not a feature)

`src/server/store/d1-binding.ts`: after Fix-B's change `ensureDevSchema` always read the `migrations/` directory first, and it ran whenever
`process.env.NODE_ENV !== "production"`. OpenNext sets NODE_ENV only once a Next request has run in the isolate. A cron or Workflow that
reaches a cold isolate first therefore called `readdir('/bundle/migrations')` inside workerd and the whole WeeklyRebuild errored with
`no such file or directory, readdir '/bundle/migrations'` (0 steps). It showed only after a restart, because the first cron run came after
Next requests had already set NODE_ENV. Fix: never run the dev schema bootstrap inside workerd (`navigator.userAgent === "Cloudflare-Workers"`);
there `wrangler d1 migrations apply` owns the schema. Test: `src/server/store/d1-binding.test.ts` (2 tests). After the fix a cold-start cron
completed (22 steps, `complete`).

## 1. workerd: what ran and how

`npm run preview` is `opennextjs-cloudflare build && opennextjs-cloudflare preview`. It was run in a copy of the tree under the scratchpad (rsync,
no `.env.local`, no `.git`, node_modules cloned with `cp -c`), so the real keys could not be baked into the bundle and this tree's `.next` stayed
untouched. Steps: `npx opennextjs-cloudflare build` (exit 0); `npx wrangler d1 migrations apply LE_DB --local` (0001 and 0002 applied); then
`opennextjs-cloudflare preview --port 8799 --var TF_MODE:fixture --var TAVILY_MODE:fixture --var QLOO_MODE:fixture --var SPEND_CAP_USD:0.5
--var LE_JOB_SECRET:<48 random hex>` with local D1, KV, R2, the three Durable Objects and both Workflows. Processes were stopped by PID (the whole
tree under the wrapper); an unrelated workerd process was not touched.

| Check | Result in workerd |
|---|---|
| `GET /api/status`, `/api/workspace`, `/api/proof`, `/api/limits` | 200, `x-opennext: 1`. `le_ws` cookie is `HttpOnly; SameSite=Lax; Secure` and is accepted over `http://localhost`. Spend read through the SpendMeter Durable Object: `{"usd":0,"capUsd":0.5}`. |
| Workflow-backed `POST /api/editions/build`, demo-shaped chain, 8 stores | 200 `text/event-stream; charset=utf-8`, `cache-control: no-cache, no-transform`, `x-accel-buffering: no`. First bytes `: open`, then `run_started`. 297 events in 3.5 s: 103 `step_metrics`, 48 `tool_call`/`tool_result` pairs, 32 `item_drafted`, 32 `guardrail`, 8 `store_done`, 8 `progress` (`done` 1 to 8 of 8), 8 labelled `seeded_test_dropped` errors (the fixture-mode verifier test), 1 `run_done`. Events were written to D1 and tailed. |
| Same, 50 stores (workspace imported 42 extra stores by CSV) | `run_done`, 50 `store_done`, about 3 s. |
| `Last-Event-ID` reattach | A run left `running` with 4 events: `POST /api/editions/build` with `Last-Event-ID: 1` re-attached instead of starting a build and replayed events 2, 3, 4 at once. When the run was marked done the stream drained the new event (seq 5) and closed. |
| Heartbeats | On that quiet run: `: ping` at 17.2 s and 32.2 s (15 s apart; the first one waits for the 5 s poll step). Only 42 s observed (see gaps). |
| Build lock (BuildLock Durable Object) | Three Workflow instances for one workspace created in the same instant through wrangler's local explorer API: exactly one logged `build_running` and ended, the other two built 8 stores each, one after the other. After each `finish` the lock was free (the next run took it). |
| `build_running` over HTTP | A fresh `running` row in `build_runs` for the workspace: `POST /api/editions/build` returned 409 `build_running`. |
| Item PATCH with `If-Match` | No header: 428 `version_required`. Stale: 409 `version_conflict`. Version 0 approve of an `unchecked` item: 409 `guardrail_unchecked`; with `override: true`: 200 and `status: approved`, version 1. A clean edit: 200 `edited` (guardrail `unchecked`, `checkedBy: live`, rail `self check output`); a health-claim edit: 200, guardrail `blocked` with the three matched reasons, item `flagged`. |
| `POST /api/editions/:id/approve-all` | 200, and approves nothing in fixture mode (every item is `unchecked`; approve-all skips those). After approving each item with an override the edition is `approved`. |
| Staff card and the public card | `GET /api/editions/:id/card` 200, four lines, guardrail `unchecked`. `GET /api/card/:token` without a cookie: 404 `not_found`, as designed: M1 makes every fixture-mode copy check `unchecked`, and the public card needs `passed` or `rewritten`. The live run below shows the 200. |
| `GET /api/proof`, `GET /api/limits` | 200. After the cron run: one `rebuild` job run, `spendPerEditionUsd` 0.000126, `cachedRatio` 0; `/api/limits` `tavilyCreditsUsed` 0, 32 of 32 Qloo records labelled sample. |
| Cron and WeeklyRebuild | `POST /cdn-cgi/local/explorer/api/local/scheduled?worker=local-edition` with `{"cron":"0 0 * * MON"}`: `outcome: ok`, workflow `complete`, 8 of 8 editions built, JobRun note "Nebius job not started (no credentials)." (the weekly Workflow degrades cleanly without `NEBIUS_SA_CREDENTIALS`). Run a second time on a cold isolate after the fix above: `complete`, 22 steps. |
| TavilyBudget Durable Object | With `TAVILY_MODE:live` and an invalid key the cron build took 16 s (real 401 round trips), the object `global` holds stored data and the counter read back 0, so the reserve and the refund of unbilled calls ran in workerd. The explorer cannot read a Durable Object's key-value storage, so the counter was read through `/api/limits` only. |
| SpendMeter Durable Object | Read through `/api/status` only. Reserve and settle were not exercised in workerd: there is no base-URL override to point Token Factory at a fake, and a real call would spend. |

Notes from the run:
- The startup warning "A DurableObjectNamespace ... no such Durable Object class is exported from the worker" is wrangler dev's multi-worker notice. The three
  classes are exported from `worker/index.ts` and all three Durable Objects answered.
- Local workerd served one request at a time while a CPU-bound fixture build ran: two `POST /api/editions/build` fired together ran back to back (second
  `runLog.start` came 20 to 80 ms after the first run finished) and a `GET /api/status` waited 2.4 s. That is a local, fixture-mode artifact (real builds wait on the
  network). It is why the lock was proven with three Workflow instances and a held run row instead of two simultaneous HTTP requests.

## 2. Live run in `next dev` (not preview)

`next dev -p 3433` with `TF_MODE=live TAVILY_MODE=live QLOO_MODE=fixture SPEND_CAP_USD=0.5 STORE_DRIVER=file`, a fresh `LE_DATA_DIR`, keys from
`.env.local` (injected from the secret store). Nothing reached Qloo.

Tavily ledger setup: the global ledger was preset to 5 of the 6 credits of today's slice used (a throwaway script wrote the ledger row into the
scratch data dir). Reason: in live mode the first demo store to ask prefetches ALL eight stores (one search each, then one batched page read), so
with the full slice a "one store" build would spend 6 credits. With 1 credit left the ledger itself enforced the 3-credit limit.

| Step | Result |
|---|---|
| Build ONE demo store: signed `POST /api/jobs/monday` with `storeIds:["store_williamsburg"]` (scheme 1, derived from `LE_JOB_SECRET`) | `done` in 35.9 s. 3 items (special, partner, event); the sound item was dropped by the evidence verifier (`item_dropped`: the fixture Qloo returns too few artists), plus the labelled `seeded_test_dropped`. All 3 items `passed` the guardrails, with the Lightning self-check really answering. |
| Cost of that build | Token Factory spend meter 0 to $0.007467. Persisted `step_metrics`: 11 calls, 18,143 prompt and 2,051 completion tokens, $0.006698 (agent 6 calls 16,311 in / 1,870 out $0.006576; embed 2 calls $0.0000064; copy 3 calls 1,195 in / 181 out $0.000115). The rest of the meter total is Lightning's checks and triage. |
| Tavily, first build | Ledger 5 to 6: exactly 1 credit (the Williamsburg search). The other seven stores and the page read were refused by the ledger (`daily`) and fell back to saved events. Edition evidence: `source: tavily, endpoint /search, mode: live`; the snapshot has 8 found, 3 kept by triage; the kept event became "Gristle Halloween Market kickoff coffee" with a tie-in. |
| Second build of the same store (dev server restarted first, so the in-process prefetch memo was empty and the repo cache was the only thing that could answer) | `done` in 27.9 s, ledger 6 to 6: 0 credits. Evidence mode `cache`, same event. Spend $0.009248. |
| Review pass with real Ultra | `nvidia/Nemotron-3-Ultra-550b-a55b`, role `review`, tool `portfolio_review`: 936 ms, 713 prompt tokens, 86 completion tokens, 0 cached, $0.0007768. Verdict `needs_change`, reason "The partner offer includes a discount not supported by the evidence", hint "partner: Remove the 15% off coffee with vintage purchase offer.", `reviewedBy` the Ultra id. The clash embedding call took 4,449 ms (cold), $0.0000009. Total wall 5.4 s. |
| Staff card and public card, live | Edition approved (`approve-all` approved all 3 `passed` items), card written in 2.6 s with guardrail `passed`, `GET /api/card/:token` without a cookie: 200 with the three lines. This is the path fixture mode cannot reach after M1. |
| `/api/limits`, `/api/proof` | `tavilyCreditsUsed` 6 (the global counter: the preset 5 plus 1 live credit), `costPerEditionUsd` 0.0083173, `droppedForEvidence` 2, `cachedRatio` 0 (Token Factory returned no cached tokens). |

Total spend for the live pass: $0.0177 of the $0.5 cap (two builds, one review, one card). Tavily: 1 credit through the global ledger (limit was 3).
The review ran below the route (a small tsx script calling `reviewEditions` with the live deps against the same data dir): the route
`POST /api/editions/review` returned 402 `spend_cap` in 0.08 s, because at `SPEND_CAP_USD=0.5` the visitors' ceiling is `max(0, 0.5 - 1.5)` = 0 (see gaps).
The card was likewise written by script for the same reason; approve-all and the public card read went over HTTP. The dev server was stopped by PID and the
`AGENTS.md` that Next generates was deleted.

## Remaining gaps

1. Visitor floor against a small cap: `DEMO_FLOOR_USD = 1.5` is a constant, so with `SPEND_CAP_USD` below 1.5 every visitor action (build, regenerate, review,
   card, edit) answers 402 `spend_cap`. Production has a cap of 5, so visitors get $3.50. Anyone running a local live test with a small cap must expect this;
   scaling the floor to the cap (for example the smaller of $1.50 and 30 percent of it) would remove the trap. Not changed here (a design choice, not breakage).
2. Fixture and replay builds can never produce a public card: every copy check is `unchecked` (M1, intended) and the card needs `passed`. UI and demo
   work against fixtures must use the override approve, and the public-card flow needs `TF_MODE=live`.
3. SSE over a long run is not proven: heartbeats and `Last-Event-ID` were exercised for 42 s against workerd on a synthetic running run (a fixture build
   ends in 3 s). The deployed-Workers check of a stream over 2 minutes (docs/CLOUDFLARE.md, risk 3) is still open.
4. SpendMeter Durable Object reserve and settle under real model calls, and TavilyBudget Durable Object with a real live credit, were not run in workerd (no mock
   endpoint, and a real key was kept out of the preview bundle). The live proof above used the file-backed ledgers (same logic, `repoLedger` and the repo
   spend meter). Both objects answered in workerd and the Tavily one reserved and refunded.
5. The Pages front's `cf-connecting-ip` hop, R2 (menu photo read and write), the Nebius job start from the weekly Workflow, and the Nebius REST client were
   not exercised in this pass (preview serves the Worker directly; no `NEBIUS_SA_CREDENTIALS` was given to workerd). Fix-B reported the real job run separately.
6. Daily slice: the live prefetch spends the day's six credits on the first six stores to ask and skips the page read, so the weekly build covers six of eight
   stores live and two from saved events until the next day's slice (as Fix-A documented). The demo store a judge looks at may be one of the two.
7. Review and card routes are charged as "regenerate" and "card" estimates ($0.03, $0.02) against visitor sub-budgets; the live pass measured the review at $0.0008
   and the card at about $0.0002, so the pessimistic estimates are roughly 25 to 100 times the real cost (safe, but a visitor workspace is limited to a handful of actions).
