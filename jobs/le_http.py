"""Signed HTTP for the Local Edition jobs. Standard library only (this module runs before any pip install matters).

Two signing schemes, both HMAC-SHA256 hex, header `x-le-signature`. The signature covers
  "le2\n<ts>\n<METHOD>\n<path>\n<job id>\n" + body
so a captured request cannot be replayed on another endpoint, with another method or with a swapped timestamp:
  - JSON POST with a `ts` field in the body (results, eval): <ts> in the prefix is empty, `ts` is inside the body.
  - Header timestamp (GET pending, CSV import): header `x-le-timestamp` = epoch seconds, repeated in the prefix.
Every request also sends `x-le-job-id` (the Nebius job name). The key is LE_JOB_SECRET, which inside a Nebius job is
the per-job secret HMAC(shared secret, job name): the app accepts it only for that name, only on the job endpoints
and only within an hour of the timestamp in the name. The server accepts a request for 300 s and once only.
"""

import hashlib
import hmac
import json
import sys
import time
import urllib.error
import urllib.request

USER_AGENT = "local-edition-job/2.0"
MAX_ATTEMPTS = 4


def log(message):
    print(message, flush=True)


def hmac_hex(secret, payload):
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def signed_bytes(method, path, body=b"", ts="", job_id=""):
    """The bytes the app verifies: protocol tag, header timestamp, method, path, job name, then the body."""
    return ("le2\n%s\n%s\n%s\n%s\n" % (ts, method.upper(), path, job_id)).encode("utf-8") + body


def derive_job_secret(master, job_name):
    """What the Worker puts into the job: hex HMAC-SHA256 of the job name keyed by the shared secret."""
    return hmac_hex(master, job_name.encode("utf-8"))


def http(method, url, body=None, headers=None, timeout=60):
    """(status, parsed JSON or None). HTTP error statuses are returned, not raised."""
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


class Api:
    def __init__(self, app_url, secret, job_id=""):
        self.app = app_url.rstrip("/")
        self.secret = secret
        self.job_id = job_id

    def _send(self, method, path, build, expect=200):
        """Rebuild and re-sign on every attempt (a signature is good once). 4xx other than 429 is final."""
        status, data = 0, None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            body, headers = build()
            try:
                status, data = http(method, self.app + path, body, headers)
            except (urllib.error.URLError, OSError) as error:
                status, data = 0, {"error": "network: %s" % error.__class__.__name__}
            if status == expect:
                return data
            if 400 <= status < 500 and status != 429:
                log("%s %s rejected: HTTP %d, %s" % (method, path, status, error_text(data)))
                sys.exit(3)
            log("%s %s attempt %d/%d failed: HTTP %d, %s" % (method, path, attempt, MAX_ATTEMPTS, status, error_text(data)))
            if attempt < MAX_ATTEMPTS:
                time.sleep(2 ** attempt * 2)
        log("The app did not answer %s %s." % (method, path))
        sys.exit(3)

    def get_signed(self, path, extra_headers=None):
        def build():
            ts = str(int(time.time()))
            sig = hmac_hex(self.secret, signed_bytes("GET", path, b"", ts, self.job_id))
            return None, {"x-le-timestamp": ts, "x-le-signature": sig, "x-le-job-id": self.job_id, **(extra_headers or {})}
        return self._send("GET", path, build)

    def post_json(self, path, payload):
        def build():
            body = json.dumps({**payload, "ts": int(time.time())}, separators=(",", ":")).encode("utf-8")
            sig = hmac_hex(self.secret, signed_bytes("POST", path, body, "", self.job_id))
            return body, {"content-type": "application/json", "x-le-signature": sig, "x-le-job-id": self.job_id}
        return self._send("POST", path, build)

    def post_csv(self, path, text, extra_headers=None):
        raw = text.encode("utf-8")

        def build():
            ts = str(int(time.time()))
            sig = hmac_hex(self.secret, signed_bytes("POST", path, raw, ts, self.job_id))
            return raw, {"content-type": "text/csv", "x-le-timestamp": ts, "x-le-signature": sig, "x-le-job-id": self.job_id, **(extra_headers or {})}
        return self._send("POST", path, build)
