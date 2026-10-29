"""Runs jobs/rebuild.py against a local fake of the app. `python3 -m unittest tests/e/test_rebuild.py`."""
import hashlib
import hmac
import json
import os
import subprocess
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

SCRIPT = os.path.join(os.path.dirname(__file__), "..", "..", "jobs", "rebuild.py")
SECRET = "unit-test-secret-not-real"


def make_server(final_status="done", polls_before_done=1, accept=True):
    state = {"posts": [], "polls": 0}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, status, payload):
            raw = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def run(self, status):
            return {"id": "job_1", "trigger": "cron", "startedAt": "2026-11-02T00:00:00.000Z",
                    "finishedAt": None if status == "running" else "2026-11-02T00:05:00.000Z",
                    "storeIds": ["a", "b"], "status": status, "nebiusJobId": None, "note": "note for " + status}

        def do_POST(self):
            body = self.rfile.read(int(self.headers["content-length"]))
            expected = hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
            state["posts"].append((json.loads(body), self.headers.get("x-le-signature") == expected))
            if not accept or self.headers.get("x-le-signature") != expected:
                return self.reply(401, {"error": "The request signature is not valid.", "code": "bad_signature"})
            self.reply(200, self.run("running"))

        def do_GET(self):
            state["polls"] += 1
            self.reply(200, self.run("running" if state["polls"] <= polls_before_done else final_status))

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, state


def run_script(server, **env):
    full = {**os.environ, "APP_URL": "http://127.0.0.1:%d/" % server.server_port, "LE_JOB_SECRET": SECRET,
            "POLL_SECONDS": "1", "TIMEOUT_SECONDS": "30", "JOB_NAME": "edition-2026w44-1", **env}
    return subprocess.run([sys.executable, "-I", SCRIPT], env=full, capture_output=True, text=True, timeout=60)


class RebuildScript(unittest.TestCase):
    def test_success_signs_the_body_polls_and_exits_zero(self):
        server, state = make_server()
        out = run_script(server)
        server.shutdown(); server.server_close()
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
        body, signature_ok = state["posts"][0]
        self.assertTrue(signature_ok)
        self.assertEqual(body["trigger"], "cron")
        self.assertEqual(body["nebiusJobId"], "edition-2026w44-1")
        self.assertIsInstance(body["ts"], int)
        self.assertIn("status=done", out.stdout)
        self.assertNotIn(SECRET, out.stdout + out.stderr)

    def test_failed_build_exits_one(self):
        server, _ = make_server(final_status="failed")
        out = run_script(server)
        server.shutdown(); server.server_close()
        self.assertEqual(out.returncode, 1, out.stdout)
        self.assertIn("status=failed", out.stdout)

    def test_rejected_signature_exits_three_without_retrying(self):
        server, state = make_server(accept=False)
        out = run_script(server)
        server.shutdown(); server.server_close()
        self.assertEqual(out.returncode, 3)
        self.assertEqual(len(state["posts"]), 1)
        self.assertIn("bad_signature", out.stdout)

    def test_store_ids_and_manual_trigger_are_signed_into_the_body(self):
        server, state = make_server()
        run_script(server, STORE_IDS="store_harlem, store_astoria", TRIGGER="manual")
        server.shutdown(); server.server_close()
        body, signature_ok = state["posts"][0]
        self.assertTrue(signature_ok)
        self.assertEqual(body["storeIds"], ["store_harlem", "store_astoria"])
        self.assertEqual(body["trigger"], "manual")

    def test_missing_configuration_exits_two(self):
        env = {k: v for k, v in os.environ.items() if k not in ("APP_URL", "LE_JOB_SECRET")}
        out = subprocess.run([sys.executable, "-I", SCRIPT], env=env, capture_output=True, text=True)
        self.assertEqual(out.returncode, 2)

    def test_unreachable_app_exits_three(self):
        env = {**os.environ, "APP_URL": "http://127.0.0.1:9", "LE_JOB_SECRET": SECRET}
        # Patch the backoff away by running only a single quick check on the status code contract.
        out = subprocess.run([sys.executable, "-I", "-c",
                              "import runpy,sys,time; time.sleep=lambda s: None; sys.argv=['x']; runpy.run_path(%r, run_name='__main__')" % SCRIPT],
                             env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 3, out.stdout)


if __name__ == "__main__":
    unittest.main()
