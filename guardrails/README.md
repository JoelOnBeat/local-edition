# Local Edition guardrails (NeMo Guardrails 0.24.1)

A small sidecar that checks every piece of generated copy (specials, event blurbs, staff card lines) before
it can become a draft. Two output rails, run in this order, on `POST /v1/checks`:

1. `check health claims` (deterministic): a regex catalogue that blocks health, diet, nutrition, allergen
   and identity-targeting claims ("gluten-free", "boosts your immunity", "vegan", "180 calories",
   "for young women"). `oat milk` and `naturally sweet` pass. Source of truth: `localedition/catalogue.py`;
   the TypeScript mirror is `../src/server/guardrails/catalogue.ts` (a vitest test fails if they differ).
2. `check brand voice` (LLM self-check on `nvidia/Nemotron-3_5-Lightning`, Token Factory): is the copy in
   the brand voice passed in the request context? It does not run when rail 1 already blocked. It
   degrades to "skipped" (never blocks) when there is no `NEBIUS_API_KEY`, no brand voice, the model call
   fails, or the model answer is not yes/no. Why a custom action and not the built-in `self check output`:
   the built-in prompt only receives `user_input` and `bot_response`, so it cannot see the brand voice.

## Run locally

```bash
./guardrails/start.sh            # uv installs the pinned set on first run, serves http://127.0.0.1:8000
PORT=8791 ./guardrails/start.sh  # another port
NEBIUS_API_KEY=... ./guardrails/start.sh   # enables the brand-voice rail
uv run pytest -q                 # Python tests (from this folder)
```

Python 3.11 (`pyproject.toml` allows 3.11 and 3.12). Install time on a warm uv cache: about 20 s;
installed size about 213 MB. Dependencies are pinned by `uv.lock`; `requirements.txt` is the same top-level pin.

## Request and response

```bash
curl -X POST http://127.0.0.1:8000/v1/checks -H 'content-type: application/json' \
  -H 'x-le-guard-token: $GUARDRAILS_TOKEN' -d '{
  "model": "nvidia/Nemotron-3_5-Lightning",
  "messages": [
    {"role": "user", "content": "Check this copy."},
    {"role": "assistant", "content": "Cardamom bun, baked at 6am for the Sunday market crowd."}
  ],
  "guardrails": {"config_id": "localedition", "rail_types": ["output"],
                 "context": {"brand_voice": ["warm", "specific"], "kind": "special"}}
}'
# {"status":"passed","content":"..."}  or  {"status":"blocked","content":"BLOCKED","rail":"check health claims"}
```

- The leading `user` message is required: with a `context` message and an assistant-only list, NeMo 0.24.1
  prepends an empty user turn after the context and returns `modified` with empty content.
- `status` is `passed`, `modified` (rewritten) or `blocked`. `rail` names the blocking rail.
- Extra response header `x-le-rails` (JSON, added by `config.py`): `{"reasons": [...], "skipped": [{"rail", "why"}]}`.
  `/v1/checks` itself cannot carry reasons or skip notes. The TypeScript client turns this into the
  contract's `GuardrailResult` (reasons, and a note when the brand-voice rail was skipped).
- `GET /v1/health` answers `{"status":"pass"}`.

## Environment

| Variable | Effect |
|---|---|
| `NEBIUS_API_KEY` | Enables the brand-voice rail. NeMo refuses to load a config whose key variable is unset, so `config.py` sets an inert sentinel (`unset-no-key`) when it is missing and the action treats the sentinel as "no key". |
| `GUARDRAILS_TOKEN` | If set, `/v1/checks` and `/v1/chat/completions` need header `x-le-guard-token` (the stock server has no auth and the brand-voice rail spends the model key). Health stays open. |
| `PORT` | `start.sh` only; the Dockerfile serves on 8000. |

## Container (Cloudflare Containers or Fly.io)

```bash
docker build -t local-edition-guardrails guardrails
docker run -p 8000:8000 -e GUARDRAILS_TOKEN=... -e NEBIUS_API_KEY=... local-edition-guardrails
```

`python:3.11-slim`, multi-stage with uv from `uv.lock`, non-root user (uid 10001), port 8000, healthcheck on
`/v1/health`. Built and booted locally on Docker 29 (about 613 MB image, ready in under 15 s); the health
check reached `healthy`. Use a 1 GB machine. Point the app at it with `GUARDRAILS_URL` and `GUARDRAILS_TOKEN`.

## Files

- `localedition/config.yml`, `rails.co`, `prompts.yml`: the rails config (Colang 1.0; main model is the
  agent model, the `brand_voice_check` model is Lightning).
- `localedition/actions.py`: both rails. `catalogue.py`: the regex catalogue (standard library only).
  `rail_info.py`: per-request side channel to the HTTP layer.
- `config.py`: server init (auth and the `x-le-rails` header). It resets Starlette's cached middleware
  stack before adding the middleware, because `init` runs after the stack is built.
- `tests/phrases.json`: the phrase table used by both pytest and vitest (`../src/server/guardrails/`).

## Known limits

- The catalogue is deliberately strict and word-based. It blocks "boost" in any sense ("a morning boost"),
  any use of "protein", "gluten", "vegan", "calories". Paraphrases ("makes you feel lighter") are only
  caught by the LLM rail, and only if the key is present.
- A block on `check brand voice` carries a generic reason (the yes/no check returns no explanation).
