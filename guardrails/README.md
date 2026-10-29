# Local Edition guardrails (NeMo Guardrails 0.24.1, batch library)

The sidecar server is retired. These rails now run as a library inside the Nebius Serverless Job
(`../jobs/certify.py`, modes `certify` and `eval`), never on a user's request path. The Worker's live check
(`../src/server/guardrails/`) mirrors the same rules in TypeScript; see "Live and batch" below.

## What is NeMo and what is ours

| Piece | Whose | Where |
|---|---|---|
| Runtime: `LLMRails.check_async`, the flow engine, the OpenAI-compatible model client | NeMo Guardrails | library |
| `self check output` rail: the LLM call to Lightning and its yes/no parsing | NeMo Guardrails (built-in) | library |
| The prompt text of that rail (policy and brand brief) | ours | `localedition/prompts.yml` |
| `check health claims` rail: the regex catalogue, executed by NeMo as a custom action | ours | `localedition/catalogue.py`, `actions.py` |
| `strip prompt injection`: removes injected sentences from web-derived (event, card) copy, before NeMo | ours | `localedition/injection.py` |
| Batch driver: one verdict per item, usage metering | ours | `localedition/batch.py` |

Rail order for one item: our injection rule (event and card copy only; a hit is a block and no model call),
then NeMo runs `check health claims` (a hit blocks, no model call), then `self check output` (Lightning,
reasoning off; "Yes" blocks). Every verdict's `reasons` say which of these produced it.

## Model

`nvidia/Nemotron-3_5-Lightning` on Token Factory, reasoning off. `config.yml` sets `reasoning_effort: none` and
`chat_template_kwargs.enable_thinking: false` as default request fields (measured: 0 reasoning tokens;
`tests/test_batch.py` checks the request body). NeMo's built-in `self check output` has no `llm_params`
hook, so reasoning is set on the model entry, not in `actions.py`. `nvidia/nemotron-3-super-120b-a12b` is never
used (it leaves Token Factory Serverless on 9 Nov 2026).

## Run

```bash
cd guardrails
uv sync --python 3.11 --frozen          # about 20 s warm; the job itself pip-installs ../jobs/requirements.txt
uv run pytest -q                        # 125 tests, offline: a local stub stands in for Token Factory
NEBIUS_API_KEY=... uv run python -c "..."   # see jobs/certify.py for the real driver
```

Python 3.11 or 3.12. The job runs on `python:3.12-slim`; every dependency has a linux x86_64 wheel.

## Files

- `localedition/config.yml`, `rails.co`, `prompts.yml`: the rails config (Colang 1.0).
- `localedition/actions.py`: the `check health claims` action. `rail_info.py`: per-check side channel for reasons.
- `localedition/catalogue.py`: regex rules (standard library only). TS mirror: `src/server/guardrails/catalogue.ts`.
- `localedition/injection.py`: prompt-injection rules and `strip`. TS mirror: `src/server/guardrails/injection.ts`.
- `localedition/batch.py`: `Certifier.check(text, kind, brand_voice, from_web)` returns a contract `GuardrailResult` dict.
- `tests/phrases.json`: the phrase table used by pytest and vitest. Rows tagged `"eval": "redteam"` (40) and
  `"eval": "benign"` (10) are the eval set. `tests/injection.json`: the injection table.

## Live and batch

The Worker cannot run Python, so the live path is: TS regex mirror, then NeMo's `self_check_output` prompt text
(read from `prompts.yml` by a vitest parity test) on Lightning with reasoning off, then `passed`. Live verdicts are
`checkedBy: "live"`. The NeMo job re-certifies them as `checkedBy: "nemo-guardrails@nebius-job"`.

## Known limits

- The catalogue is deliberately strict and word-based ("boost", "protein", "gluten" in any sense). Paraphrases are
  caught only by the Lightning rail, which is a small model with thinking off: it misses some ("Perfect for busy
  parents" passes) and varies on long copy. The eval job reports how many of the 40 phrases were caught.
- A block by `self check output` carries a generic reason; the yes/no check explains nothing.
- Prompt-injection rules are phrase-based. A rephrased injection can pass them.
