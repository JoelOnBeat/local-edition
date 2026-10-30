# Local Edition: shared contract (source of truth for UI and backend)

Owner: architecture. Implemented in zod at `src/contract/`. Every stream builds against
these types; the UI's mock data is generated from them. Change only via the architect.

## Product in one line
For each store of a chain, a weekly "edition" (special, sound brief, local partner, event night)
built from that block's taste (Qloo), with evidence per item, approved by head office, plus a
one-page staff card. Rebuilt every Monday.

## Domain types (zod, `src/contract/domain.ts`)
- `QlooEntityRef` { entityId: string, name: string, type: string /* urn:entity:… */ }
- `Chain` { id, name, category: 'coffee'|'restaurant'|'gym'|'hotel', brandVoice: string[] (1-3,
  each <= 140 chars), anchors: QlooEntityRef[] (1-3 brands the chain resembles),
  city: { name, lat, lon }, isSample: boolean }
- `Store` { id, chainId, name /* neighbourhood */, addressLabel /* "Bedford Ave & N 7th St" */,
  lat, lon, colorIndex: 1..8 }
- `MenuItem` { id, name, category: 'coffee'|'tea'|'bakery'|'food'|'cold'|'other',
  price: number|null, currency: 'USD', description: string|null, source: 'vl'|'manual' }
- `Evidence` { id, source: 'qloo'|'tavily'|'tokenfactory', endpoint: string /* path only */,
  params: Record<string,string> /* never a key */, summary: string,
  metrics: { affinity?: number, popularity?: number, lift?: number, distanceM?: number,
  relevance?: number }, entityIds: string[], url?: string, fetchedAt: ISO string,
  mode: 'live'|'replay'|'fixture'|'cache' }
- `BlockTag` { tagId, name, kind: 'cuisine'|'flavour'|'ambience'|'music'|'activity'|'other',
  affinity: number, lift: number /* store affinity minus city baseline */ }
- `BlockProfile` { storeId, tags: BlockTag[] (<= 12, by lift desc), evidenceIds: string[], computedAt }
- `GuardrailResult` { status: 'passed'|'rewritten'|'blocked'|'unchecked', rail?: string,
  reasons: string[], original?: string, checkedBy: 'live'|'nemo-guardrails@nebius-job',
  certifiedAt?: ISO string, jobId?: string }  (live = TS mirror + Lightning self-check in the
  Worker; nemo = the NeMo Guardrails library in a Nebius Serverless Job started on demand from the CLI; see CLOUDFLARE.md)
- `EditionItem` = common { id, status: 'draft'|'flagged'|'approved'|'edited'|'rejected',
  evidenceIds: string[] (>= 1, else the item is dropped), guardrail: GuardrailResult,
  version: number } plus one of:
  - `special` { baseMenuItemId, name, description, flavourTags: string[], staffLine }
  - `sound` { brief /* 1-2 sentences */, mood, artists: QlooEntityRef[] (8-15) }
  - `partner` { place: QlooEntityRef & { address: string|null, lat, lon, distanceM },
    reason, offerIdea }
  - `event` { title, day: 'Mon'..'Sun', time /* "19:00" */, description,
    tieIn: { title, url, source: 'tavily' } | null }
- `Edition` { id, storeId, weekOf /* ISO date, a Monday */, issueNo, items: EditionItem[],
  evidence: Evidence[], status: 'drafting'|'draft'|'flagged'|'approved',
  generatedBy: { agentModel, copyModel, runId }, createdAt }
- `StaffCard` { editionId, storeId, token /* share link id */, lines: { heading, body }[],
  guardrail: GuardrailResult }
- `CompareResult` { a: storeId, b: storeId, shared: BlockTag[], onlyA: BlockTag[], onlyB: BlockTag[],
  evidenceIds: string[] }
- `JobRun` { id, trigger: 'cron'|'manual', startedAt, finishedAt: string|null,
  storeIds: string[], status: 'running'|'done'|'failed', nebiusJobId: string|null /* the Nebius job's name; null for the rebuild */, note }
- `ProviderStatus` { qloo: Mode, tokenfactory: Mode, tavily: Mode, guardrails: 'up'|'down'|'local',
  spend: { usd: number, capUsd: number } } where Mode = 'live'|'replay'|'fixture'|'cache'|'missing-key'
- `Workspace` { id, chainId, createdAt } — one per visitor (httpOnly cookie `le_ws`), seeded with a
  copy of the sample chain, so judges never collide.

