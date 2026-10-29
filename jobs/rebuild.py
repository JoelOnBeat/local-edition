#!/usr/bin/env python3
"""Weekly Local Edition rebuild, run as a Nebius AI job (`nebius ai job run jobs/rebuild.py`).

Stdlib only. The job holds no Qloo, Tavily or model logic: it signs a request with LE_JOB_SECRET
(HMAC-SHA256 of the raw body, hex, header `x-le-signature`), POSTs it to $APP_URL/api/jobs/monday,
then polls GET $APP_URL/api/jobs/latest until that run finishes. The app does the building.

Environment
  APP_URL         required  base URL of the deployed app, e.g. https://local-edition.example.workers.dev
  LE_JOB_SECRET   required  shared HMAC secret (never printed)
  TRIGGER         optional  "cron" (default) or "manual"
  JOB_NAME        optional  recorded on the run as nebiusJobId (the job name; Nebius does not document a job-id env var)
  STORE_IDS       optional  comma-separated store ids to build instead of all
  POLL_SECONDS    optional  poll interval, default 10
  TIMEOUT_SECONDS optional  give up waiting after this long, default 1800

Exit codes: 0 done, 1 the build failed, 2 bad configuration, 3 request rejected or app unreachable,
4 timed out waiting.
"""
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request

USER_AGENT = "local-edition-rebuild/1.0"
MAX_POST_ATTEMPTS = 4
MAX_POLL_ERRORS = 6


def log(message):
    print(message, flush=True)


def sign(secret, body):
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def http(method, url, body=None, headers=None, timeout=60):
    """Returns (status, parsed_json_or_None). HTTP error statuses are returned, not raised."""
    request = urllib.request.Request(url, data=body, method=method, headers={"user-agent": USER_AGENT, **(headers or {})})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw, status = response.read(), response.status
    except urllib.error.HTTPError as error:
        raw, status = error.read(), error.code
    try:
        return status, json.loads(raw.decode("utf-8")) if raw else None
    except ValueError:
        return status, None


def error_text(payload):
    if isinstance(payload, dict) and "error" in payload:
        return "%s (%s)" % (payload.get("error"), payload.get("code", "no code"))
    return "no details"


def start_run(app, secret, trigger, job_name, store_ids):
    """Sign and POST. Retries network failures and 5xx; a 4xx is final (bad secret, bad body)."""
    payload = {"trigger": trigger, "ts": int(time.time())}
    if job_name:
        payload["nebiusJobId"] = job_name
    if store_ids:
        payload["storeIds"] = store_ids
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    headers = {"content-type": "application/json", "x-le-signature": sign(secret, body)}
    for attempt in range(1, MAX_POST_ATTEMPTS + 1):
        try:
            status, data = http("POST", app + "/api/jobs/monday", body, headers)
        except (urllib.error.URLError, OSError) as error:
            status, data = 0, {"error": "network: %s" % error.__class__.__name__}
        if status == 200 and isinstance(data, dict) and data.get("id"):
            return data
        if 400 <= status < 500 and status != 429:
            log("Request rejected: HTTP %d, %s" % (status, error_text(data)))
            sys.exit(3)
        log("Attempt %d/%d failed: HTTP %d, %s" % (attempt, MAX_POST_ATTEMPTS, status, error_text(data)))
        if attempt < MAX_POST_ATTEMPTS:
            time.sleep(2 ** attempt * 3)
    log("The app did not accept the job.")
    sys.exit(3)


def wait_for(app, run_id, interval, timeout):
    deadline = time.time() + timeout
    errors = 0
    last_note = None
    while time.time() < deadline:
        try:
            status, latest = http("GET", app + "/api/jobs/latest")
            errors = 0 if status == 200 else errors + 1
        except (urllib.error.URLError, OSError):
            status, latest, errors = 0, None, errors + 1
        if errors >= MAX_POLL_ERRORS:
            log("Lost contact with the app while polling.")
            sys.exit(3)
        if status == 200 and isinstance(latest, dict) and latest.get("id") == run_id:
            if latest.get("note") != last_note:
                last_note = latest.get("note")
                log("[%s] %s" % (latest.get("status"), last_note))
            if latest.get("status") != "running":
                return latest
        elif status == 200 and isinstance(latest, dict):
            log("A newer run (%s) replaced ours; following it." % latest.get("id"))
            run_id = latest.get("id")
        time.sleep(interval)
    log("Timed out after %d s waiting for run %s." % (timeout, run_id))
    sys.exit(4)


def main():
    app = os.environ.get("APP_URL", "").rstrip("/")
    secret = os.environ.get("LE_JOB_SECRET", "")
    if not app.startswith(("http://", "https://")) or not secret:
        log("APP_URL (an http(s) URL) and LE_JOB_SECRET are required.")
        return 2
    trigger = os.environ.get("TRIGGER", "cron")
    if trigger not in ("cron", "manual"):
        log("TRIGGER must be cron or manual.")
        return 2
    store_ids = [s.strip() for s in os.environ.get("STORE_IDS", "").split(",") if s.strip()]
    interval = max(1, int(os.environ.get("POLL_SECONDS", "10")))
    timeout = max(30, int(os.environ.get("TIMEOUT_SECONDS", "1800")))

    log("Starting weekly rebuild against %s (trigger=%s)." % (app, trigger))
    run = start_run(app, secret, trigger, os.environ.get("JOB_NAME"), store_ids)
    log("Run %s started for %d store(s)." % (run["id"], len(run.get("storeIds", []))))
    final = wait_for(app, run["id"], interval, timeout) if run.get("status") == "running" else run

    started, finished = final.get("startedAt"), final.get("finishedAt")
    log("Summary: run=%s status=%s stores=%d started=%s finished=%s" % (final.get("id"), final.get("status"), len(final.get("storeIds", [])), started, finished))
    log("Note: %s" % final.get("note"))
    return 0 if final.get("status") == "done" else 1


if __name__ == "__main__":
    sys.exit(main())
