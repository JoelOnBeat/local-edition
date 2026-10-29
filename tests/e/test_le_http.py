"""Signing used by jobs/certify.py. `python3 -m unittest tests/e/test_le_http.py`. The vectors are the ones src/server/jobs/job-auth.test.ts checks."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "jobs"))
from le_http import derive_job_secret, hmac_hex, signed_bytes  # noqa: E402

SECRET = "job-secret-test-0123456789abcdef-xyz"
NAME = "local-edition-certify-eval-202611020000"


class Signing(unittest.TestCase):
    def test_post_signature_covers_method_path_job_and_body(self):
        sig = hmac_hex(SECRET, signed_bytes("POST", "/api/jobs/results", b'{"ts":1,"results":[]}', "", NAME))
        self.assertEqual(sig, "cfc13ab585413804c8b0b6f9a1b84c0686f513d8bc544bf49fadf6d8b203fbf0")
        self.assertNotEqual(sig, hmac_hex(SECRET, signed_bytes("POST", "/api/jobs/eval", b'{"ts":1,"results":[]}', "", NAME)))
        self.assertNotEqual(sig, hmac_hex(SECRET, signed_bytes("PUT", "/api/jobs/results", b'{"ts":1,"results":[]}', "", NAME)))

    def test_get_signature_covers_the_timestamp(self):
        sig = hmac_hex(SECRET, signed_bytes("GET", "/api/jobs/pending", b"", "1793577600", NAME))
        self.assertEqual(sig, "97af2d03077b24c6f969103a3f49e031bf5afbb8d6a0e1003a7fd029c43d7c36")
        self.assertNotEqual(sig, hmac_hex(SECRET, signed_bytes("GET", "/api/jobs/pending", b"", "1793577601", NAME)))

    def test_the_job_secret_is_a_hex_hmac_of_the_job_name(self):
        self.assertEqual(derive_job_secret(SECRET, NAME), "d62adc900d8e4d4a503c5cd715e0231db2205a735711f57f9049873f159b08b6")


if __name__ == "__main__":
    unittest.main()
