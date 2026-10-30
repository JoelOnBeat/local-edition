"""Generate the train and test sets with Nemotron on Token Factory, filtered by the deterministic rule checker.

Runs INSIDE the GPU job (stdlib only, so it can run while pip installs the training stack). The API key is read from the
injected secret file /opt/le-secrets/NEBIUS_API_KEY, never from the environment. Writes data/{train,test}.jsonl and
data/gen_report.json. Spend is metered from token counts; it stops before passing DATA_CAP_USD.
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import rules
from spec import ANGLES, Spec, build_specs, teacher_messages

BASE = "https://api.tokenfactory.nebius.com/v1/chat/completions"
KEY_FILE = os.environ.get("KEY_FILE", "/opt/le-secrets/NEBIUS_API_KEY")
MODELS = [("nvidia/Nemotron-3-Ultra-550b-a55b", 1.00, 3.00), ("nvidia/Nemotron-3.5-Super-VL", 0.30, 0.90)]  # $ per M in/out
DATA_CAP_USD = float(os.environ.get("DATA_CAP_USD", "2.5"))
N_TRAIN, N_TEST, N_CAND, CONCURRENCY = (int(os.environ.get(k, d)) for k, d in (("N_TRAIN", 600), ("N_TEST", 120), ("N_CAND", 900), ("CONCURRENCY", 16)))
OUT = os.environ.get("DATA_DIR", "data")
SCHEMA = {"type": "object", "additionalProperties": False, "required": list(rules.KEYS),
          "properties": {k: {"type": "string"} for k in rules.KEYS}}

_lock = threading.Lock()
_spend = {"usd": 0.0, "in": 0, "out": 0, "calls": 0, "errors": 0, "fallback": 0, "stopped": False}
_key = open(KEY_FILE, encoding="utf-8").read().strip()


def _post(model: str, messages, seed: int):
    body = {"model": model, "messages": messages, "max_tokens": 220, "temperature": 0.9, "seed": seed,
            "response_format": {"type": "json_schema", "json_schema": {"name": "edition_copy", "strict": True, "schema": SCHEMA}},
            "reasoning_effort": "none", "chat_template_kwargs": {"enable_thinking": False}}
    req = urllib.request.Request(BASE, json.dumps(body).encode(), {"Authorization": f"Bearer {_key}", "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=60))


def call(messages, seed: int):
    """One teacher call: Ultra first, Super VL if Ultra keeps failing. Returns (model, text) or None."""
    for mi, (model, p_in, p_out) in enumerate(MODELS):
        for attempt in range(3):
            if _spend["stopped"]:
                return None
            try:
                r = _post(model, messages, seed)
                u = r.get("usage", {})
                with _lock:
                    _spend["in"] += u.get("prompt_tokens", 0)
                    _spend["out"] += u.get("completion_tokens", 0)
                    _spend["calls"] += 1
                    _spend["usd"] += u.get("prompt_tokens", 0) * p_in / 1e6 + u.get("completion_tokens", 0) * p_out / 1e6
                    if _spend["usd"] > DATA_CAP_USD:
                        _spend["stopped"] = True
                    if mi:
                        _spend["fallback"] += 1
                return model, r["choices"][0]["message"]["content"] or ""
            except urllib.error.HTTPError as e:
                with _lock:
                    _spend["errors"] += 1
                if e.code not in (429, 500, 502, 503, 504):
                    break
                time.sleep(2 ** attempt)
            except Exception:  # timeout, reset
                with _lock:
                    _spend["errors"] += 1
                time.sleep(1 + attempt)
    return None


def norm_words(s: str):
    return re.findall(r"[a-z0-9]+", s.lower())


def ngrams(s: str, n: int = 3):
    w = norm_words(s)
    return {tuple(w[i:i + n]) for i in range(max(0, len(w) - n + 1))}


def jac(a, b) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def gen(specs, tag: str):
    def one(ix_spec):
        i, s = ix_spec
        r = call(teacher_messages(s, ANGLES[i % len(ANGLES)]), seed=1000 + i)
        if not r:
            return None
        model, text = r
        d = rules.parse_strict(text)
        hits = rules.rule_hits(" ".join(str(d.get(k, "")) for k in rules.KEYS), s.price) if d else [("json", "")]
        ok = bool(d) and rules.keys_exact(d) and rules.length_ok(d) and rules.voice_ok(d) and not hits
        return {"spec": s._asdict(), "out": {k: d[k].strip() for k in rules.KEYS} if rules.keys_exact(d) else None,
                "ok": ok, "hits": hits[:3], "model": model}

    with ThreadPoolExecutor(CONCURRENCY) as ex:
        res = list(ex.map(one, enumerate(specs)))
    print(f"[gen] {tag}: {sum(1 for r in res if r)} of {len(specs)} calls returned, spend ${_spend['usd']:.3f}", flush=True)
    return res


def main():
    os.makedirs(OUT, exist_ok=True)
    t0 = time.time()
    train_specs, test_specs = build_specs(seed=7, n_train=N_CAND, n_test=N_TEST)
    # Test references come first and are small; the train pool is the larger run.
    test_res = gen(test_specs, "test")
    cand_res = gen(train_specs, "train")
    cand = [r for r in cand_res if r]
    passed = [r for r in cand if r["ok"]]
    # Dedupe inside train: exact (normalised text) then near-duplicate lines (word-trigram Jaccard > 0.7).
    seen_exact, kept, kept_grams, d_exact, d_near = set(), [], [], 0, 0
    for r in passed:
        o = r["out"]
        key = " ".join(norm_words(o["line"] + " " + o["say_it"]))
        g = ngrams(o["line"] + " " + o["say_it"])
        if key in seen_exact:
            d_exact += 1
            continue
        if any(jac(g, h) > 0.7 for h in kept_grams):
            d_near += 1
            continue
        seen_exact.add(key)
        kept.append(r)
        kept_grams.append(g)
    # Leakage check against the teacher references of the TEST specs: drop any train output too close to one.
    test_refs = [r for r in test_res if r and r["ok"]]
    test_grams = [ngrams(r["out"]["line"] + " " + r["out"]["say_it"]) for r in test_refs]
    test_exact = {" ".join(norm_words(r["out"]["line"] + " " + r["out"]["say_it"])) for r in test_refs}
    final, d_exact_x, d_near_x, max_j = [], 0, 0, 0.0
    for r, g in zip(kept, kept_grams):
        j = max((jac(g, h) for h in test_grams), default=0.0)
        if " ".join(norm_words(r["out"]["line"] + " " + r["out"]["say_it"])) in test_exact:
            d_exact_x += 1
        elif j > 0.5:
            d_near_x += 1
        else:
            max_j = max(max_j, j)
            final.append(r)
    final = final[:N_TRAIN]
    tr_items = {r["spec"]["item"] for r in final}
    tr_hoods = {r["spec"]["neighbourhood"] for r in final}
    te_items = {s.item for s in test_specs}
    te_hoods = {s.neighbourhood for s in test_specs}
    train_tuples = {tuple(r["spec"].values()) for r in final}
    t_pass = sum(1 for r in test_res if r and r["ok"])
    report = {
        "teacher_models_used": sorted({r["model"] for r in cand if r}), "fallback_calls": _spend["fallback"],
        "train_candidates": len(train_specs), "train_returned": len(cand), "train_passed_rules": len(passed),
        "train_pass_rate_pct": round(100 * len(passed) / max(1, len(cand)), 1),
        "train_rule_failures": {rid: sum(1 for r in cand if not r["ok"] for h in r["hits"][:1] if h[0] == rid)
                                for rid in sorted({h[0] for r in cand if not r["ok"] for h in r["hits"][:1]})},
        "dedupe_train_exact": d_exact, "dedupe_train_near_dup_jaccard_gt_0.7": d_near,
        "dedupe_vs_test_refs_exact": d_exact_x, "dedupe_vs_test_refs_near_jaccard_gt_0.5": d_near_x,
        "max_train_vs_test_ref_trigram_jaccard_after_filter": round(max_j, 3),
        "train_final": len(final), "test_specs": len(test_specs), "test_reference_pass_rate_pct": round(100 * t_pass / max(1, len(test_specs)), 1),
        "spec_overlap": {"menu_items": sorted(tr_items & te_items), "neighbourhoods": len(tr_hoods & te_hoods),
                         "exact_spec_tuples": len(train_tuples & {tuple(s._asdict().values()) for s in test_specs})},
        "train_items": len(tr_items), "train_neighbourhoods": len(tr_hoods), "test_items": len(te_items), "test_neighbourhoods": len(te_hoods),
        "tokens_in": _spend["in"], "tokens_out": _spend["out"], "calls": _spend["calls"], "errors": _spend["errors"],
        "data_cost_usd_estimate": round(_spend["usd"], 3), "data_cap_usd": DATA_CAP_USD, "stopped_at_cap": _spend["stopped"],
        "wall_s": round(time.time() - t0, 1),
    }
    with open(f"{OUT}/train.jsonl", "w", encoding="utf-8") as f:
        for r in final:
            f.write(json.dumps({"spec": r["spec"], "out": r["out"]}, ensure_ascii=False) + "\n")
    with open(f"{OUT}/test.jsonl", "w", encoding="utf-8") as f:
        for s, r in zip(test_specs, test_res):
            f.write(json.dumps({"spec": s._asdict(), "ref": r["out"] if r and r["ok"] else None}, ensure_ascii=False) + "\n")
    json.dump(report, open(f"{OUT}/gen_report.json", "w"), indent=1)
    print("GEN_REPORT " + json.dumps(report), flush=True)
    if len(final) < min(200, N_TRAIN // 2) or _spend["stopped"]:
        print("[gen] too few training examples or cap hit", flush=True)
        sys.exit(3)


if __name__ == "__main__":
    main()
