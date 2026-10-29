# Local Edition backend status (Thu 29 Oct 2026)

## Upgrade integration (29 Oct 23:10 MYT, after the five upgrade streams)

Gate: `npm run typecheck`, `npm run lint`, `npm test` (74 files, 997 tests), `guardrails` pytest (125) and `npm run build` (28 API routes) pass.
`npx opennextjs-cloudflare build` and `npx wrangler deploy --dry-run` pass (Worker 9,902 KiB, 1,957 KiB gzipped). Smoke against `next dev` in fixture mode:
`docs/BACKEND-SMOKE-2.md`. Nothing was deployed and nothing ran in workerd.

| Area | State |
|---|---|
| Platform (S1) | D1 `Repo` driver, R2 blob store, spend-meter and build-lock Durable Objects, `EditionBuild` and `WeeklyRebuild` Workflows, SSE route that tails the D1 run log, cron `0 0 * * MON`. One Worker (`worker/index.ts`), `workers_dev: false`. Unit-tested with fakes; not run in workerd. |
| Nebius job (S2 + REST client) | NeMo Guardrails runs as a batch library in one Nebius Serverless Job (certify, then eval; import mode on demand). The Worker's weekly Workflow starts it through `src/server/nebius/` (JWT, IAM token cached in KV, `POST /ai/v1/jobs`, code shipped as injected files from `job-bundle.generated.ts`). JWT exchange and a dry-run create verified live; no real job run yet. GitHub Actions and `dispatch.ts` are gone. |
| Agent (S3) | `step_metrics` for every model call, Ultra reviewer with Super VL fallback (fixture mode answers from code-found clashes, labelled), evidence verifier on every item, totals persisted for the proof page. |
| Tavily and menu (S4) | Search, one batched extract and Lightning triage; 7-day cache; 10 credits a day per workspace; brand-voice crawl; menu read with a verify pass and stored photo. |
| Proof and limits (S5) | `GET /api/proof`, `GET /api/limits`, `docs/FEEDBACK.md`. Wired to the numbers the other streams write; averages are `null` until recorded (contract updated). |

Wiring fixes found in the smoke: item edits dropped `checkedBy` and pass notes; the review pass returned `review_missing` for every store in fixture mode; the
proof ledger read keys nothing wrote (now reads `agent/stats.ts` and the Tavily credit counter); rebuild runs were not in the proof ledger.

Still to do before judging: create the D1, KV and R2 resources and put their ids in `wrangler.jsonc`; `wrangler secret put` for `NEBIUS_SA_CREDENTIALS`,
`LE_JOB_SECRET`, `NEBIUS_API_KEY`, `QLOO_API_KEY`, `TAVILY_API_KEY`; deploy with `--var GIT_SHA:<sha>`; deploy `edge/pages/`; run one real Nebius job and delete it;
run a live (not fixture) build, review and Tavily chain once and record the numbers. See "Remaining gaps" in `docs/BACKEND-SMOKE-2.md`.

---

# Earlier status (after the first integration)

Gate: `npm run typecheck`, `npm run lint`, `npm test` (33 files, 455 tests) and `npm run build` (22 API
routes) all pass. Every route in `docs/CONTRACT.md` was exercised with curl against `next dev` in fixture
mode: see `docs/BACKEND-SMOKE.md`. No live key has been used. The UI under `src/app/(ui)/` does not exist
yet (`src/app/page.tsx` is a placeholder), so nothing here has been seen in a browser.

