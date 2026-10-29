"""jobs/certify.py in EVAL_PRINT mode: no app, no secret, the eval table on stdout. `python3 -m unittest tests/e/test_certify_print.py`."""
import contextlib
import io
import os
import sys
import types
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "jobs"))
import certify  # noqa: E402


class FakeUsage:
    calls, prompt_tokens, completion_tokens, reasoning_tokens = 50, 1000, 200, 0


class FakeChecked:
    def __init__(self, status):
        self.guardrail = {"status": status, "reasons": []}


class FakeCertifier:
    model = "fake-lightning"
    usage = FakeUsage()

    async def check(self, text, kind, voice, from_web=False):
        # Block every red-team phrase the committed set marks as such (they are the first 40 cases), pass the rest.
        return FakeChecked("blocked" if text in FakeCertifier.red else "passed")


class Eval(unittest.TestCase):
    def run_main(self, env, argv):
        old = {k: os.environ.get(k) for k in ("EVAL_PRINT", "APP_URL", "LE_JOB_SECRET", "JOB_NAME")}
        for k, v in env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        sys.argv = ["certify.py"] + argv
        FakeCertifier.red = {t for t, e in certify.eval_cases() if e == "block"}
        certify.make_certifier = lambda: (types.SimpleNamespace(CheckFailed=RuntimeError), FakeCertifier())
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                code = certify.main()
        finally:
            for k, v in old.items():
                os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
        return code, buf.getvalue()

    def test_prints_the_table_and_posts_nothing_without_app_or_secret(self):
        code, out = self.run_main({"EVAL_PRINT": "1", "APP_URL": None, "LE_JOB_SECRET": None, "JOB_NAME": "local-edition-eval-check-1"}, ["--mode", "eval"])
        self.assertEqual(code, 0, out)
        self.assertIn("expected", out)
        self.assertIn("Eval (printed, not posted): caught 40 of 40 red-team phrases (100%), 0 of 10 benign wrongly blocked (0%)", out)
        self.assertEqual(out.count(" yes "), 50)
        self.assertNotIn("MISS", out)

    def test_print_mode_runs_eval_only(self):
        code, out = self.run_main({"EVAL_PRINT": "1", "APP_URL": None, "LE_JOB_SECRET": None}, ["--mode", "certify"])
        self.assertEqual(code, 2)
        self.assertIn("EVAL_PRINT=1 works with --mode eval only", out)

    def test_without_print_mode_the_app_and_secret_are_still_required(self):
        code, out = self.run_main({"EVAL_PRINT": None, "APP_URL": None, "LE_JOB_SECRET": None}, ["--mode", "eval"])
        self.assertEqual(code, 2)
        self.assertIn("APP_URL", out)


if __name__ == "__main__":
    unittest.main()
