"""LoRA fine-tune of Llama-3.1-Nemotron-Nano-4B-v1.1 on the distilled edition-copy set, then base vs tuned on held-out specs.

Same prompt (spec.student_messages), same decoding (greedy, max_new_tokens fixed), same checker (rules.check) for both.
Prints one RESULTS_JSON block and three example pairs. The adapter is saved to /opt/out/adapter and discarded with the job.
"""
from __future__ import annotations

import json
import math
import os
import random
import re
import time

import torch
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer

import rules
from spec import Spec, student_messages

MODEL = "nvidia/Llama-3.1-Nemotron-Nano-4B-v1.1"
REVISION = os.environ.get("MODEL_REVISION", "d552708a9d575fa8d4a690b988fd870d65279f98")
DATA = os.environ.get("DATA_DIR", "data")
EPOCHS, LR, MICRO_BS, ACCUM, MAX_NEW, EVAL_BS = 3, 2e-4, 8, 2, 120, 40
MAX_TRAIN_S = 18 * 60  # hard stop on training wall time
T0 = time.time()


def log(msg: str) -> None:
    print(f"[{time.time() - T0:7.1f}s] {msg}", flush=True)


def load(path):
    return [json.loads(line) for line in open(path, encoding="utf-8")]


def answer_text(o) -> str:
    return json.dumps({k: o[k] for k in rules.KEYS}, ensure_ascii=False)


@torch.no_grad()
def generate_all(model, tok, specs):
    """Greedy decoding, left-padded batches. Returns raw completions (special tokens stripped)."""
    model.eval()
    outs = []
    prompts = [tok.apply_chat_template(student_messages(s), tokenize=False, add_generation_prompt=True) for s in specs]
    for i in range(0, len(prompts), EVAL_BS):
        enc = tok(prompts[i:i + EVAL_BS], return_tensors="pt", padding=True, add_special_tokens=False).to(model.device)
        gen = model.generate(**enc, max_new_tokens=MAX_NEW, do_sample=False, temperature=None, top_p=None, pad_token_id=tok.pad_token_id)
        outs += tok.batch_decode(gen[:, enc["input_ids"].shape[1]:], skip_special_tokens=True)
    return [o.strip() for o in outs]


def metrics(outputs, specs):
    n = len(specs)
    strict = [rules.check(o, s.price, strict=True) for o, s in zip(outputs, specs)]
    lenient = [rules.check(o, s.price, strict=False) for o, s in zip(outputs, specs)]
    pct = lambda rows, k: round(100 * sum(r[k] for r in rows) / n, 1)
    return {
        "json_valid_pct": pct(strict, "json_valid"), "json_valid_lenient_pct": pct(lenient, "json_valid"),
        "exact_keys_pct": pct(strict, "keys_exact"), "length_ok_pct": pct(strict, "length_ok"),
        "first_person_pct": pct(strict, "voice_ok"), "rule_violation_pct": pct(strict, "violation"),
        "all_pass_pct": pct(strict, "all_pass"), "all_pass_lenient_pct": pct(lenient, "all_pass"),
    }


def tokenise_example(tok, ex, eot_id):
    s = Spec(**ex["spec"])
    prompt = tok.apply_chat_template(student_messages(s), tokenize=False, add_generation_prompt=True)
    p = tok(prompt, add_special_tokens=False)["input_ids"]
    a = tok(answer_text(ex["out"]), add_special_tokens=False)["input_ids"] + [eot_id]
    return p + a, [-100] * len(p) + a


def train(model, tok, rows):
    eot = tok.convert_tokens_to_ids("<|eot_id|>")
    data = [tokenise_example(tok, ex, eot) for ex in rows]
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=LR, weight_decay=0.0, betas=(0.9, 0.99))
    steps_per_epoch = math.ceil(len(data) / (MICRO_BS * ACCUM))
    total = steps_per_epoch * EPOCHS
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / max(1, int(0.06 * total))) * max(0.05, 0.5 * (1 + math.cos(math.pi * s / total))))
    rng, step, t_train = random.Random(0), 0, time.time()
    model.train()
    for ep in range(EPOCHS):
        order = list(range(len(data)))
        rng.shuffle(order)
        for b in range(0, len(order), MICRO_BS * ACCUM):
            chunk = order[b:b + MICRO_BS * ACCUM]
            n_tok = sum(sum(1 for t in data[i][1] if t != -100) for i in chunk)
            loss_sum = 0.0
            for m in range(0, len(chunk), MICRO_BS):
                batch = [data[i] for i in chunk[m:m + MICRO_BS]]
                L = max(len(x[0]) for x in batch)
                ids = torch.tensor([x[0] + [tok.pad_token_id] * (L - len(x[0])) for x in batch], device="cuda")
                lab = torch.tensor([x[1] + [-100] * (L - len(x[1])) for x in batch], device="cuda")
                att = torch.tensor([[1] * len(x[0]) + [0] * (L - len(x[0])) for x in batch], device="cuda")
                with torch.autocast("cuda", dtype=torch.bfloat16):
                    logits = model(input_ids=ids, attention_mask=att).logits
                loss = torch.nn.functional.cross_entropy(logits[:, :-1].float().reshape(-1, logits.size(-1)), lab[:, 1:].reshape(-1), ignore_index=-100, reduction="sum") / n_tok
                loss.backward()
                loss_sum += loss.item()
            torch.nn.utils.clip_grad_norm_(params, 1.0)
            opt.step()
            sched.step()
            opt.zero_grad(set_to_none=True)
            step += 1
            if step % 10 == 0 or step == total:
                log(f"train epoch {ep + 1}/{EPOCHS} step {step}/{total} loss {loss_sum:.4f}")
            if time.time() - t_train > MAX_TRAIN_S:
                log("training time cap reached, stopping early")
                return step, total, time.time() - t_train
    return step, total, time.time() - t_train


