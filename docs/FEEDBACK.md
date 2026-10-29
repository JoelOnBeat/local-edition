# Feedback for Nebius Token Factory, Nebius AI Cloud and NVIDIA tools

For the Devpost feedback field. Written 29 Oct 2026 (MYT) while building Local Edition. Every item comes from something
we ran or read: the live smoke in `docs/LIVE-SMOKE.md` (reproduce with `SPEND_CAP_USD=1 npx tsx scripts/smoke-live.ts all`;
raw responses sit in `.recordings/`, which is not published) or the doc page named in the item. We did not capture response
request ids on the smoke run, so each item gives the doc URL, the exact error text and the date instead. Each ends with one
concrete suggestion. We liked a lot too: the OpenAI-compatible surface parsed every response with no changes, the menu-photo
read on Nemotron 3.5 Super VL got 22 of 22 items, names and prices exact, and the whole smoke cost about $0.12.

## 1. The 9 Nov removal of Nemotron 3 Super and Nano lands before judging

- **What we saw.** The deprecation page says `nvidia/nemotron-3-super-120b-a12b` and `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`
  leave Token Factory Serverless on Mon 9 Nov 2026, with no automatic reroute. Judging runs 2 Dec to 16 Dec 2026, and the
  hackathon's own Best Apps text points builders at Nemotron 3 Super and Nano.
  Source: https://docs.tokenfactory.nebius.com/model-deprecations-november-2026.md
- **Why it matters.** A project submitted on the old ids is built, recorded and submitted before 31 Oct, then fails with a model
  error while judges use it. Teams that read the page in time re-record; teams that did not lose their demo.
- **Suggestion.** Keep the two ids routable until judging ends, or alias them to the named replacements
  (`nvidia/Nemotron-3.5-Super-VL`, `nvidia/Nemotron-3_5-Lightning`) for the hackathon project, and put the date on the
  hackathon's resources page and in the rules, not only in the docs.

## 2. `/v1/rerank` exists, but no reranker model is listed

- **What we saw.** On 29 Oct 2026, `POST /v1/rerank` with `Qwen/Qwen3-Reranker-8B` returned `404` with code `model_not_found`.
  `GET /v1/models` lists 29 models and none of them is a reranker. Embeddings work: `Qwen/Qwen3-Embedding-8B`, 4096 dimensions.
  Source: `docs/LIVE-SMOKE.md` section 2, check `rerank`.
- **Why it matters.** The endpoint, the pricing story and the retrieval examples all imply a reranker, so we built the call, then
  found out at runtime. We now fall back to embedding cosine and remember the 404 for ten minutes so each ranking does not pay
  for a failed round trip.
- **Suggestion.** Either list a reranker (the Qwen3 reranker or an NVIDIA one) or say on the rerank docs page which account tiers
  or models serve it, and put `rerank` as a capability filter in the model catalogue so `/v1/models` shows it.

## 3. Reasoning controls: some documented switches work, others are silently ignored

- **What we saw (29 Oct 2026, Lightning, Super VL and Super 120B).**
  - Accepted and effective: `reasoning_effort: "none"` and `chat_template_kwargs: { enable_thinking: false }`.
    A one-word reply drops from 96 completion tokens (93 reasoning) to 2 (0) on Lightning.
  - Accepted but with little or no effect: `reasoning_effort: "low"` (Lightning 95 reasoning tokens against 93; Super VL 314
    against 341) and `chat_template_kwargs: { low_effort: true }` (Lightning). Both worked on Super 120B: 33 reasoning tokens
    down to 8.
  - Ignored with no error: `reasoning_budget: 0`, `reasoning: { enabled: false }`, a `/no_think` system line.
  - With thinking on, a 20-word copy request on Lightning spends 600+ tokens, ends with `finish_reason: "length"` and the
    thinking text lands in `content`, not in `reasoning_content`.
  Source: `docs/LIVE-SMOKE.md` section 1 (table).
- **Why it matters.** Thinking tokens are billed as output, and an unfinished thought in `content` is shown to a customer if
  the caller does not strip it. A control that is ignored without an error looks like it works.
- **Suggestion.** Document one supported switch per model on its catalogue card, return `400` (or a warning header) for a
  reasoning field the model does not honour, and always put thinking in `reasoning_content`, never in `content`.

## 4. `529 System is overloaded` bursts on Nemotron 3.5 Super VL

- **What we saw.** On 29 Oct 2026, the first probe of `nvidia/Nemotron-3.5-Super-VL` got `529 System is overloaded` three times
  in a row and took about 30 s for a tiny call. Later the same afternoon calls took 0.6 to 1 s. Our client retries 5xx with
  backoff, so the agent still finished, but a judge hitting the slow window would wait.
  Source: `docs/LIVE-SMOKE.md` section 4, item 7.
- **Why it matters.** The agent loop makes about 5 Super VL calls per store, so one slow window multiplies across a build.
  A team that does not retry 5xx would show the error to its users.
- **Suggestion.** Document `529` on the API errors page with a recommended backoff, send `Retry-After` when the load is
  transient, and show per-model capacity or a status indicator for launch-week models.

## 5. No TypeScript SDK for Sandboxes

- **What we saw.** Token Factory Sandboxes ships a Python SDK (0.3.6), a CLI (`contree-cli` 0.9.4) and an MCP server. From
  TypeScript the only route is raw REST, and the SSE event stream and subprocess endpoints are REST-only. Access is Beta, by
  request, and needs a per-project activation.
  Sources: https://docs.tokenfactory.nebius.com/sandboxes/start/choose-an-interface.md and
  https://docs.tokenfactory.nebius.com/sandboxes/start/set-up-access.md
