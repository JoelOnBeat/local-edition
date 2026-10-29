# Nebius REST client for Local Edition (worker: Nebius client, 29 Oct 2026)

Code: `src/server/nebius/`. Web APIs only (`fetch`, `crypto.subtle`, `TextEncoder`, `atob`/`btoa`), so it runs in workerd.
Replaces the GitHub `workflow_dispatch` plan (approvals 2 and 3, 29 Oct 23:00): the Worker's cron Workflow step starts the
weekly Nebius job itself.

## What is verified, and what is not

| Item | Status |
|---|---|
| Request and response field names | From the public OpenAPI (`https://api.nebius.cloud/openapi.json`, fetched 29 Oct) and the Serverless AI jobs docs |
| Create-job spec, with `dryRun: true`, as `serviceaccount-e04jbjf4y2wmex8crk` (token from `nebius --profile hackathon-jobs-sa iam get-access-token`) | **Verified live**: accepted (15 injected files, secrets as files and as env, labels, `cpu-d3` / `2vcpu-8gb`, 20 GiB disk). Nothing was created or billed |
| List, get-by-id (404), invalid preset (400), unknown platform (400), bogus token (401) | **Verified live**; each maps to the documented code |
| `run.sh` (secret export, mode loop, exit status) | Simulated locally with stub `pip` and `python` |
| JWT signing + token exchange | Unit-tested (generated RSA key; the JWT verifies; PKCS#1 and PKCS#8) and the wire format matches the docs. **Not exercised live**: the credentials file was never read at build time. First live proof is `createNebiusRest(...).tokens.getToken()` from the Worker or a local script run by the architect |
| A real job run (create, poll, delete) through `jobs.create/get/delete` | **Verified live, 29 Oct 2026** (CLI-issued token for `hackathon-jobs-sa`; see "Live REST proof"). `run.sh` + injected files and the 253 s pip install were proven by the CLI spike, not by this check |

## Live REST proof (29 Oct 2026, `src/server/nebius/live-check.ts`)

Run: `NEBIUS_LIVE_TOKEN="$(nebius --profile hackathon-jobs-sa iam get-access-token)" npx tsx src/server/nebius/live-check.ts`.
The token comes from the CLI profile, so the private key file was not read; it is passed to `createJobsClient` through a stub `TokenProvider` and never printed.
The script creates the job, polls `GET` every 5 s until terminal, then deletes it (in a `finally`).

Request body that worked (`POST https://api.nebius.cloud/ai/v1/jobs`):

```json
{"metadata":{"parentId":"project-e04yk83jbc00bwhyv60mbp","name":"local-edition-rest-check-20261029150128","labels":{"app":"local-edition","purpose":"rest-check"}},
 "spec":{"image":"python:3.12-slim","containerCommand":"python","args":"-c \"print('local-edition rest ok')\"","platform":"cpu-d3","preset":"2vcpu-8gb",
         "disk":{"type":"NETWORK_SSD","sizeBytes":"21474836480"},"timeout":"3600s","restartAttempts":"0"}}
```

Result: create returned an Operation with `resourceId` = job id (`aijob-e04fr0cwjbdxcgwmpb`) in 7 s. States seen (seconds from the start of the script):
`PROVISIONING@8 -> STARTING@52 -> IMAGE_PULLING@176 -> COMPLETED@193`, `RUNNING` and `COMPLETING` were not seen (the 5 s poll interval is longer than a one-line script runs). Wall time 196 s including delete request.
`stateDetails` empty. Not verified: the container's stdout (the job was deleted before logs were read), so `COMPLETED` (exit 0) is the evidence the quoted `args` string ran.
`args` is one string that Nebius appears to split shell-style (a quoted segment survived as one argument).

Delete: `DELETE /ai/v1/jobs/{id}` returned an Operation at once, but the record stayed listed in state `DELETING` for about 2 to 3 minutes before
`nebius --profile hackathon-jobs-sa ai job list --parent-id project-e04yk83jbc00bwhyv60mbp` returned an empty list (verified; `get` then fails). Deletion is asynchronous:
do not expect the list to be clean right after `jobs.delete`, and treat `DELETING` as terminal for cleanup purposes. Cost: about 20 s of billed run time, under $0.001.

### Testing the JWT token exchange after `wrangler secret put`

It cannot be tested without the private key, and it is not tested with the file. After `wrangler secret put NEBIUS_SA_CREDENTIALS < ~/.nebius/hackathon-jobs-sa.json`
the first proof runs inside the deployed Worker, where only the secret binding reads the key. Plan:
1. Add a Worker-internal check (a cron-only code path or an admin route protected by `LE_JOB_SECRET`, not public) that calls
   `createNebiusRest({ credentialsJson: env.NEBIUS_SA_CREDENTIALS, cache: kvTokenCache(env.CACHE) }).tokens.getToken({ forceRefresh: true })`
   and returns only `{ ok: true, cached: <bool>, length: token.length }` (never the token), then `jobs.list(project)` with it.
2. A 200 from `jobs.list` proves the exchange produced a token Nebius accepts; a `nebius_auth` code means the exchange was refused (check the key's `kid`, `iss`, `sub`, clock).
3. Run once more and confirm `cached: true` (KV hit). Then the first cron creates the real job.
Locally, `wrangler dev --remote` with the secret set gives the same proof without a deploy. The JWT format itself is covered by 82 unit tests (a generated RSA key, signature verified).

## Auth flow

1. Secret `NEBIUS_SA_CREDENTIALS` holds the whole service-account file: `{"subject-credentials": {type, alg, private-key, kid, iss, sub}}`
   (key names only were inspected). Load with
   `wrangler secret put NEBIUS_SA_CREDENTIALS < ~/.nebius/hackathon-jobs-sa.json`. Never `.dev.vars`, never logged.
   `parseCredentials` (zod) names a bad field in its error, never a value.
2. `signJwt` (`jwt.ts`): RS256 via `crypto.subtle`. Header `{alg:"RS256", typ:"JWT", kid}`; claims
   `{iss: <sa id>, sub: <sa id>, iat, exp}`. Nebius needs no `aud`. `exp - iat` is 240 s by default and clamped to 300 s.
   `private-key` may be PKCS#8 (`BEGIN PRIVATE KEY`) or PKCS#1 (`BEGIN RSA PRIVATE KEY`, wrapped to PKCS#8 in pure TS, byte-identical to OpenSSL's output in a test); a PEM with literal `\n` also works.
3. `createTokenProvider` (`token.ts`): `POST https://auth.eu.nebius.com:443/oauth2/token/exchange`,
   `Content-Type: application/x-www-form-urlencoded`, fields `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`,
   `requested_token_type=urn:ietf:params:oauth:token-type:access_token`, `subject_token=<JWT>`,
   `subject_token_type=urn:ietf:params:oauth:token-type:jwt`. Response `{access_token, issued_token_type, token_type, expires_in: 43200}`.
4. Cache: injected `TokenCache { get(key), put(key, value, ttlSeconds) }`, key `nebius:iam-token:<sa id>`, TTL **11.5 h**
   (`min(41400, expires_in - 1800)`). Per-isolate memo trusts a cache hit for 5 minutes; concurrent callers share one
   exchange; `getToken({ forceRefresh: true })` replaces the cached token. A broken cache degrades to "mint every time", it never throws.
   In the Worker use `kvTokenCache(env.CACHE)` (KV minimum TTL of 60 s is enforced). The token is the only thing stored in KV. It is not a key, but it is a bearer
   credential for 12 h: keep the KV namespace private (no public binding) and never put it in a response.
5. The jobs client sends `Authorization: Bearer <token>`. A 401 refreshes the token once and retries.

## Endpoints used (base `https://api.nebius.cloud`)

| Call (client method) | Request | Response |
|---|---|---|
| Create (`jobs.create`) | `POST /ai/v1/jobs`, body `CreateJobRequest {metadata:{parentId,name,labels}, spec: JobSpec, dryRun?}` | `Operation`; **job id = `resourceId`**. `status` is set once finished: non-zero `status.code` is mapped to an error |
| Validate (`jobs.validate`) | same, `dryRun: true` | `Operation {id:"dry-run"}`; nothing created |
| Get (`jobs.get`) | `GET /ai/v1/jobs/{id}` (`?view=SECRET` returns injected file content: never used) | `Job {metadata{id,name,parentId,createdAt,labels}, spec, status{state, stateDetails{code,message}, startedAt, finishedAt}}` |
| Get by name (`jobs.getByName`) | `GET /ai/v1/jobs/get-by-name?parentId=&name=` | `Job` |
| List (`jobs.list`, `listAll`) | `GET /ai/v1/jobs?parentId=&pageSize=&pageToken=` | `{items: Job[], nextPageToken}` |
| Cancel (`jobs.cancel`) | `POST /ai/v1/jobs/cancel` body `{id}` | `Operation`. Stops the VM, deletes its disk, keeps the record |
| Delete (`jobs.delete`) | `DELETE /ai/v1/jobs/{id}` | `Operation`. Cancels first if running |

`JobSpec` fields we send: `image`, `containerCommand`, `args` (one string), `environmentVariables[{name,value}]`, `workingDir`,
`timeout` (`"3600s"`), `restartAttempts` (`"0"`), `platform`, `preset`, `disk {type:"NETWORK_SSD", sizeBytes:"21474836480"}`
(int64 as string), `injectedFiles[{containerPath, content: base64}]` (1 byte to 64 KiB each). Unused but available:
`registryCredentials`, `subnetId`, `publicIp`, `preemptible`, `pricingModel`, `volumes`, `ports`.
`JobStatus.State`: `PROVISIONING, STARTING, IMAGE_PULLING, RUNNING, COMPLETING, COMPLETED, CANCELLING, CANCELLED, DELETING, FAILED, ERROR`.
Terminal: `COMPLETED, FAILED, CANCELLED, ERROR` (`isTerminalState`). No `outputs`/bucket is ever set.

Retries: GET retries twice on 5xx or network errors (300 ms, 600 ms). **Create, cancel and delete are never retried by the client**.

## The Local Edition job (`buildLocalEditionJob`, `job-spec.ts`)

Pure function, no I/O. Name `local-edition-<modes joined by ->-<yyyymmddhhmm UTC>` (one mode: `local-edition-certify-202611020007`;
`certify` then `eval` in one job: `local-edition-certify-eval-202611020007`), parent `project-e04yk83jbc00bwhyv60mbp` (eu-west2), image
`python:3.12-slim`, `cpu-d3` / `2vcpu-8gb`, 20 GiB disk, `3600s` timeout (the platform minimum; billing is per second while running),
`restartAttempts: "0"`, labels `app=local-edition`, `modes=...`. Env: `APP_URL`, `TRIGGER` (`cron` default), `JOB_NAME`
(certify.py records it as the job id), `PIP_ROOT_USER_ACTION`, `PYTHONUNBUFFERED`, plus any `env` you pass (import mode: `IMPORT_CSV_URL`).

**How the code ships without a custom image: `spec.injectedFiles`.** The OpenAPI also offers volumes (needs a bucket or filesystem,
which we must not create) and private registries; injected files need neither and the files are tiny. The Worker injects, under `/opt/le`:

| File | Source |
|---|---|
| `run.sh` | `RUN_SH` in `job-spec.ts` |
| `certify.py`, `le_http.py`, `requirements.txt` | `jobs/` |
| `rails/*.py`, `rails/*.yml`, `rails/rails.co`, `rails/phrases.json` | `guardrails/localedition/`, `guardrails/tests/phrases.json` (certify.py looks in `./rails`) |

The architect's `scripts/gen-job-bundle.mjs` generates these as strings (`JOB_BUNDLE`, path relative to `/opt/le`) into
`src/server/jobs/job-bundle.generated.ts`; pass it as `bundle`. About 45 KB in total; the largest file is under 10 KB.
The container runs `bash /opt/le/run.sh certify eval`: `run.sh` exports secrets, `pip install -r requirements.txt` (nemoguardrails 0.24.1,
most of the 253 s spike), then runs `python certify.py --mode <m>` for each mode (every mode runs even if an earlier one failed;
the job exits non-zero if any did). Running both modes in one job pays the pip install once.

**Secrets.** Injected-file content is returned only by `GET ...?view=SECRET`, while `environmentVariables` values are plain spec fields. So by
default `LE_JOB_SECRET` (and `NEBIUS_API_KEY` for Lightning, which `certify` and `eval` need) are injected as files under
`/opt/le-secrets/<NAME>` and exported by `run.sh`. `secretDelivery: "env"` puts them in `environmentVariables` instead. A MysteryBox secret
(`environmentVariables[].mysteryboxSecret`) is the stronger option but needs a MysteryBox secret created first: not done.
The create request body carries the secrets: the client never logs bodies.

## Error mapping

`NebiusError { code, status?, retryable, nebiusCode? }`; `.toErrorBody()` gives `{ error, code }`. Messages never contain a token, JWT, key or
the raw upstream body (200-character sanitised excerpt of Nebius's `message`).

| `code` | When | Retry |
|---|---|---|
| `nebius_auth` | Missing or malformed `NEBIUS_SA_CREDENTIALS`; unusable private key; token exchange refused (any 4xx but 429); API 401/403 (gRPC 16, 7) | No |
| `nebius_quota` | HTTP 429, gRPC 8, `ServiceError.notEnoughResources`, or a 400/412 whose message says quota or capacity | Later |
| `nebius_unavailable` | Network error, timeout (20 s API, 10 s exchange), 5xx, gRPC 13/14, non-JSON or wrongly shaped success body | Yes |
| `nebius_bad_request` | 400 not about quota (bad preset, unknown platform, validation errors), or `buildLocalEditionJob` input validation | No |
| `nebius_not_found` | 404 / gRPC 5 | No |
| `nebius_conflict` | 409 / gRPC 6: a job with that name exists | No |

The last three are additions to the three codes asked for. Observed: unknown platform in a project is a 400 `nebius_bad_request`, not quota.

Not routed through `src/server/http/fetchJson`: its record/replay layer keys and stores request bodies, and the token exchange body is a
signed JWT. The client takes a `fetchImpl` seam instead and never records.

## How the cron Workflow should call it

```ts
import { buildLocalEditionJob, createNebiusRest, isNebiusError, kvTokenCache, summarizeJob } from "@/server/nebius";
import { JOB_BUNDLE } from "@/server/jobs/job-bundle.generated";

// inside the last Workflow step of WeeklyRebuild (env = Worker env; CACHE = the existing private KV namespace)
const { jobs } = createNebiusRest({ credentialsJson: env.NEBIUS_SA_CREDENTIALS, cache: kvTokenCache(env.CACHE) });
const built = buildLocalEditionJob({
  modes: ["certify", "eval"],            // eval weekly too; use ["certify"] for an ad hoc rerun
  appUrl: env.APP_URL,                   // https://localedition.pages.dev
  jobSecret: env.LE_JOB_SECRET,
  secrets: { NEBIUS_API_KEY: env.NEBIUS_API_KEY },
  bundle: JOB_BUNDLE,
  trigger: "cron",
  now: new Date(event.timestamp),        // FIXED per Workflow instance: see idempotency below
});
try {
  const { jobId } = await jobs.create(built.request);
  return { jobId, name: built.name };
} catch (e) {
  if (isNebiusError(e) && e.code === "nebius_conflict") {          // an earlier attempt of this step already created it
    return { jobId: (await jobs.getByName(built.request.metadata.parentId, built.name)).metadata.id, name: built.name };
  }
  throw e;                                                          // Workflow retry policy handles nebius_unavailable and nebius_quota
}
```

Rules for the Workflow step:
- **Idempotency.** The client does not retry create. A Workflow step retry after a lost response would start a second job unless the name is
  stable: derive `now` from the Workflow instance (`event.timestamp`), never `new Date()` inside the step. A retry then gets `nebius_conflict` and
  falls back to `getByName`. Also check `getByName` first if the step may be replayed after a deploy.
- **Retry policy.** Retry `nebius_unavailable` and `nebius_quota` (`err.retryable`); fail the step on `nebius_auth` and `nebius_bad_request` and surface `err.toErrorBody()` in the JobRun.
- **Do not wait in the Workflow.** The job reports back by signed POSTs to `/api/jobs/results` and `/api/jobs/eval`. Store `{jobId, name}` on the JobRun.
  If a later status view is wanted, `summarizeJob(await jobs.get(jobId))` gives `{state, terminal, startedAt, finishedAt, detail}`.
- **Watchdog (recommended).** One later step, or the next cron tick: `jobs.listAll(project)`, and for any `local-edition-*` job still non-terminal after
  about 30 minutes call `jobs.cancel(id)` (a stuck job bills per second until the 3600 s timeout). Delete terminal jobs older than a week with `jobs.delete(id)` to keep the project list clean.
- **Secrets hygiene.** Never log `built.request` (it contains the secrets). Log `built.name`, `jobId` and `err.code` only.
- **Test before the first cron.** From a local script run by the architect: `createNebiusRest(...).jobs.validate(built.request)` (a dry run, free), then one real
  create, wait for `COMPLETED`, then `jobs.delete(jobId)`. Jobs are `local-edition-*`, no output bucket, deleted after a test.

## Limits and costs

- Service account `serviceaccount-e04jbjf4y2wmex8crk` is editor on `project-e04yk83jbc00bwhyv60mbp` (eu-west2, CPU jobs) and
  `project-e00fwfe5pr00k4s8jdngz0` (eu-north1, H100 GPU jobs, quota 16) and nothing else. `buildLocalEditionJob` takes `parentId`; no GPU job is planned for Local Edition (approval 4).
- Cost per run: about 4 to 5 minutes of `cpu-d3` 2vcpu-8gb, about $0.005 to $0.01 from the $25 AI Cloud balance (spike: about $0.005 for 253 s). Weekly `certify` + `eval` in one job is about the same, since the pip install dominates.
- The job never runs on a user request path; nothing here starts an endpoint, VM or GPU.
- Credentials file expires 31 Dec; the service account key rotation is the owner's, and after it only the secret needs re-uploading.

## Tests

`npx vitest run src/server/nebius` (82 tests): JWT verification with a generated key (PKCS#8 and PKCS#1), token exchange form and endpoint, cache hit,
TTL, expiry, force refresh, concurrency and cache failure, request shapes for create, validate, get, get-by-name, list (paging), cancel, delete,
401 refresh-and-retry, GET retries, the full status-to-code table, the job spec (names, sizes, secrets-as-files, validation, 64 KiB limit in bytes).
