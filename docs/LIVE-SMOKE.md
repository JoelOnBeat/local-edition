# Live smoke: Token Factory and Tavily (29 Oct 2026)

First run against the real Nebius Token Factory and Tavily keys. Qloo stayed on fixtures (`QLOO_MODE=fixture`, no key), so
nothing here contains Qloo data. Every live response is in `.recordings/` (gitignored). No key appears in any file, log or
recording (checked by searching them for the key values).

Run it again: `~/.secret-store/inject.sh get NEBIUS_API_KEY TAVILY_API_KEY --dir .` then
`SPEND_CAP_USD=1 npx tsx scripts/smoke-live.ts all` (or `reasoning`, `menu`, `tools`, `schema`, `embed`, `rerank`, `tavily`).
Each call prints one JSON line with tokens and dollars and writes `.recordings/smoke-live-<check>.json`.
Dollars are tokens at the list prices in `src/server/tokenfactory/spend.ts` (not read back from Nebius billing).

## Verdict

| Check | Result |
|---|---|
| Reasoning control | Found. `off` = `reasoning_effort: "none"` plus `chat_template_kwargs.enable_thinking: false` (both accepted everywhere). On Lightning it is not optional: with thinking on, a 20-word copy reply spends 600+ tokens and the thinking text lands in `content`. |
| Menu read | 22 of 22 items, every name, price and category exact. |
| Two-tool round trip on Super-VL | Works: both tools in one turn, valid JSON arguments, final answer. |
| `json_schema` | Accepted and obeyed by Lightning, Super-VL and Ultra (also `json_object`). |
| Embeddings | `Qwen/Qwen3-Embedding-8B`, 4096 dimensions. |
| Rerank | Unavailable: 404 `model_not_found`. The embedding-cosine fallback works. |
| Tavily | Parses. 6 results per store. Query rewritten (see below); no listing has a `published_date`. |
| 1-store build | Super-VL drove the tools itself. Copy by Lightning. Guardrails: 3 of 3 items `unchecked` against the stock sidecar (timeouts), `passed` against a sidecar with thinking off. |

## 1. Reasoning control

Measured with raw requests and again through `chat()` (`reasoning` option). Tokens are completion tokens, with reasoning
tokens in brackets. `completion_tokens` already includes reasoning, so reasoning is billed as output.

| Option | Lightning, 1-word reply | Lightning, 20-word copy | Super-VL, copy | Super-120B (leaves 9 Nov), 1-word |
|---|---|---|---|---|
| default | 96 (93) | 600+ (all thinking, finish `length`, thinking text in `content`) | 357 (341) | 37 (33) |
| `chat_template_kwargs {enable_thinking:false}` | 2 (0) | 13 (0) | 10 (0) | 2 (0) |
| `reasoning_effort: "none"` | 2 (0) | 12 (0) | 10 (0) | 2 (0) |
| both together | 2 (0) | 13 (0) | 10 (0) | not run |
| `reasoning_effort: "low"` | 98 (95), no effect | 600+ | 330 (314), barely | 12 (8), works |
| `chat_template_kwargs {low_effort:true}` | 96 (93) | 600+ | not run | 12 (8) |
| `reasoning_budget: 0`, `reasoning:{enabled:false}`, `/no_think` system line | no effect | no effect | `/no_think` and `reasoning:{enabled:false}` no effect | no effect |

Through the client (copy prompt, `max_tokens` 700): Lightning `off` 13 tokens, $0.000006, 1.0 s; `low` and `default` both 700
tokens, finish `length`, $0.00017, content is the thinking. Super-VL `off` 10 tokens, $0.000024; `low` 355 (339); `default`
651 (632), $0.0006.

Chosen settings (`src/server/tokenfactory/reasoning.ts`, `chat({ reasoning: 'off' | 'low' | 'default' })`):
- `off` sends both switches. `low` sends `reasoning_effort: "low"` (only meaningful on 120B). `default` sends nothing.
- No `reasoning` given: Lightning is `off`; Super-VL is `off` without tools; Super-VL with tools uses `AGENT_REASONING`.
- `jsonOutput` (menu read, every structured call) defaults to `off`. Unknown models are sent nothing.
- `AGENT_REASONING` is `default` (provider thinking), not `off`. Three loop runs per setting on one store (Qloo fixtures):
  `off` fell back to the fixed plan 2 of 3 times (it repeats the same empty `artists_local` call), `low` 1 of 3, `default`
  1 of 3. Cost per store $0.006 to $0.015 for all three, so thinking buys reliability for under half a cent. The sample is
  small and confounded by empty fixture artists: re-measure once Qloo returns real artists.

## 2. Live checks

| Check | Result | Tokens (in/out) | $ |
|---|---|---|---|
| `readMenuBoard` on `public/sample/menu-board-photo.png` (thinking off) | 22 items, 0 missing, 0 extra, 0 wrong prices, 0 wrong categories, 5.3 s | 2171 / 1055 | 0.0016 |
| Function calling, Super-VL, `off` | `block_profile` and `events_this_week` in one turn, results sent back, one-sentence answer, 2.2 s | 849 / 91 | 0.0003 |
| Function calling, `low` and `default` | same, 263 reasoning tokens | 849 / 352 | 0.0006 |
| `json_schema` (strict) and `json_object`: Lightning, Super-VL, Ultra | all accepted, all valid JSON matching the schema, 0.4 to 1.0 s | 34 / 19 to 23 each | 0.00001 to 0.00008 each |
| Embeddings | 4096 dimensions, 2 texts, 1.1 s | 159 / 0 | about 0.000002 |
| `POST /v1/rerank` `Qwen/Qwen3-Reranker-8B` | 404 `model_not_found`. `/v1/models` lists 29 models and no reranker. | 0 | 0 |
| `rerank()` with fallback | `embedding-cosine`, 2.7 s including the 404 | 159 | about 0.000002 |
| Tavily, Williamsburg and Park Slope | 6 results each, parsed, 0.9 to 1.5 s, 1 credit each | n/a | 2 credits |

