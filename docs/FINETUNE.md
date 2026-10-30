# Local Edition fine-tune: house-style edition copy in a small NVIDIA model

Additive. Nothing in `src/`, `worker/` or the live pipeline calls this; the app still uses Nemotron on Token Factory. One run, 30 Oct 2026, measured and recorded here.

## Task
Given a structured spec (menu item, category, price, an invented neighbourhood character, a tone, the length limits), return JSON
`{ "special_name", "line" (<= 20 words), "say_it" (<= 18 words, first-person staff voice) }` that follows the house rules: no health, nutrition,
allergen or diet claims, no superlatives, no price other than the one given, no invented offers. The same deterministic checker (`finetune/rules.py`)
filters the training data and scores the eval: the app's own regex catalogue (`guardrails/localedition/catalogue.py`: health, diet, allergen, nutrition,
body, targeting) plus superlatives, invented prices and offers, length, exact keys and first person.

## What ran
| | |
|---|---|
| Base model | `nvidia/Llama-3.1-Nemotron-Nano-4B-v1.1` @ `d552708a9d57` (pure transformer, 4.5 B params, loads in stock transformers; Nano-9B-v2 not used) |
| Licence | NVIDIA Open Model License; additional terms: Llama 3.1 Community License ("Built with Llama"). Open weights, commercial use allowed under those terms. |
| Method | LoRA r=16, alpha 32, dropout 0.05, all attention and MLP projections (30.4 M trainable params), bf16 base, lr 2e-4 cosine, effective batch 16, 3 epochs = 114 steps, loss on the answer only |
| Prompt and decoding | One prompt (`finetune/spec.py:student_messages`, system `detailed thinking off`), identical for training, base and tuned. Greedy, `max_new_tokens=120`. |
| Hardware | 1x NVIDIA H100 80GB HBM3, Nebius Serverless Job, eu-north1, `gpu-h100-sxm` `1gpu-16vcpu-200gb`, image `pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime` (Docker Hub), transformers 4.47.1, peft 0.14.0, accelerate 1.2.1 |
| Job | `local-edition-finetune-20261030151856`, id `aijob-e00cc8hf8zwhd4ea6s`, deleted after the run |
| Time | LoRA training 44 s (114 steps); base eval 7 s, tuned eval 8 s (120 prompts each); in-job time from data generation to done 4 min (15:24:35 to 15:28:35 UTC); created to COMPLETED 586 s including provisioning and image pull |
| GPU cost | At most $0.73 (586 s x $4.50 per H100-hour list price, counting provisioning and pull); about $0.28 if only the 225 s in RUNNING are billed. The invoice was not read. |
| Data cost | $0.38 estimated from token counts (223,470 in, 52,126 out, 1,020 calls; Ultra at $1 / $3 per M) against the $3 cap |

## Data
- Teacher: `nvidia/Nemotron-3-Ultra-550b-a55b` on Token Factory (no Super VL fallback needed), `json_schema` strict, reasoning off, 16 requests in flight, 0 errors. 75 s for all 1,020 calls, run inside the GPU job while pip and the model download ran. The key reached the job only as the injected file `/opt/le-secrets/NEBIUS_API_KEY`, read by `gen_data.py`; it is not an environment variable.
- No Claude-written text, no Qloo data, no Tavily data, no personal data. Menu items, categories and prices are the sample chain Kettle & Kiln (`fixtures/sample/menu-board.html`); the 24 neighbourhood descriptions are invented plain words (`finetune/spec.py`).
- Specs: train = 16 menu items x 18 neighbourhoods x 6 tones (900 sampled as candidates); test = 6 DIFFERENT held-out items x 6 DIFFERENT held-out neighbourhoods x 6 tones (120 sampled). Overlap measured in the job: 0 shared menu items, 0 shared neighbourhoods, 0 identical spec tuples.
- Rule-checker pass rate of the teacher on train candidates: 896 of 900 = 99.6% (failures: 2 superlative, 1 invented offer, 1 length or voice). Teacher pass rate on the 120 test references: 100%.
- Dedupe: within train, 0 exact duplicates and 2 near-duplicates (word-trigram Jaccard > 0.7) dropped; train vs the 120 test reference outputs, 0 exact matches and 0 near matches above Jaccard 0.5 (largest kept: 0.304). Final train set: 600. The tuned model copied 0 of its 120 test lines verbatim from a training line.

## Result (120 held-out specs, same prompt, greedy)
| Metric | Base zero-shot | Tuned (LoRA) |
|---|---|---|
| JSON valid (whole output parses) | 98.3% (118/120) | 100% |
| Exact keys, string values | 98.3% | 100% |
| Length compliant (name <= 6, line <= 20, say_it <= 18 words) | 38.3% (46/120) | 100% |
| First-person staff voice | 82.5% | 100% |
| Rule violations (health / allergen / diet / superlative / price / offer) | 3.3% (4/120) | 0% |
| All checks pass | 30.0% (36/120) | 100% |

Examples: base writes a 38-word `say_it` ("Welcome to our cozy coffee shop on Harbour Street! ...") (limit 18); tuned writes
`{"special_name": "Harbour Street Breakfast", "line": "Rainy mornings, fishing boats, and the usual crowd waiting at the window.", "say_it": "I warmed up a cheese and egg sandwich for you."}`.

## Caveats (read before quoting)
- Most of the gain is format and length discipline. The base model already writes valid JSON 98% of the time and breaks the rules rarely (4 of 120); a drop from 4 to 0 is too few cases to call a safety improvement. The headline is length compliance (38% to 100%), voice, and the all-checks pass rate.
- The checker is a regex rule set, not a judge of copy quality. The training data was filtered by the same checker, so 100% on it is in-distribution by construction. No human or model rating of how good the copy reads was done; tuned lines are short and plain.
- One run, one seed, 120 specs from 6 items x 6 neighbourhoods; no confidence intervals. Specs are held out by item and neighbourhood, but share the same templates, tones and teacher style as training.
- The teacher is a 550 B model; this is distillation of its house-style output into a 4 B model, nothing more. The tuned model is not wired into the app.
- Dependencies are version-pinned binary wheels but not hash-pinned; the key file was on the job's disk while pip ran (never exported).
- Tenant quota is 2 concurrent instances; the launcher queued about 9 minutes and one earlier attempt (`aijob-e00ee24r21maptfdf5`) ended in ERROR at provisioning on that quota, never ran, and was deleted.

## Keeping the adapter (not done tonight)
The job saved the adapter to `/opt/out/adapter` (about 120 MB, fp32 LoRA) on its own disk; it vanished with the job. To keep one after the deadline: re-run, tar the adapter, and PUT it to R2 through the app's signed ingest with the per-job secret (same HMAC scheme as `certify`), then load it with `peft` in a CLI-started GPU job. No endpoint or VM is needed.

## Files
`finetune/spec.py` (specs, prompts), `finetune/rules.py` (checker), `finetune/gen_data.py` (teacher data, dedupe), `finetune/train_eval.py` (LoRA, base vs tuned),
`finetune/run.sh` (job entry), `finetune/requirements.txt`, `scripts/start-finetune.sh` (create, queue on quota, watch, 44-minute cap, logs, delete).
Run: `NEBIUS_API_KEY=... scripts/start-finetune.sh` (`--dry-run` validates only). No generated data or weights are in git.