## Streaming events (`src/contract/events.ts`, Server-Sent Events, `data: <json>\n\n`)
`AgentEvent` discriminated on `type`:
`run_started` {runId, storeIds} · `store_started` {storeId} ·
`tool_call` {storeId, tool, args} · `tool_result` {storeId, tool, ok, summary, evidenceIds} ·
`item_drafted` {storeId, item} · `guardrail` {storeId, itemId, result} ·
`store_done` {storeId, editionId} · `run_done` {runId, editionIds} · `error` {storeId?, code, message}

## API routes (`src/contract/routes.ts`: method, path, request schema, response schema)
All inputs validated with zod. Errors: `{ error: string, code?: string }` with a proper status;
never a raw stack or upstream body.
| Method + path | Request | Response | Stream |
|---|---|---|---|
| GET /api/workspace | — | { workspace, chain, stores, menu, latestEditions } | E |
| PUT /api/chain | Chain fields (name, brandVoice, anchors) | Chain | E |
| POST /api/stores/import | text/csv (name,address,lat,lon) | Store[] | E |
| POST /api/stores | { name, addressLabel, lat, lon } | Store | E |
| DELETE /api/stores/:id | — | { ok } | E |
| POST /api/menu/read | multipart `image` (<= 5 MB jpg/png/webp) | MenuItem[] | A |
| PUT /api/menu | MenuItem[] | MenuItem[] | E |
| GET /api/anchors/search?q= | — | QlooEntityRef[] (brands) | B |
| GET /api/stores/:id/profile | — | { profile, evidence } | B |
| GET /api/compare?a=&b= | — | { result, evidence } | B |
| POST /api/editions/build | { storeIds?: string[] } | SSE AgentEvent | C |
| POST /api/editions/:id/items/:itemId/regenerate | { hint?: string } | SSE AgentEvent | C |
| GET /api/editions?weekOf= | — | Edition[] | E |
| GET /api/editions/:id | — | Edition | E |
| PATCH /api/editions/:id/items/:itemId | { action: 'approve'|'reject'|'edit', patch? } | EditionItem (edit re-runs guardrails) | E |
| POST /api/editions/:id/approve-all | — | Edition | E |
| GET /api/editions/:id/card | — | StaffCard (generated on first request) | C |
| GET /api/card/:token | — | StaffCard + store + chain name (public) | E |
| POST /api/jobs/monday | header `x-le-signature` HMAC-SHA256 of body | JobRun | E |
| GET /api/jobs/latest | — | JobRun | null | E |
| GET /api/status | — | ProviderStatus | E |

## Decisions after the data-path review (architect, 29 Oct)
- PATCH /api/editions/:id/items/:itemId REQUIRES header `If-Match: <item.version>`: 428
  `version_required` when absent, 409 `version_conflict` when stale. The UI always sends it.
- Approving an item whose guardrail status is `unchecked` is refused (409 `guardrail_unchecked`)
  unless the body has `override: true`; `flagged`/blocked items can never be approved.
- POST /api/editions/build accepts `{ storeIds?: string[] (max 50), force?: boolean }`. A store
  whose current-week edition has approved or edited items is skipped with an `error` event
  code `has_approvals` unless `force` is true. One build per workspace at a time (409 `build_running`).
- The public card (GET /api/card/:token) is served only when the edition is `approved` and the
  card guardrail status is `passed` or `rewritten`; otherwise 404.
- Spending routes (menu read, anchors search, build, regenerate, card, item edit) require the
  workspace cookie and are rate limited per workspace and per IP; spend is metered in shared
  storage with reserve-then-settle.
- Length limits: ids <= 64 chars; Chain.name <= 80; MenuItem.name <= 80, description <= 240;
  item patch strings <= 600; arrays get explicit max sizes; bodies over their limit get 413.

- Model roles (deprecation notice, 9 Nov 2026): the agent loop runs on `nvidia/Nemotron-3.5-Super-VL`
  (Nebius's named replacement for nemotron-3-super-120b-a12b); `nvidia/Nemotron-3-Ultra-550b-a55b` is
  the reviewer; Lightning writes copy. Live tests and recordings use these ids only.

## Modes
- `DATA_MODE=mock`: the UI's typed client returns `src/mocks/` data (generated from the contract,
  realistic, 8 NYC stores); no server calls. For UI work before the backend is wired.