"Fixture" below means the synthetic stand-ins committed in `fixtures/` and `src/server/*/fixtures`. All of
it is labelled sample data (the routes set `x-le-mode`, `/api/status` reports each provider's mode).

## Features F1-F9

| # | Feature | Works on fixtures | Needs a live key or host | Known gaps |
|---|---|---|---|---|
| F1 | Chain setup | `GET /api/workspace` seeds a per-visitor copy of the sample chain; `PUT /api/chain`; `POST /api/stores`, CSV import (8 rows OK, bad rows and bad lat rejected with a row number), `DELETE /api/stores/:id`; `GET /api/anchors/search` returns Qloo-shaped brand refs | `QLOO_API_KEY` for real brand search. Sample anchor ids are placeholders; `resolveAnchors` swaps them for real Qloo ids on the first live call | CSV re-import skips rows whose name and address already exist (case and spacing ignored); the same name at another address is kept. No UI. |
| F2 | Menu read | `POST /api/menu/read` with the sample board and the phone-photo PNG returns 22-item `MenuItem[]`, `x-le-mode: fixture`. Wrong type, non-image bytes and over 5 MB are rejected (400, 415, 400). `PUT /api/menu` saves | `NEBIUS_API_KEY` and a real VL call. The VL model id, image input shape and JSON output are unverified | Fixture mode returns the same board for any image, so it cannot show a mis-read. |
| F3 | Block profile | `GET /api/stores/:id/profile` returns 12 tags with lift and evidence; each of the 8 stores has a distinct signature | `QLOO_API_KEY`. Day-1 checks still open: `urn:tag` with `signal.location`, whether it is forbidden on our plan (a nearby-places fallback exists), response nesting | Shapes are as documented, never observed. Partner tags such as `book_store` exist only in the fixtures. |
| F4 | Edition agent | `POST /api/editions/build` streams 178 SSE events for 8 stores in about 2 s: every event parses with the `AgentEvent` schema, 4 items per store, every item has evidence, 0 error events. Regenerate works for a partner item | `NEBIUS_API_KEY` for Nemotron tool calling. `TAVILY_API_KEY` for live events. In fixture mode the chat has no tool calls, so every build uses the deterministic plan (`generatedBy.agentModel = "deterministic-plan"`) | The live tool-calling loop has never run. `menu_match` threshold 0.5 is untested (fixture best score 0.24, so it keeps one pair). Regenerating the special gives `no_alternative` in fixtures (one candidate). The event is always "Thu 19:00" in the fixed plan. Spend meter stays 0 in fixture mode. |
| F5 | Copy | Template copy stands in when Lightning is unavailable; guardrail checks run on every field | `NEBIUS_API_KEY`. Lightning model id, its reasoning output and `max_tokens` are unverified; copy quality is unknown | Fixture copy is plain templates ("Try the Banana Bread. It is our Park Slope pick this week."). |
| F6 | Guardrails | Real sidecar and local regex catalogue. A gluten-free/immunity edit is blocked (reasons listed, item `flagged`, approve returns 409 `guardrail_blocked`). Sidecar stopped: a clean edit becomes `unchecked`, a health claim is still blocked locally, and approve-all skips both. `/api/status` shows `up`/`down` | A model key, for the brand-voice self-check (reported as "Skipped check brand voice", never as passed). Fly.io or Cloudflare Containers hosting is untested | Regex rules are not exhaustive. Found and fixed in this pass: "Perfect for young single women in their twenties" passed; the catalogue now covers stacked modifiers and age bands (Python and TS in parity, 4 new phrases). |
| F7 | Portfolio and approvals | `GET /api/editions[?weekOf=]`, `GET /api/editions/:id`, `PATCH` approve, reject, edit (clean edit goes to `edited`; blocked goes to `flagged`; stale `If-Match` 409), `POST approve-all` (approves only `passed` or `rewritten`; edition stays `flagged` while a flagged item remains). A visitor cannot read another workspace's edition or store (404) | Cloudflare KV or D1 driver for hosting (`STORE_DRIVER=kv` ran only against a fake namespace; D1 is planned, not written) | Map and portfolio view are UI work. Rewritten-text replacement on edit needs the sidecar's model rail, so it is untested end to end. |
| F8 | Staff card | `GET /api/editions/:id/card` writes the card on first request (4 guarded lines) and keeps the token; `GET /api/card/:token` is public (no cookie) and returns card, store and chain name; unknown token 404 | Lightning for real copy | A rebuild, regenerate or item edit blanks the card's lines and the public link answers 404 until head office opens the card again (`GET /api/editions/:id/card` rewrites it under the same token). The public link is served only when the edition is `approved` and the card's guardrail status is `passed` or `rewritten`. |
| F9 | Monday edition | `POST /api/jobs/monday` verifies the HMAC (401 on a bad signature, 400 with none), returns a `running` JobRun at once, builds 8 of 8 editions in the background, `GET /api/jobs/latest` then reports `done`. New visitor workspaces are seeded with the built demo editions | Nebius service account and project, `LE_JOB_SECRET`, `APP_URL`, GitHub secrets. The weekly job is started by the Worker's cron Workflow through the Nebius REST API (see "Upgrade integration" below); `jobs/rebuild.py` is the old rebuild script and no longer scheduled; GitHub Actions are not used | The Cloudflare cron and Workflow are built (`worker/`, `src/server/workflows/`) but have not run on Cloudflare. Long builds on Workers need `waitUntil` or a Workflow; untested on workerd. Stopgap for a build killed mid-store (its `finally` never runs): a `drafting` edition older than 5 minutes is flagged when it is read and at the start of every build (`src/server/store/reaper.ts`). The full fix is the Cloudflare Workflow phase (one retried step per store, progress in D1). A build also holds a per-workspace lock (20 min TTL) so two builds cannot interleave. |

## Stretch features C1-C6

| # | Feature | Works on fixtures | Needs a live key | Known gaps |
|---|---|---|---|---|
| C1 | Store feedback | Not built | n/a | No feedback API or storage; not in `CONTRACT.md` |
| C2 | Age-skew line | Not built (the parser knows `urn:demographics` types only) | `QLOO_API_KEY` | No client call, route or contract field |
| C3 | Rising near you | `rising()` (`bias.trends` high vs off, `/v2/trending` labelled global) is used by the agent's `rising` tool | `QLOO_API_KEY` | `/v2/trending` response nesting is guessed. No route of its own; the agent can use it, but no edition item shows it directly |
| C4 | Partner rerank | `partners_rank` tool: Token Factory rerank, falling back to embedding cosine (fixture hashed embeddings). The build shows "ranked 12 places by rerank" | `NEBIUS_API_KEY`. `Qwen/Qwen3-Reranker-8B` may be unavailable on Token Factory; the cosine fallback is tested | The live path through `POST /v1/rerank` is unverified |
| C5 | Taste heat layer | `heatmap.ts` exists in the Qloo module, with `ngeohash` | `QLOO_API_KEY` and heatmap access on our plan | No route, no contract field, not wired to the agent |
| C6 | Compare two stores | `GET /api/compare?a=&b=` returns shared, onlyA and onlyB tags plus evidence (our own tag-lift diff, with Qloo `/v2/analysis/compare` as an evidence layer); missing param 400; strangers 404 | `QLOO_API_KEY` for the compare layer | Qloo compare response nesting is guessed |

## Seams wired in this pass

- Edit re-checks now use `checkCopyDetailed`, so a rewrite from guardrails replaces the field (before, the
  rewritten text was dropped).
- `/api/status` installs the shared Token Factory spend meter if none is set, so the spend it reports is
  the same one the client writes (it previously read a separate empty meter).
- Tavily fixtures now resolve for visitor-workspace store ids (`store_x~suffix`). Before, every visitor
  build had "0 events" because the fixture lookup used the suffixed id; the event tie-in was always empty.
- Already wired and confirmed by the smoke run: `getRepo` and `resolveWorkspace` in the B and C routes,
  `buildEditionsForJob` in the jobs route (`src/server/jobs/wiring-agent.ts`), guardrails `checkCopy`
  in C's copy step and E's edit route, Tavily in the agent's `events_this_week` tool.
- Dependencies: none added. No stream's handback needed a new package.
- `docs/BUILD.md` ownership table now lists `src/server/handlers/` and `src/server/session.ts` under E.

## Open items before keys arrive (Day-1 live tests, architect)

1. Qloo: `urn:tag` with `signal.location` and the plan's tier; `/v2/trending`, compare and heatmap shapes.
2. Token Factory: exact model ids, tool-calling shape on Nemotron, VL image request, `json_schema` support,
   Lightning output and `max_tokens`, whether `Qwen3-Reranker-8B` exists.
3. Tavily: Bearer auth and `published_date` coverage on `topic: general`.
4. Guardrails: the brand-voice self-check prompt against the real Lightning model; hosting.
5. Hosting: KV/D1 store driver on workerd, SSE over 2 minutes with heartbeats, `waitUntil` for jobs,
   OpenNext build (`npm run preview`), which was not run.
6. Contract note for the UI: non-fatal `error` events carry a `storeId` (`item_dropped`, `item_failed`,
   `no_items`, `no_alternative`); show them as per-store notices, not a failed run. `spend_cap` ends the run
   with an `error` and no `run_done`.

## Edition lifecycle rules added after the data-path review (Fix-2)

- Item PATCH needs `If-Match: <item.version>` (428 `version_required`, 400 `invalid_version`, 409 `version_conflict`).
  The HTTP client in `src/lib/api-client.ts` does not send it yet: `patchItem` needs the item's version and the
  header before the UI can approve or edit.
- Approving an `unchecked` item needs `override: true` in the body (409 `guardrail_unchecked` otherwise); flagged or
  blocked copy is never approvable. Approve-all still skips `unchecked`.
- Build body: `{ storeIds?: string[] (max 50), force?: boolean }`. A store with approved or edited items is skipped with an
  `error` event `has_approvals` unless `force`. One build per workspace (409 `build_running`). The extended request
  schemas live in `src/server/handlers/specs.ts` until `src/contract/routes.ts` carries them.
- Every edition write after creation goes through `repo.updateEdition` (locked read-modify-write); items through
  `updateEditionItem` (version-checked). Visitor rows expire after 31 days; the workspace row after 31 days minus an hour.
- New workspaces are seeded from each demo store's newest finished edition, never a `drafting` one.
- Spending routes (build, regenerate, card when it must be written, item edit) are rate limited per workspace and per IP
  through `src/server/limits.ts`; see `src/server/handlers/limit.ts` for the bucket sizes.

## Verify pass (after Fix and Live)

- `npm run typecheck`, `npm run lint`, `npm test` (43 files, 599 tests) and `npm run build` all pass.
- Fix-1 raised the job secret minimum to 32 characters and made `ts` a required signed field. Older stream E tests
  still used short secrets and unsigned bodies, so `tests/e/jobs.test.ts`, `tests/e/interop.test.ts` and
  `tests/e/validation.test.ts` now use 32+ character fake secrets, sign a `ts` (distinct per call, so repeated bodies are
  not replays), and the validation case for `runMondayJob` omits the signature header (400 `invalid_input`).
- `.env.local`, `.recordings/` and `.data/` are gitignored; no secret or recording file is untracked and unignored.
- Not covered: `tests/e/test_rebuild.py` still uses a short secret (its own stub server, not the real handler); the
  `npm run preview` OpenNext build and the live-provider smoke (`docs/LIVE-SMOKE.md`) were not run here.
