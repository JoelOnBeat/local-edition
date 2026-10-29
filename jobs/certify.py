#!/usr/bin/env python3
"""Local Edition batch job, run as a Nebius Serverless Job:  nebius ai job run jobs/certify.py -- --mode certify

Modes
  certify  read the week's pending copy from GET $APP_URL/api/jobs/pending, run every item through NeMo
           Guardrails (our regex rail, NeMo's self check output on Lightning, and for web-derived event text
           our injection stripper on event and card text), POST the verdicts to /api/jobs/results.
  eval     run the 40 red-team phrases and 10 benign near-misses of guardrails/tests/phrases.json through the
           same rails and POST catch and false-positive rates to /api/jobs/eval.
  import   read a CSV from $IMPORT_CSV_URL and POST it to /api/stores/import (store import API, signed).

Who is who: NeMo Guardrails (library) = the runtime and the `self check output` rail. Our code = the regex
catalogue (run by NeMo as a custom action) and the injection stripper (run before NeMo). Honest labels are
written into every verdict's reasons.

Environment
  APP_URL         required  base URL of the deployed app (not with EVAL_PRINT=1)
  LE_JOB_SECRET   required  the per-job secret, HMAC(shared secret, job name) (never printed; not with EVAL_PRINT=1)
  EVAL_PRINT      optional  1: eval mode only, never calls the app; prints the eval table to stdout instead of posting it
  NEBIUS_API_KEY  certify and eval: Token Factory key for Lightning (never printed)
  JOB_NAME        optional  recorded as the job id (the Nebius job name; the platform sets no id variable)
  TRIGGER         optional  cron or manual (default manual)
  IMPORT_CSV_URL  import mode: https URL of a CSV (name,address,lat,lon)
  RAILS_DIR       optional  folder holding the rails config; default ./rails (staged by CI) or ../guardrails/localedition

Exit codes: 0 done, 1 some items had no verdict or the run failed, 2 bad configuration, 3 the app rejected
a request or was unreachable.
"""

import argparse
import asyncio
import hashlib
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from le_http import Api, log  # noqa: E402

CHECKED_BY = "nemo-guardrails@nebius-job"
LIGHTNING_PER_MTOK = (0.06, 0.24)  # input, output USD (docs/LIVE-SMOKE.md)
EVAL_VOICE = ["warm", "plain, specific"]
MAX_CSV_BYTES = 100 * 1024
# Copy built from web snippets: the event, and the staff card that repeats it.
WEB_KINDS = ("event", "card")


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def first_existing(*paths):
    return next((p for p in paths if os.path.exists(p)), None)


def rails_dir():
    found = os.environ.get("RAILS_DIR") or first_existing(os.path.join(HERE, "rails"), os.path.join(HERE, "..", "guardrails", "localedition"))
    if not found or not os.path.exists(os.path.join(found, "config.yml")):
        log("Rails config not found. Set RAILS_DIR, or stage guardrails/localedition into jobs/rails.")
        sys.exit(2)
    return found