- `DATA_MODE=app` (default): real routes. Each provider picks its own mode:
  `QLOO_MODE`, `TF_MODE`, `TAVILY_MODE` = `live` | `replay` | `fixture` (default `replay`,
  falling back to `fixture` when no recording exists). Live needs the key; a missing key reports
  `missing-key` in /api/status and the provider falls back to replay/fixture.
- Recordings live in `.recordings/` (gitignored: Qloo data must never reach the public repo).
  Synthetic fixtures in `fixtures/` are committed and badged "Sample data" in the UI.

## Guarantees every stream keeps
- Every edition item carries >= 1 evidence id; an item without evidence is dropped, never shown.
- All copy (special, event, card) passes guardrails before status `draft`; if guardrails is down
  the item is `unchecked` and can never be auto-approved.
- No health, diet, nutrition or allergen claims anywhere. No identity targeting. Taste only.
- No customer or personal data ever goes to Qloo: only coordinates, entity ids, tag urns.
- Spend cap: `SPEND_CAP_USD` (default 5) enforced in the Token Factory client; beyond it, calls
  fail with code `spend_cap` and the UI says so.

## Upgrade contract (architect, 29 Oct 22:40) — implemented by the upgrade workflow
- `AgentEvent` gains:
  - `step_metrics` {storeId?, role: 'agent'|'vision'|'copy'|'review'|'check'|'embed', model, tool?: string,
    ms, promptTokens, cachedTokens, completionTokens, usd} — emitted for every model call, so the run panel
    shows which Nemotron did what.
  - `review` {storeId, verdict: 'approve'|'needs_change', reason, clashWith: string[] (storeIds), hint: string|null,
    reviewedBy: model id}.
  - `progress` {runId, done, total} — the Workflow's persisted progress, replayed by the SSE route.
- `Edition` gains `review: { verdict, reason, clashWith, hint, reviewedBy, at } | null`.
- `EditionItem` evidence check: `verification: { lift: 'recomputed'|'mismatch', entities: 'found'|'missing' } | null`;
  an item failing either is dropped (as before) and counted for /limits.
