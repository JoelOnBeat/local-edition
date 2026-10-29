# Local Edition on Cloudflare: decisions (architect, 29 Oct 2026)

Deploy-phase design. Streams build behind interfaces; this is applied in the Cloudflare phase
after integration. Source research (verified at source): scratchpad `research/cf-stack.md`,
summarised here.

| Concern | Decision | Notes |
|---|---|---|
| Web app | Next.js 16.4.x on Workers via `@opennextjs/cloudflare` 1.20.x | Node runtime (never `runtime = "edge"`), `nodejs_compat` + `global_fetch_strictly_public`, compatibility_date >= 2025-05-05, `images.unoptimized: true`. Uploads and SSE are Route Handlers, never Server Actions. Keep pages light (OpenNext #1381). |
| Relational data | D1, one DB, `workspace_id` on every table | Editions, stores, menu, approvals, cards, job runs. Seed copy per judge workspace with one `db.batch` on first visit. Add `src/server/store/d1.ts` behind the repo interface; `STORE_DRIVER=d1`. |
| Qloo / provider cache | KV with TTL | Key = hash of path + sorted params (never the key). Private by binding. |
| Menu photos | R2, key `ws/<id>/<uuid>.<ext>` | Read back in the Worker and base64 it into the VL call. |
| Long builds | Cloudflare Workflow in a second Worker `local-edition-ops` | One retried step per store; progress written to D1; the SSE route replays progress from D1 so a disconnect loses nothing. Next worker calls it through a service binding. |
| SSE | Send `: open` immediately, heartbeat every 15 s | OpenNext #1468: a stream that errors before its first chunk hangs. `request.signal` abort is unreliable (#691). Headers: text/event-stream, no-cache, no-transform, X-Accel-Buffering: no. Max 6 simultaneous outbound connections waiting for headers per invocation, so stream LLM calls or fan out via Workflow steps. |
| Guardrails | NO Cloudflare Container (owner, 29 Oct 22:15: Workers Paid quotas only). Live path (a head-office edit, a build in a Workflow): the TS mirror of the NeMo regex catalogue plus a Lightning self-check that uses NeMo's own `self check output` prompt, called directly from the Worker -> status `passed`/`rewritten`/`blocked`. Batch path: the real NeMo Guardrails library (nemoguardrails 0.24.1) runs inside a **Nebius Serverless Job** (`certify` mode) over every item of the week's editions and posts signed results back; items gain `certifiedBy: 'nemo-guardrails@nebius-job'`. If certification blocks an approved item, it flips to `flagged` and head office sees why. The same job's `eval` mode runs the 40+10 red-team set and publishes catch and false-positive rates. | Python never runs in a Worker; the job is batch only, never on a user's request path. |
| Weekly job | Cloudflare cron `0 0 * * MON` (weekday 1 is Sunday on Cloudflare) -> Workflow `WeeklyRebuild` builds every store, one retried step per store, progress in D1 -> last step starts the Nebius Serverless Job (`certify` mode, then `eval` weekly) via GitHub `workflow_dispatch` -> `nebius ai job run jobs/certify.py` (python:3.12-slim, cpu-d3 2vcpu-8gb, about $0.01 a run from the $25 AI Cloud balance). The job reads pending items from `/api/jobs/pending` and posts results to `/api/jobs/results` (HMAC). Direct Worker -> Nebius REST job creation is the later upgrade. | Never an always-on Serverless Endpoint, VM or GPU. |
| Secrets | Worker secrets; local `.env.local` via the secret store | Never `.dev.vars` for Next; `next dev` reads `.env*`. |
| Local dev | `next dev` for UI; `opennextjs-cloudflare preview` + `wrangler dev` (Docker/colima running) for SSE, Workflow, cron, container | `getPlatformProxy` simulates KV/D1/R2 but not Workflows or workerd limits. |
| Cost | $0 beyond the $5 Workers Paid plan (Workers, D1, KV, R2, Durable Objects, Workflows, Queues, cron only, within quotas); Nebius job cents per run from the $25 AI Cloud balance | Durable Object holds the shared spend meter and the per-workspace build lock. |

Open risks to test first: (1) guardrails image fits 1 GiB and answers `/v1/checks`, cold start
time; (2) Nebius JWT mint + job create from workerd; (3) SSE > 2 minutes with heartbeats on
Workers; (4) bundle size via `wrangler deploy --dry-run`.

Shared limits (checked live 29 Oct 21:55): Token Factory 1,000 requests/min and 2M
tokens/min, shared. Tavily: ONE free key, 1,000 credits/month, shared for development and for judges until 15 Dec. Local Edition's Tavily budget: at most
~80 credits through 15 Dec. Rules: every Tavily result is cached server-side (KV, key = hash of the
normalised query + time_range; 7-day TTL); Tavily is called only by a build (the Monday job, a
head-office "build", or setup), never on page load and never by regenerate (it reuses the week's
cached events); one search per store per week plus one batched extract of at most 1 URL per store;
brand-voice crawl at most once per chain and address (a failed crawl is remembered for 24 hours); ONE global ledger
(TavilyBudgetDO; the repo cache with a best-effort lock where it is not bound): a hard total of 80 credits through 15 Dec and a daily slice of
6, reserved before every live call and read by `/api/limits`; live search only for the demo workspace's unmodified sample stores and chain setup, everything
else cache-only with code `tavily_budget` and the clear "using this week's saved events" fallback; tests use recordings only.

Per-visitor limits (Fix-A, 29 Oct): Token Factory spend is admitted per request against a $0.40 workspace sub-budget, a $0.80 per-network daily cap and a
$1.50 floor of the $5 cap that visitors cannot use (`src/server/spend-budget.ts`); IPv6 clients are limited by their /64; the app creates at most 60 new
workspaces an hour. All of these read the client address from `cf-connecting-ip`, so that header MUST survive the Pages-to-Worker service-binding hop:
`edge/pages/public/_worker.js` sets it again on the forwarded request (pinned by `tests/fix-a/pages-worker.test.ts`). Verify it once against the deployed
hop before judging: if it is lost, every visitor shares the "unknown" bucket and onboarding answers 429 to everyone after ten workspaces.

Spend: one 8-store run is about $0.09 on Token Factory (pessimistic $0.20). The $1 first-sign-up
trial covers development; the two $25 promo credits may take days to arrive. Serve judges
precomputed editions and rate-limit "regenerate". build.nvidia.com's free Super endpoint is
deprecated: develop and record on Token Factory.

## Nebius job spike (architect, 29 Oct 22:23 MYT, job local-edition-spike-1, deleted after)
`nebius ai job run spike.py --name local-edition-<purpose> --platform cpu-d3 --preset 2vcpu-8gb
--disk-size 20Gi --timeout 1h --no-output` with `requirements.txt: nemoguardrails==0.24.1`:
COMPLETED in 253 s wall (PROVISIONING -> STARTING -> IMAGE_PULLING -> RUNNING -> COMPLETED; pip
install included), script 0.7 s. VM: x86_64, Python 3.12.16. nemoguardrails 0.24.1 imports.
Outbound HTTPS works (Token Factory 401 unauthenticated in 54 ms, public web 200). Cost about
$0.005. Rules: the CLI profile acts as the account owner; name every job
`local-edition-*`; always `--no-output` (otherwise it creates a managed bucket); `--timeout` minimum
is 1h (billing is per second while running); delete finished test jobs; never endpoints/VMs.
CI service account for GitHub Actions is pending the owner's OK: until then jobs start from the CLI.

## Approved decisions, 29 Oct 23:00 — these override anything above
1. Public address: the product Worker deploys with `workers_dev = false`. A Cloudflare Pages project
   named **localedition** fronts it: `public/_worker.js` = `export default { fetch: (req, env) => env.APP.fetch(req) }`,
   its wrangler.toml has `pages_build_output_dir` and `[[services]] binding = "APP", service = "local-edition"`.
   Judge URL: **https://localedition.pages.dev**.
2. GitHub is for the repository only: NO GitHub Actions, Packages/GHCR or Pages. Delete `.github/workflows/`.
3. Nebius jobs start from Cloudflare: the cron's Workflow step calls `POST https://api.nebius.cloud/ai/v1/jobs`
   with an IAM token for the shared service account `serviceaccount-e04jbjf4y2wmex8crk`: sign an RS256 JWT with
   WebCrypto (`kid` = key id, `iss` = `sub` = service account id, `exp` <= 5 min), exchange it, cache the 12 h
   token in KV. Credentials only via `wrangler secret put NEBIUS_SA_CREDENTIALS < ~/.nebius/hackathon-jobs-sa.json`
   (never print, log, copy to .dev.vars or commit). CPU jobs in project-e04yk83jbc00bwhyv60mbp (eu-west2).
   Test as the SA with `nebius --profile hackathon-jobs-sa`; default profile stays `hackathons`. Images: public
   (python:3.12-slim) or Nebius Container Registry, never GHCR. Jobs are named `local-edition-*`, use no
   output bucket, and are deleted after a test.
4. GPU batch jobs with NVIDIA models are allowed only after an estimate is sent to the team and tallied.
   Local Edition currently plans NO GPU job (see the cost table in the build map).
5. Cost table: every service, what it draws from, one-month USD; flag anything per-hour or always-on.
