# Local Edition: deployment record (lane B1, 30 Oct 2026)

Judge URL: **https://localedition.pages.dev** (Pages project `localedition`, a thin front). The product is the Worker
`local-edition` (`workers_dev = false`: no public `*.workers.dev` address; verified, the subdomain is disabled). The Pages
`_worker.js` forwards every request over the service binding `APP` and sets `cf-connecting-ip` again.

## Redeploy (one command)

```sh
scripts/deploy.sh                 # build the COMMITTED tree (git HEAD, clean worktree), migrate D1, deploy Worker + Pages
scripts/deploy.sh --tree          # build the working tree as it is (another lane's half-edit can break the build)
scripts/deploy.sh --ref <ref>     # any commit or branch
scripts/deploy.sh --only worker   # or --only pages;  --skip-migrate skips `d1 migrations apply`
```

`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` come from the secret store into a temp dir that is sourced and removed at once.
Worker secrets are not touched by it. Deploys take about 4 minutes (OpenNext build 15 s, Worker upload 70-100 s).

## Resources (ids are not secrets)

| Thing | Name | Id |
|---|---|---|
| D1 | `local-edition` (binding `LE_DB`, migrations in `migrations/`) | `236b5ca1-cb3b-4c85-8d4b-38e5e29e748f` |
| KV | `LE_KV` (provider cache, rate limits, Qloo/Tavily responses) | `725a5fb484954db4a5d12dc99ff0fb9a` |
| R2 | `local-edition-blobs` (binding `LE_BLOB`) | |
| Worker | `local-edition`, cron `0 0 * * MON` (08:00 Kuala Lumpur Monday) | |
| Workflows | `local-edition-edition-build`, `local-edition-weekly-rebuild` (owned by script `local-edition`) | |
| Durable Objects | `SpendMeterDO`, `BuildLockDO`, `TavilyBudgetDO` (also instance `qloo` = the Qloo call ledger) | |
| Pages | `localedition`, service binding `APP` -> Worker `local-edition` (set through the API, see below) | |

Worker secrets (set with `wrangler secret put NAME` from a pipe): `NEBIUS_API_KEY`, `TAVILY_API_KEY`, `LE_JOB_SECRET`
(generated with openssl, stored in the secret store as `LE_JOB_SECRET`), `QLOO_API_KEY` (when the key exists). Never
`NEBIUS_SA_CREDENTIALS`. The secret store also holds `LE_JOB_SECRET` for the CLI runner.

## Traps found on the first deploy (read before touching Pages)

1. **`wrangler pages project create` / `pages deploy` from inside the repo deploys a stray Worker.** This wrangler (4.155) delegates Pages
   commands to "Pages on Workers" and picks up the repo-root `wrangler.jsonc`: it deployed a second Worker named `localedition` and
   re-assigned both Workflows to it. Fixed by deleting that Worker and redeploying `local-edition` (which re-claims the Workflows).
   The project was created with the REST API (`POST /pages/projects`, then `PATCH` with `deployment_configs.*.service_bindings`) and
   `scripts/deploy.sh` stages `edge/pages/` in a temp dir OUTSIDE the repo before `wrangler pages deploy`. Never run Pages commands in the repo.
2. **`fetch(..., { redirect: "error" })` throws a TypeError in workerd.** Every live Token Factory call from the Worker failed as "Could not reach
   tokenfactory". `fetchJson` now uses `redirect: "manual"` and refuses a 3xx itself (commit 44576cd).
3. **The SSE tail slot was never released.** `tailRun` released the per-workspace slot (a D1 lock) after the response had completed; Workers dropped
   it, so every build held its slot for 21 minutes and the second build answered 429 `too_many_streams`. The release now finishes before the
   stream closes (commit eb775b9).
4. **The first live Tavily prefetch is slow.** One build prefetches all 8 sample stores (8 searches, 1 extract, Lightning triage): longer than the
   agent's 25 s tool timeout, so that first `events_this_week` call timed out ("did not finish within 25000 ms"). The work still finished and is
   saved for 7 days; every later build reads it (verified: Park Slope found 1 event with no new credit). Tavily credits used so far: 9 of 80.
   After a Monday rebuild or a cache expiry the first build of the week can show the same timeout once.

## Verification on the live URL (30 Oct 2026, 14:00-14:30 MYT)

| Check | How | Result |
|---|---|---|
| Pages front renders | `curl https://localedition.pages.dev/` | 200. Other pages 404 until the UI lanes' commits are deployed |
| `/api/status` | `curl .../api/status` | `{"qloo":"replay","tokenfactory":"live","tavily":"live","guardrails":"local"}` |
| `cf-connecting-ip` survives the hop | Called `/api/proof` through Pages, then listed the KV key `rl:<sha256("proof:ip:<my ip>")>` | Found; no `proof:ip:unknown` bucket. The visitor's own address is the key |
| SSE > 2 minutes with heartbeats | `POST /api/editions/build` (8 stores) with `curl -N` | Open 250 s, `: open` at once, `: ping` after quiet gaps (67 s, 150 s), ended with `run_done` |
| Cron registered | `GET /workers/scripts/local-edition/schedules` | `0 0 * * MON` |
| EditionBuild Workflow, one demo store, live Token Factory + Tavily (Qloo replay) | Created the demo workspace (signed `POST /api/jobs/monday` with an unknown store id), inserted the `build_runs` row, `wrangler workflows trigger local-edition-edition-build` for `store_williamsburg` | Completed: events 1-33, `run_done`; Nemotron Super VL, Qwen3 embeddings, Lightning copy all answered; guardrail `passed`; about $0.005 |
| Second demo store | Same, `store_park-slope` | `events_this_week` ok from the saved Tavily result (1 event), `run_done` |
| Visitor workspace | `GET /api/workspace` seeds 8 stores from the sample chain in D1 | 200; a visitor build copies the demo's finished editions |

Workflow trigger recipe (no secrets): insert the run row, then trigger.

```sh
# demo workspace first exists after any signed POST /api/jobs/monday (e.g. with an unknown store id -> 400, workspace created)
wrangler d1 execute LE_DB --remote --command "insert into build_runs (id, workspace_id, status, total, done, created_at, updated_at) values ('run_x','demo','running',1,0,<ms>,<ms>)"
wrangler workflows trigger local-edition-edition-build '{"runId":"run_x","workspaceId":"demo","storeIds":["store_williamsburg"],"trigger":"request"}'
wrangler d1 execute LE_DB --remote --command "select seq, substr(json,1,200) from build_events where run_id='run_x' order by seq"
```

## NeMo Guardrails job (live ingest test)

`npx tsx scripts/nebius-job.ts certify eval` with `LE_JOB_SECRET` and `NEBIUS_API_KEY` from the secret store.
Job `local-edition-certify-eval-202610300615`: PROVISIONING 8 s, STARTING 61 s, IMAGE_PULLING 180 s, RUNNING 205 s, COMPLETED 257 s (wall 260 s), exit 0;
5 pending items certified (5 passed, 0 rewritten, 0 blocked, `certifiedBy nemo-guardrails@nebius-job`); eval caught 40 of 40 red-team phrases with 0 of 10
benign wrongly blocked; Token Factory spend about $0.0003, job cost about $0.005. Both signed results landed: `/api/proof` lists a `manual` `certify`
and `eval` JobRun with `nebiusJobId = local-edition-certify-eval-202610300615` and the 50-row eval table. The job shows `DELETING` in
`nebius ai job list` (the runner deletes it in a `finally`).

## Qloo

See the section "Qloo" below (probe, ledger, mode switch).