def script_sha():
    with open(os.path.abspath(__file__), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def make_certifier():
    sys.path.insert(0, rails_dir())
    import batch  # noqa: E402

    return batch, batch.Certifier(config_dir=rails_dir())


def spend_usd(usage):
    return usage.prompt_tokens / 1e6 * LIGHTNING_PER_MTOK[0] + usage.completion_tokens / 1e6 * LIGHTNING_PER_MTOK[1]


def describe(usage, started):
    return "wall %.1f s, %d model calls, %d in / %d out tokens (%d reasoning), Token Factory spend about $%.6f" % (
        time.time() - started, usage.calls, usage.prompt_tokens, usage.completion_tokens, usage.reasoning_tokens, spend_usd(usage))


def run_certify(api, job_id, trigger):
    started, started_iso = time.time(), now_iso()
    sha = script_sha()
    pending = api.get_signed("/api/jobs/pending", {"x-le-script-sha": sha})
    items = (pending or {}).get("items", [])
    log("Pending items: %d" % len(items))
    batch, certifier = make_certifier()

    async def one(item):
        try:
            checked = await certifier.check(item["text"], item["kind"], item["brandVoice"], from_web=item["kind"] in WEB_KINDS)
        except batch.CheckFailed as error:
            return item, None, str(error)
        return item, checked, None

    async def all_items():
        return await asyncio.gather(*(one(i) for i in items))

    outcomes = asyncio.run(all_items()) if items else []
    results, failed, counts = [], 0, {"passed": 0, "rewritten": 0, "blocked": 0}
    stamp = now_iso()
    for item, checked, error in outcomes:
        if checked is None:
            failed += 1
            log("No verdict for %s/%s: %s" % (item["editionId"], item["itemId"], error))
            continue
        counts[checked.guardrail["status"]] += 1
        results.append({
            "editionId": item["editionId"], "itemId": item["itemId"],
            "guardrail": {**checked.guardrail, "checkedBy": CHECKED_BY, "certifiedAt": stamp, "jobId": job_id},
        })
    log("Verdicts: %d passed, %d rewritten, %d blocked, %d without a verdict" % (counts["passed"], counts["rewritten"], counts["blocked"], failed))
    updated = 0
    if results:
        answer = api.post_json("/api/jobs/results", {
            "results": results, "jobId": job_id, "scriptSha": sha, "startedAt": started_iso, "trigger": trigger, "failed": failed,
        })
        updated = int((answer or {}).get("updated", 0))
    log("App updated %d item(s). %s" % (updated, describe(certifier.usage, started)))
    return 1 if failed else 0


def eval_cases():
    path = first_existing(os.path.join(HERE, "rails", "phrases.json"), os.path.join(HERE, "..", "guardrails", "tests", "phrases.json"))
    if not path:
        log("phrases.json not found: stage guardrails/tests/phrases.json into jobs/rails.")
        sys.exit(2)
    with open(path, encoding="utf-8") as f:
        rows = json.load(f)
    red = [r["text"] for r in rows if r.get("eval") == "redteam"]
    benign = [r["text"] for r in rows if r.get("eval") == "benign"]
    if len(red) != 40 or len(benign) != 10:
        log("Expected 40 red-team and 10 benign phrases, found %d and %d." % (len(red), len(benign)))
        sys.exit(2)
    return [(t, "block") for t in red] + [(t, "pass") for t in benign]


def print_table(rows):
    """The eval rows as a plain table: expected, got, verdict, phrase (cut to 70 characters)."""
    log("%-3s %-8s %-6s %-5s %s" % ("#", "expected", "got", "ok", "phrase"))
    for n, r in enumerate(rows, 1):
        log("%-3d %-8s %-6s %-5s %s" % (n, r["expected"], r["got"], "yes" if r["expected"] == r["got"] else "MISS", r["phrase"].replace("\n", " ")[:70]))


def run_eval(api, job_id, trigger):
    started, started_iso = time.time(), now_iso()
    sha = script_sha()
    cases = eval_cases()
    batch, certifier = make_certifier()

    async def one(text):
        try:
            return (await certifier.check(text, "special", EVAL_VOICE)).guardrail["status"]
        except batch.CheckFailed:
            return None

    async def all_cases():
        return await asyncio.gather(*(one(t) for t, _ in cases))

    got = asyncio.run(all_cases())
    if any(g is None for g in got):
        log("%d case(s) had no verdict (model errors); nothing posted." % sum(g is None for g in got))
        return 1
    rows = [{"phrase": t[:500], "expected": e, "got": "pass" if g == "passed" else "block"} for (t, e), g in zip(cases, got)]
    red = [r for r in rows if r["expected"] == "block"]
    ben = [r for r in rows if r["expected"] == "pass"]
    caught = sum(r["got"] == "block" for r in red)
    fps = sum(r["got"] == "block" for r in ben)
    payload = {
        "at": now_iso(), "cases": len(red), "caught": caught, "falsePositives": fps, "benign": len(ben),
        "catchRate": caught / len(red), "falsePositiveRate": fps / len(ben), "model": certifier.model, "jobId": job_id, "rows": rows,
    }
    if api is None:
        print_table(rows)
        log("Eval (printed, not posted): caught %d of %d red-team phrases (%.0f%%), %d of %d benign wrongly blocked (%.0f%%)" % (
            caught, len(red), 100 * payload["catchRate"], fps, len(ben), 100 * payload["falsePositiveRate"]))
        log(describe(certifier.usage, started))
        return 0
    api.post_json("/api/jobs/eval", {**payload, "scriptSha": sha, "startedAt": started_iso, "trigger": trigger})
    log("Eval: caught %d of %d red-team phrases (%.0f%%), %d of %d benign wrongly blocked (%.0f%%)" % (
        caught, len(red), 100 * payload["catchRate"], fps, len(ben), 100 * payload["falsePositiveRate"]))
    log("Misses: %s" % ([r["phrase"] for r in red if r["got"] == "pass"] or "none"))
    log(describe(certifier.usage, started))
    return 0


def run_import(api, job_id, trigger):
    url = os.environ.get("IMPORT_CSV_URL", "")
    if not url.startswith(("https://", "http://127.0.0.1", "http://localhost")):
        log("IMPORT_CSV_URL (an https URL) is required for import mode.")
        return 2
    request = urllib.request.Request(url, headers={"user-agent": "local-edition-job/2.0", "accept": "text/csv,text/plain"})
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read(MAX_CSV_BYTES + 1)
    if len(raw) > MAX_CSV_BYTES:
        log("The CSV is larger than %d KB." % (MAX_CSV_BYTES // 1024))
        return 2
    stores = api.post_csv("/api/stores/import", raw.decode("utf-8"), {"x-le-script-sha": script_sha()})
    log("Imported %d store(s) into the demo workspace (job %s, trigger %s)." % (len(stores or []), job_id, trigger))
    return 0


def main():
    parser = argparse.ArgumentParser(description="Local Edition batch job")
    parser.add_argument("--mode", choices=["certify", "eval", "import"], default=os.environ.get("MODE", "certify"))
    args = parser.parse_args()
    app, secret = os.environ.get("APP_URL", "").rstrip("/"), os.environ.get("LE_JOB_SECRET", "")
    print_only = os.environ.get("EVAL_PRINT") == "1"
    if print_only and args.mode != "eval":
        log("EVAL_PRINT=1 works with --mode eval only.")
        return 2
    if not print_only and (not app.startswith(("http://", "https://")) or not secret):
        log("APP_URL (an http(s) URL) and LE_JOB_SECRET are required.")
        return 2
    trigger = os.environ.get("TRIGGER", "manual")
    if trigger not in ("cron", "manual"):
        log("TRIGGER must be cron or manual.")
        return 2
    job_id = (os.environ.get("JOB_NAME") or "local-%d" % int(time.time()))[:120]
    log("Local Edition %s job %s against %s" % (args.mode, job_id, "nothing (EVAL_PRINT)" if print_only else app))
    api = None if print_only else Api(app, secret, job_id)
    return {"certify": run_certify, "eval": run_eval, "import": run_import}[args.mode](api, job_id, trigger)


if __name__ == "__main__":
    sys.exit(main())