- `MenuItem` gains `seen: boolean` and `priceLegible: boolean` from the VL verify pass (amber in the UI when false).
- `Event` tie-in gains `venue: string|null`, `date: string|null`, `triage: { kept: boolean, reason }`.
- New routes:
  | GET /api/proof | — | { jobRuns, eval, scriptSha, gitSha, spendPerEditionUsd, cachedRatio, steps[] (model per step), seenModels[], editionCount, reviews[] } | S5 |
  | GET /api/limits | — | { droppedForEvidence, guardrailBlocks, falsePositiveRate, qlooCoverageGaps[], costPerEditionUsd, tavilyCreditsUsed, tavily {used,cap,dailyUsed,dailyCap}, qloo {…}|null, rateLimits[], visitorBudgets } | S5 |
  | POST /api/editions/review | { weekOf? } | SSE AgentEvent (Ultra review pass over the workspace's editions) | S3 |
  | GET /api/jobs/pending | HMAC header | { items: { editionId, itemId, kind, text, brandVoice }[] } | S2 |
  | POST /api/jobs/results | HMAC header | { results: { editionId, itemId, guardrail: GuardrailResult }[] } -> { updated } | S2 |
  | POST /api/jobs/eval | HMAC header | EvalResult -> { ok } | S2 |
  | POST /api/chain/brand-voice | {} | { lines: string[], sources: Evidence[] } (one Tavily crawl per chain, then Lightning) | S4 |
- `EvalResult` { at, cases: number, caught: number, falsePositives: number, benign: number, catchRate, falsePositiveRate,
  model, jobId, rows: { phrase, expected: 'block'|'pass', got: 'block'|'pass' }[] }.
- `/api/proof`'s `spendPerEditionUsd` and `cachedRatio`, and `/api/limits`'s `costPerEditionUsd`, are `number | null`: null until a build has recorded its model calls and a finished edition.
- `JobRun` gains `mode: 'rebuild'|'certify'|'eval'|'import'` and `scriptSha: string|null`.
- Job runs (30 Oct, 02:30 MYT rule; no schema change, semantics only): the weekly rebuild is `trigger: 'cron'`, `mode: 'rebuild'`, `nebiusJobId: null` and its
  note says NeMo certification is pending and runs on demand from the CLI. A `certify`, `eval` or `import` run is a Nebius job started from the CLI
  (`scripts/nebius-job.ts`), never by the Worker or a schedule: `trigger: 'manual'`, `nebiusJobId` = the Nebius job's name
  (`local-edition-<modes>-<yyyymmddhhmm>`), one row per (mode, job name), so a job that re-posts overwrites its own row. The job sends `trigger` and its name as the
  signed `jobId`; `/api/jobs/results`, `/api/jobs/eval` and `/api/stores/import` write the row, `/api/proof` reads it. The job's secret is the per-job
  `HMAC(LE_JOB_SECRET, job name)` with `x-le-job-id` set to the name (`src/server/jobs/job-auth.ts`).

## Connector routes (Local Edition, 30 Oct)
Specs: `squareRoutes` (src/contract/connectors-square.ts), `commsRoutes` (src/contract/connectors-comms.ts), `connectorApiRoutes` (src/contract/routes-connectors.ts).
Shapes: `Connection`, `SyncEvent`, `Delivery` (src/contract/connectors.ts). Auth: `ws` = the `le_ws` cookie; `signed` = provider signature, no cookie.
| Method + path | Auth | Request | Response |
|---|---|---|---|
| GET /api/connections | ws | — | { connections: Connection[] (square, slack, gmail, outlook, calendar), events: SyncEvent[] newest first, all lanes merged } |
| GET /api/connectors/deliveries?editionId= | ws | — | { deliveries: Delivery[] } (Square, Slack and mail together) |
| GET /api/connectors/square | ws | — | SquareStatus |
| POST /api/connectors/square/connect | ws | { method: 'sandbox'\|'oauth' } | { kind: 'connected', status, result } \| { kind: 'redirect', authorizeUrl } |
| GET /api/connectors/square/callback | oauth state | Square's query | 302 to /app/connections?square=connected\|error |
| POST /api/connectors/square/sync | ws | — | { status, result } |
| DELETE /api/connectors/square | ws | — | { ok } |
| POST /api/connectors/square/webhook | signed (`x-square-hmacsha256-signature`) | Square event | { ok, handled, eventType } |
| GET /api/connectors/square/sales?editionId= | ws | — | { sales: SpecialSales[] } |
| GET /api/connectors/calendar | ws | — | { feeds: CalendarFeed[] } |
| GET /api/calendar/:token(.ics) | token is the capability | — | text/calendar |
| GET /api/connectors/comms | ws | — | CommsState { connections, events, targets, deliveries, notes, suggestions } |
| PUT /api/connectors/comms/targets | ws | { targets: StoreCommsTarget[] } | { targets } |
| PATCH /api/connectors/comms/suggestions/:id | ws | { status: 'applied'\|'dismissed' } | RegenerateSuggestion |
| DELETE /api/connectors/comms/:provider | ws | — | { ok } (slack, gmail, outlook) |
| GET /api/connectors/slack/install | ws | — | 302 to Slack |
| GET /api/connectors/slack/callback | oauth state | Slack's query | 302 to /app/connections?connected=slack |
| POST /api/connectors/slack/interactions | signed (Slack) | form `payload=<json>` | 200 empty within 3 s; the work continues in the background |
| POST /api/connectors/slack/digest | ws | { editionIds? } | { posted, note, deliveries } |
| POST /api/connectors/mail/connect | ws | { provider: 'gmail'\|'outlook' } | { redirectUrl } (Composio consent) |
| GET /api/connectors/mail/callback | oauth state | Composio's query | 302 to /app/connections?connected=gmail\|outlook |
| POST /api/connectors/mail/webhook | signed (Composio) | event | { ok } |
| POST /api/connectors/mail/poll | ws | — | { checked, newReplies } (the edition and connections pages call it every 20 s while visible, until the webhook secret exists) |

Wiring decisions (30 Oct):
- Approving a `special` item publishes it to Square at once (`dispatchSquareItem`, idempotent per item version); approving the last item still runs `dispatchApproved` (Square, Slack card, mail).
- When a build finishes (`run_done`), the Slack head-office digest is posted if Slack is connected: a `digest` Workflow step after `finish` (and a background call in the inline path). It never fails the build.
- A Slack Regenerate click starts an `EditionBuild` Workflow instance with `params.regenerate` when the Workflow is bound (`BUILD_MODE=workflow` or production); inline otherwise.
- The week's Tavily events are prefetched in their own retried `prefetch-events` step before the first store (inline: awaited after `run_started`), so `events_this_week` reads the cache.
- `GET /api/anchors/search` is cache-first (KV, 14 days), allows 3 live Qloo searches per workspace per day on top of the ledger (300 total, 40 a day), and otherwise answers suggested brands with the header `x-le-code: qloo_budget`.
- `/api/proof` and `/api/limits` are public reads: the visitor's workspace if their cookie names one, else the demo workspace; they never create a workspace or set a cookie.
- The client (`ApiClient`) gains `listDeliveries`, `getConnections`, `getComms`, `patchSuggestion`, `pollMail` and `resumeBuild(afterSeq)` (sends `Last-Event-ID`, yields `{ seq, event }` parsed from `id:` lines).

## Accounts and onboarding (Local Edition, 30 Oct)
Specs: `authRoutes` (src/contract/auth.ts). The product is free to use (Qloo's hackathon key forbids production use): nothing here touches payments, plans or pricing. Email + password only; there is no email provider, so no codes and no reset emails.
| Method + path | Auth | Request | Response |
|---|---|---|---|
| POST /api/auth/signup | none | { name, email, password (10-128), chainName, keepWorkspace? } | { user, workspaceId, keptWorkspace } + cookies |
| POST /api/auth/signin | none | { email, password } | { user, workspaceId, keptWorkspace: false } + cookies (rotates the session) |
| POST /api/auth/signout | none | — | { ok } (always; clears both cookies) |
| GET /api/auth/me | none | — | { user \| null, workspace: { id, kind: account\|sample } \| null, canKeepWorkspace } (never creates a workspace) |
| DELETE /api/account | session | { password } | { ok } (deletes the user, sessions, workspace, connections and sealed tokens, sync log, Slack/mail state, photo, stores, editions, onboarding) |
| GET /api/onboarding | ws | — | OnboardingState |
| PUT /api/onboarding | ws | { basics?, skip?, unskip?, current? } | OnboardingState |
- Cookies: `le_sid` (opaque 32-byte token, only its SHA-256 is stored; HttpOnly, SameSite=Lax, Secure over https and always in production; 30 days, refreshed at most daily, 10 sessions per user) and `le_ws` = the account's workspace id (`acct_...`), set on sign-up and sign-in so the connector OAuth callbacks keep working. An `acct_` id in `le_ws` is never trusted without the matching session: a signed-in user always gets their own workspace whatever `le_ws` says; an anonymous request carrying one is treated as an unknown cookie.
- Passwords: PBKDF2-SHA256 through Web Crypto, 16-byte random salt per user, 100,000 iterations (the Workers Web Crypto ceiling; about 12 ms measured), compared in constant time, re-hashed on sign-in when the stored cost is lower. Email is normalised (NFKC, trimmed, lower-case).
- Limits (atomic counters in D1): sign-up 10/hour per network and 3/hour per email; sign-in 30/10 min per network and 10/10 min per email; delete 10/hour per network. A network is an IPv4 address or an IPv6 /64. After 5 wrong passwords for one email (20 from one network) every try is refused, even with the right password, for 30 s doubling per failure up to 15 min (`too_many_attempts`, `Retry-After`). Failures are forgotten after an hour.
- Errors are `{ error, code }`; codes in `AUTH_ERROR_CODES`: invalid_input 400, invalid_credentials 401, unauthenticated 401, bad_origin 403, email_taken 409, not_skippable 400, too_many_attempts 429, rate_limited 429. State-changing auth routes also refuse a request whose `Origin` or `Sec-Fetch-Site` says another site.
- Sample path: "Try the sample chain" still makes an anonymous `ws_...` sample workspace. Signing up with `keepWorkspace: true` copies that workspace (chain renamed, stores, menu, newest editions and cards, new ids) into the account and erases the visitor's copy, connections included. Without it the account starts with an empty chain.
- A new chain has `brandVoice: []`, `anchors: []` (the contract now allows empty; `PUT /api/chain` still takes up to three of each) and the sample city until the owner confirms theirs. `POST /api/editions/build` answers 409 `no_anchors` until one anchor exists.
- Onboarding steps, in order: `basics`, `menu`, `stores`, `voice` (optional), `anchors`, `tools` (optional), `build`. `done` is read from the data (menu has items, a store exists, voice/anchors set, a tool connected, a finished edition exists); the store only remembers skipped optional steps, that the basics were saved, and the current pointer. A step reports `status` done | skipped | todo, `missing[]` in plain words, and `blockedBy[]` (build waits for menu, stores, anchors). Only `voice` and `tools` can be skipped (400 `not_skippable`).
