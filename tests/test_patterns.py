"""What a public record must not hold."""
import unittest

from tools import patterns


class TestPatterns(unittest.TestCase):
    def test_private_things_are_found(self):
        for text in ("/home/someone/run/measure.json", "C:/Users/me/file.json", "D:\\data\\x.json", "/mnt/disk/file",
                     "GPU-98cb9ec0-77c1-7694", "http://10.1.2.3:8000/v1", "write to someone@example.org",
                     "hf_abcdefghijklmnopqrstuvwx", "ghp_abcdefghijklmnopqrstuvwx",
                     "-----BEGIN OPENSSH PRIVATE KEY-----"):
            with self.subTest(text):
                self.assertTrue(patterns.in_text(text))

    def test_what_a_record_normally_says_passes(self):
        for text in ("vllm/vllm-openai:v0.34.0", "vllm/vllm-openai@sha256:20fdb089", "TTFT p99 <= 2 s, TPOT p99 <= 50 ms",
                     "https://openrouter.ai/api/v1/models/org/model-v4.1/endpoints", "595.58.03", "2.14.0+cu130",
                     "5.14.0-427.13.1.el9_4.x86_64", "input median 1,024 / p90 4,096", "raw /v1/completions",
                     "$0.30 / $1.20 per M tokens", "H200 node A", "27.8 GB/s from pinned memory, 44 % of the link"):
            with self.subTest(text):
                self.assertEqual(patterns.in_text(text), [])

    def test_a_private_word_is_found_by_its_digest_with_or_without_digits(self):
        word = "zzprivate"
        saved = patterns.WORD_SHA256
        patterns.WORD_SHA256 = frozenset({patterns.digest(word)})
        try:
            self.assertTrue(patterns.in_text("measured on zzprivate12 today"))
            self.assertTrue(patterns.in_text("ZZPrivate"))
            self.assertEqual(patterns.in_text("zzprivateer"), [])
        finally:
            patterns.WORD_SHA256 = saved

    def test_the_message_does_not_repeat_the_word(self):
        self.assertEqual(patterns.in_text("on secretbox3", words=frozenset({"secretbox"})), ["a private name"])

    def test_a_scan_walks_keys_lists_and_strings(self):
        doc = {"a": [{"b": "/home/x/y"}], "provenance": {}, "ok": "fine", "n": 3}
        hits = patterns.scan(doc)
        self.assertEqual(len(hits), 2)
        self.assertIn("$.a[0].b", hits[0])
        self.assertIn("$.provenance", hits[1])

    def test_the_digests_are_digests(self):
        self.assertTrue(all(len(d) == 64 and set(d) <= set("0123456789abcdef") for d in patterns.WORD_SHA256))


if __name__ == "__main__":
    unittest.main()
