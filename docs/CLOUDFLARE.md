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
| Guardrails | Cloudflare Container, instance `basic` (1 GiB), `sleepAfter` 30-60 min, reached only via its Durable Object binding (no public URL) | Build the image `--platform linux/amd64` (this Mac is arm64). Pass NEBIUS_API_KEY from Worker secrets at container start (`this.env` / `startOptions.envVars`), not as a class field. Bake any fastembed model into the image (disk resets after sleep). Warm-up ping before demos. Fallback: Fly.io 1 GB, same `/v1/checks` contract; the TS regex rail always runs first. |
| Weekly job | Workflow `schedules: ["0 0 * * MON"]` (Cloudflare cron weekday `1` is Sunday, so never `* * 1`) -> mint Nebius service-account JWT (RS256 via WebCrypto, PKCS#8 key) -> `POST https://api.nebius.cloud/ai/v1/jobs` (python:3.12-slim, cpu-d3, 2vcpu-8gb, rebuild.py via `injectedFiles`) -> poll `GET /ai/v1/jobs/{id}` -> the job calls `/api/jobs/monday`. | GitHub `workflow_dispatch` -> `nebius ai job run` stays as a coded fallback behind `JOB_TRIGGER=github`. Needs a Nebius AI Cloud project + service account (the owner's account). |
| Secrets | Worker secrets; local `.env.local` via the secret store | Never `.dev.vars` for Next; `next dev` reads `.env*`. |
| Local dev | `next dev` for UI; `opennextjs-cloudflare preview` + `wrangler dev` (Docker/colima running) for SSE, Workflow, cron, container | `getPlatformProxy` simulates KV/D1/R2 but not Workflows or workerd limits. |
| Cost | ~$0-12 for 29 Oct-16 Dec on top of Workers Paid | Assumes the account is on Workers Paid: confirm before deploy. |

Open risks to test first: (1) guardrails image fits 1 GiB and answers `/v1/checks`, cold start
time; (2) Nebius JWT mint + job create from workerd; (3) SSE > 2 minutes with heartbeats on
Workers; (4) bundle size via `wrangler deploy --dry-run`.

Spend: one 8-store run is about $0.09 on Token Factory (pessimistic $0.20). The $1 first-sign-up
trial covers development; the two $25 promo credits may take days to arrive. Serve judges
precomputed editions and rate-limit "regenerate". build.nvidia.com's free Super endpoint is
deprecated: develop and record on Token Factory.