def main():
    train_rows, test_rows = load(f"{DATA}/train.jsonl"), load(f"{DATA}/test.jsonl")
    specs = [Spec(**r["spec"]) for r in test_rows]
    log(f"train {len(train_rows)} test {len(test_rows)} gpu {torch.cuda.get_device_name(0)}")
    tok = AutoTokenizer.from_pretrained(MODEL, revision=REVISION, padding_side="left")
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    model = AutoModelForCausalLM.from_pretrained(MODEL, revision=REVISION, torch_dtype=torch.bfloat16, device_map={"": 0})
    model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, task_type="CAUSAL_LM",
                                             target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]))
    n_train_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    log(f"loaded; trainable LoRA params {n_train_params:,}")

    t = time.time()
    with model.disable_adapter():
        base_out = generate_all(model, tok, specs)
    base_s = time.time() - t
    base_m = metrics(base_out, specs)
    log(f"BASE zero-shot {json.dumps(base_m)} ({base_s:.0f}s)")

    steps, total, train_s = train(model, tok, train_rows)
    log(f"trained {steps}/{total} steps in {train_s:.0f}s")
    os.makedirs("/opt/out", exist_ok=True)
    model.save_pretrained("/opt/out/adapter")

    t = time.time()
    tuned_out = generate_all(model, tok, specs)
    tuned_s = time.time() - t
    tuned_m = metrics(tuned_out, specs)
    log(f"TUNED {json.dumps(tuned_m)} ({tuned_s:.0f}s)")

    # Memorisation check: does the tuned model copy training text verbatim?
    train_lines = {" ".join(re.findall(r"[a-z0-9]+", r["out"]["line"].lower())) for r in train_rows}
    copies = 0
    for o in tuned_out:
        d = rules.parse_lenient(o)
        if d and rules.keys_exact(d) and " ".join(re.findall(r"[a-z0-9]+", d["line"].lower())) in train_lines:
            copies += 1
    gen_report = json.load(open(f"{DATA}/gen_report.json"))
    result = {
        "base_model": MODEL, "revision": REVISION, "gpu": torch.cuda.get_device_name(0), "lora": {"r": 16, "alpha": 32, "epochs": EPOCHS, "lr": LR, "effective_batch": MICRO_BS * ACCUM, "trainable_params": n_train_params},
        "train_examples": len(train_rows), "test_examples": len(test_rows), "steps": f"{steps}/{total}",
        "train_seconds": round(train_s), "eval_seconds": {"base": round(base_s), "tuned": round(tuned_s)}, "total_job_seconds": round(time.time() - T0),
        "base_zero_shot": base_m, "tuned": tuned_m, "tuned_verbatim_train_line_copies_of_test": copies,
        "decoding": f"greedy, max_new_tokens={MAX_NEW}", "data": {k: gen_report[k] for k in ("train_pass_rate_pct", "train_final", "dedupe_train_exact", "dedupe_vs_test_refs_exact", "max_train_vs_test_ref_trigram_jaccard_after_filter", "data_cost_usd_estimate")},
    }
    print("RESULTS_JSON " + json.dumps(result), flush=True)
    for i in (0, 1, 2):
        print(f"EXAMPLE {i} spec={json.dumps(test_rows[i]['spec'], ensure_ascii=False)}\n  BASE : {base_out[i]!r}\n  TUNED: {tuned_out[i]!r}", flush=True)
    bad = [i for i, (o, s) in enumerate(zip(base_out, specs)) if rules.rule_hits(o, s.price)][:2]
    for i in bad:
        print(f"BASE VIOLATION example {i}: {rules.rule_hits(base_out[i], specs[i].price)[:3]} -> {base_out[i]!r}", flush=True)


if __name__ == "__main__":
    main()