Fixes in my clients:
- `chat()` now reads `completion_tokens_details.reasoning_tokens` (`usage.reasoningTokens`), also from `jsonOutput`.
- A 404 from `/v1/rerank` is remembered for 10 minutes per client, so each partner ranking no longer pays a wasted round
  trip before the cosine fallback (`rerankUnavailableMemo`).
- Tavily query. The old query ("events this week near <corner>, <store>, <city>") returned street-fair directories scoring
  0.08 to 0.5. The corner does the damage. New query: `<store name> <city> events things to do this week <Mon D> to <Sun D> <year>`
  (week dates are Monday to Sunday, so recordings stay valid all week). Scores now 0.56 to 0.86, mostly roundup pages
  (Time Out, Eventbrite, Club Freetime). The corner stays in the evidence summary. `buildTavilyBody(store, city, now?)`.
- No response-shape mismatches: the chat, embeddings and Tavily schemas parsed every live response unchanged.

## 3. One-store build (Williamsburg)

`next dev -p 3917`, `TF_MODE=live TAVILY_MODE=live QLOO_MODE=fixture STORE_DRIVER=file SPEND_CAP_USD=1`, workspace cookie,
`POST /api/editions/build {"storeIds":[<Williamsburg>]}`, guardrails sidecar on its own port with a generated
`GUARDRAILS_TOKEN` held in the shell only.

| | Run 1 (stock sidecar, agent `off`) | Run 2 (sidecar with thinking off, agent `default`) |
|---|---|---|
| Who drove the tools | Super-VL for 10 turns, valid arguments every turn, then fell back: `too_many_invalid_calls` | Super-VL, no fallback (`generatedBy.agentModel` = Super-VL) |
| Items | 3 (special, partner, event) from the fixed plan | 2 (special, partner); the model submitted no sound or event |
| Copy | Lightning | Lightning: "Hojicha Roast", "A roasted green tea with a toasty, caramel finish. Perfect for a quiet moment on the block." |
| Guardrails | all 3 `unchecked` ("did not answer within 4000 ms") | both `passed` |
| Wall time | 24.9 s | 18.9 s |
| App-side spend (meter) | $0.0113 | $0.0063: Super-VL 5 calls 14,019 in / 2,258 out (1,824 reasoning), Lightning 2 calls 812 / 141, embeddings 2 calls 651 |
| Sidecar spend (not metered) | about 9 checks of 560 to 1,024 completion tokens, roughly $0.002 | 2 checks of 2 tokens |

## 4. Still needs fixing (not my files)

1. **Guardrails brand-voice rail runs Lightning with thinking on** (`guardrails/localedition/actions.py`, `llm_call`). Each check
   spends 560 to 1,024 tokens (hits the 1,024 cap), takes 3 s alone and 10 to 30 s when four run together, so the app's 4,000 ms
   timeout makes every item `unchecked`. The sidecar's spend also never reaches the app's meter. Verified on a scratch copy: adding
   `"extra_body": {"reasoning_effort": "none", "chat_template_kwargs": {"enable_thinking": False}}` to `llm_params` gives 2
   tokens, 0.4 to 0.9 s, same verdicts (off-brand copy blocked, on-brand passed).
2. **`guardrails/localedition/config.yml` main model is `nvidia/nemotron-3-super-120b-a12b`**, which leaves Token Factory on
   9 Nov 2026. Use `nvidia/Nemotron-3.5-Super-VL`.
3. **Agent loop `maxTokens: 1200`** (`src/server/agent/loop.ts`) is too small once thinking is on: 6 of 88 Super-VL calls ended
   `finish_reason: length` with the reasoning unfinished, and one fallback was `no_tool_calls`. Raise to about 3000.
4. **`artists_local` returns `[]` for model-chosen genres in Qloo fixture mode**, so the model loops on it and the sound item
   cannot be built. The model recovers only when it omits genres. Fixture matching or a genre-less default needs fixing before
   this smoke says anything about the sound item; the real Qloo call is untested.
5. **Tavily gives roundup pages, no dates.** `topic: "general"` returns no `published_date` (0 of 24 listings seen), so every event tie-in
   is a calendar page with `startsAt: null`. A model step that picks a dated event from the snippets (Lightning, off) would
   turn them into real tie-ins.
6. **The agent chat client (`src/server/agent/live.ts`) does not pass `reasoning`.** It gets the defaults above, which is
   fine; pass it explicitly if the setting should be tunable per call.
7. **Super-VL capacity.** The first probe saw `529 System is overloaded` three times and about 30 s per tiny call; later calls
   took 0.6 to 1 s. `fetchJson` retries 5xx, but a judge session could hit the slow period.

## Spend

Token Factory total for the session, at list prices: about $0.12 (raw probes about $0.01, smoke checks about $0.007, loop
comparisons $0.089, the two builds $0.018 plus about $0.003 of unmetered sidecar calls). The cap was $1. Tavily: 14 credits
(8 probe queries, 2 smoke runs of 2 stores, 2 builds).
