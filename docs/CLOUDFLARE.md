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
| Guardrails | NO Cloudflare Container (owner, 29 Oct 22:15: Workers Paid quotas only). Live path (a head-office edit, a build in a Workflow): the TS mirror of the NeMo regex catalogue plus a Lightning self-check that uses NeMo's own `self check output` prompt, called directly from the Worker -> status `passed`/`rewritten`/`blocked`. Batch path: the real NeMo Guardrails library (nemoguardrails 0.24.1) runs inside a **Nebius Serverless Job** (`certify` mode) over every item of the week's editions and posts signed results back; items gain `certifiedBy: 'nemo-guardrails@nebius-job'`. **The job is started on demand from a developer's CLI session** (`npx tsx scripts/nebius-job.ts certify eval`, as `nebius --profile hackathon-jobs-sa`), never by the Worker, a cron or a Workflow: the Nebius control plane answers Cloudflare egress with a 522 (30 Oct 02:30 MYT rule, docs/NEBIUS-REST.md). If certification blocks an approved item, it flips to `flagged` and head office sees why. The same job's `eval` mode runs the 40+10 red-team set and publishes catch and false-positive rates. | Python never runs in a Worker; the job is batch only, never on a user's request path, and never on a schedule. |
| Weekly job | Cloudflare cron `0 0 * * MON` (weekday 1 is Sunday on Cloudflare) -> Workflow `WeeklyRebuild` builds every store, one retried step per store, progress in D1, then records a `cron` JobRun whose note says NeMo certification is pending and runs on demand from the CLI. Token Factory and Tavily only: **no Nebius call**. NeMo certify, eval and import are separate on-demand runs: `nebius ai job` via `scripts/nebius-job.ts` (python:3.12-slim, cpu-d3 2vcpu-8gb, about $0.01 a run from the $25 AI Cloud balance). The job reads pending items from `/api/jobs/pending` and posts results to `/api/jobs/results` and `/api/jobs/eval` on https://localedition.pages.dev (HMAC, per-job secret); each appears on the proof ledger as a `manual` JobRun. | Never an always-on Serverless Endpoint, VM or GPU. |
| Secrets | Worker secrets; local `.env.local` via the secret store | Never `.dev.vars` for Next; `next dev` reads `.env*`. |
| Local dev | `next dev` for UI; `opennextjs-cloudflare preview` + `wrangler dev` (Docker/colima running) for SSE, Workflow, cron, container | `getPlatformProxy` simulates KV/D1/R2 but not Workflows or workerd limits. |
| Cost | $0 beyond the $5 Workers Paid plan (Workers, D1, KV, R2, Durable Objects, Workflows, Queues, cron only, within quotas); Nebius job cents per run, only when a developer starts one from the CLI, from the $25 AI Cloud balance | Durable Object holds the shared spend meter and the per-workspace build lock. |

Open risks to test first: (1) guardrails image fits 1 GiB and answers `/v1/checks`, cold start
time; (2) ~~Nebius JWT mint + job create from workerd~~ (answered 30 Oct 02:30 MYT: Cloudflare egress gets a 522 from the Nebius control plane, so jobs start from the CLI); (3) SSE > 2 minutes with heartbeats on
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
3. ~~Nebius jobs start from Cloudflare~~ **SUPERSEDED by the team's 30 Oct 02:30 MYT rule.** Finding: from a deployed Cloudflare Worker,
   the Nebius AI Cloud control plane (`auth.eu.nebius.com`, `auth.nebius.com`, `api.nebius.cloud`, `api.eu-north1.nebius.cloud`) times out with a
   Cloudflare **522** (Nebius appears to drop Cloudflare egress); Token Factory (`api.tokenfactory.nebius.com`) works. So no Worker, cron or Workflow
   calls `POST /ai/v1/jobs` or the IAM token exchange, and `NEBIUS_SA_CREDENTIALS` is never a Worker secret (nothing to `wrangler secret put`). Scheduled
   work is cron -> Workflow calling Token Factory only. Nebius Serverless Jobs (NeMo certify, eval, import) are started on demand from the developer's
   session as `nebius --profile hackathon-jobs-sa` (`scripts/nebius-job.ts`); the job POSTs its results to https://localedition.pages.dev with the
   per-job secret. Unchanged from the original approval: the shared service account `serviceaccount-e04jbjf4y2wmex8crk`, CPU jobs in
   project-e04yk83jbc00bwhyv60mbp (eu-west2), public images (python:3.12-slim) or Nebius Container Registry, never GHCR, jobs named `local-edition-*`,
   no output bucket, deleted after a run (the runner deletes in a `finally`). Default profile stays `hackathons`.
4. GPU batch jobs with NVIDIA models are allowed only after an estimate is sent to the team and tallied.
   Local Edition currently plans NO GPU job (see the cost table in the build map).
5. Cost table: every service, what it draws from, one-month USD; flag anything per-hour or always-on.