- **Why it matters.** Our app is TypeScript on Cloudflare Workers, where a Python SDK cannot run. We hand-wrote the request
  shapes and could not verify them before access arrived, so we kept the Sandbox step optional.
- **Suggestion.** Publish an OpenAPI file for `/sandboxes/v1` (so any language can generate a client) and a small fetch-only
  TypeScript client that works on Workers. Say in the hackathon resources how to get Sandboxes access before the build window.

## 6. No Nemotron model in the post-training base list

- **What we saw.** The fine-tuning base models are DeepSeek, Gemma 4, gpt-oss, Qwen and Llama. No Nemotron is listed. A tuned
  non-NVIDIA model would not meet the track's "NVIDIA open-source model" requirement on its own, so the Nemotron track
  cannot use fine-tuning at all. The docs also disagree on serving a tuned model: the models page says deployment is
  "only via Dedicated endpoints", the older overview says serverless LoRA adapters with per-token billing.
  Sources: https://docs.tokenfactory.nebius.com/post-training/models.md and
  https://docs.tokenfactory.nebius.com/fine-tuning/overview.md
- **Why it matters.** The most natural improvement for a brand-voice product, a small tuned writer, was closed to us. We used
  a prompt plus guardrails instead.
- **Suggestion.** Add Nemotron 3.5 Lightning (or another small Nemotron) as a LoRA base, and reconcile the two docs pages on
  how a tuned model is served and billed.

## 7. Serverless Jobs are described as scheduled, but have no schedule

- **What we saw.** The jobs docs call them "one-off or scheduled batch workloads", yet `nebius ai job create` and
  `nebius ai job run` have no schedule or cron option. A weekly rebuild and eval need a clock, and the only place to get one is outside
  Nebius. Our first design triggered the job from a Cloudflare cron (a Workflow signs an RS256 JWT with the service-account key, exchanges
  it for a 12 h IAM token and calls `POST /ai/v1/jobs`; a dry-run create from a Node script was accepted on the first try, with the code shipped as
  `injected_files`). That path cannot run from Cloudflare at all (section 9), so the jobs are now started on demand from a developer's CLI session
  and we say so everywhere, rather than claiming a schedule that does not run.
  Sources: https://docs.nebius.com/serverless/jobs/manage.md and https://docs.nebius.com/cli/reference/ai/job/run.md
- **Why it matters.** The most common use of a batch job on a SaaS is "every Monday". The product billed only while running
  is a good fit for it, but the schedule has to live in somebody else's scheduler, and (section 9) the usual one cannot reach the API.
- **Suggestion.** Add `--schedule "0 0 * * 1"` (or a Schedules resource), and a short recipe for creating a job from a
  Cloudflare Worker with a service-account key, since Workers are a common front end for this.

## 8. `json_schema` works on Lightning, Super VL and Ultra, but no model card says so

- **What we saw.** On 29 Oct 2026, `response_format: { type: "json_schema", strict: true }` and `json_object` were accepted
  and obeyed by `nvidia/Nemotron-3_5-Lightning`, `nvidia/Nemotron-3.5-Super-VL` and `nvidia/Nemotron-3-Ultra-550b-a55b`:
  valid JSON matching the schema, 0.4 to 1.0 s, 19 to 23 output tokens. No Nemotron card in the catalogue carries a JSON-mode
  tag, and the docs examples for structured output use Qwen and Mistral.
  Source: `docs/LIVE-SMOKE.md` section 2, check `json_schema`.
- **Why it matters.** Without the tag we planned for an unconfirmed feature (schema in the prompt, `response_format` as a
  try-once hint, a retry that drops it). A tested tag would have removed a retry path.
- **Suggestion.** Add JSON mode and function calling as catalogue filters for every model that passes them, and add one
  Nemotron structured-output example to the docs. Function calling also worked on Super VL in our test: two tools in one turn,
  valid arguments, final answer.

## 9. The AI Cloud control plane is unreachable from Cloudflare Workers; Token Factory is not

- **What we saw.** On 30 Oct 2026 (02:30 MYT) a deployed Cloudflare Worker could not reach any AI Cloud control-plane host:
  `auth.eu.nebius.com`, `auth.nebius.com`, `api.nebius.cloud` and `api.eu-north1.nebius.cloud` all timed out and Cloudflare returned a
  **522** (connection timed out between Cloudflare and the origin). In the same Worker, `api.tokenfactory.nebius.com` worked normally.
  Nebius appears to drop Cloudflare's egress addresses on the control plane but not on Token Factory. The same calls from a laptop, with a
  CLI-issued IAM token, work (create, poll, delete a job; dry-run create).
- **Why it matters.** Workers (with Workflows and cron) are a natural scheduler for a Serverless Job, and a service-account token exchange
  plus `POST /ai/v1/jobs` is exactly the call a Worker would make. We had built it (JWT signing with WebCrypto, token cache in KV, job start, poll,
  delete) and had to remove it before it ever deployed. Nothing in the jobs, IAM or networking docs says Cloudflare egress is blocked, so it
  was discovered by a 522 rather than read.
- **Suggestion.** Document the egress policy for the AI Cloud control plane (which networks are refused and why), and either allow Cloudflare
  egress or give the jobs API a Token-Factory-style public edge that Workers can call with an API key or a short-lived token. A `schedule` on
  the job resource (section 7) would remove the need to call the API from outside at all.
