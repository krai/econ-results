"""The public form of a record."""
import copy
import json
import unittest

from tests import sample
from tools import patterns, sanitize


class TestSanitize(unittest.TestCase):
    def setUp(self):
        self.rec = sample.record()
        self.pub = sanitize.public(self.rec, sample.ALIASES)

    def test_the_internal_record_is_not_changed(self):
        before = copy.deepcopy(self.rec)
        sanitize.public(self.rec, sample.ALIASES)
        self.assertEqual(self.rec, before)

    def test_the_provenance_goes_and_the_form_is_public(self):
        self.assertNotIn("provenance", self.pub)
        self.assertEqual(self.pub["visibility"], "public")
        self.assertEqual(self.pub["id"], self.rec["id"])

    def test_the_measured_and_priced_numbers_stay(self):
        self.assertEqual(self.pub["points"], self.rec["points"])
        self.assertEqual(self.pub["results"], self.rec["results"])

    def test_a_host_named_in_a_text_becomes_its_alias(self):
        text = json.dumps(self.pub)
        self.assertNotIn("buildhost7", text)
        self.assertIn("measured with quick settings on Test node A.", self.pub["findings"][0]["text"])
        self.assertEqual(sanitize.text("ran on BUILDHOST7 and buildhost70", sample.ALIASES),
                         "ran on Test node A and buildhost70")

    def test_the_node_goes_by_its_alias_and_a_node_without_one_is_refused(self):
        self.assertEqual((self.rec["hardware"]["node"], self.pub["hardware"]["node"]), ("buildhost7", "Test node A"))
        with self.assertRaises(sanitize.Forbidden) as caught:
            sanitize.public(sample.record(host="otherbox3"), sample.ALIASES)
        self.assertIn("no alias for its node", str(caught.exception))
        named = sample.record()
        named["hardware"]["node"] = "Test node A"  # a record that already names its node by the alias
        self.assertEqual(sanitize.public(named, sample.ALIASES)["hardware"]["node"], "Test node A")

    def test_a_path_keeps_only_its_file_name(self):
        for raw, safe in (("see /home/someone/runs/x/measure.json now", "see measure.json now"),
                          ("D:/data/runs/report.json", "report.json"), ("C:\\Users\\me\\prices.json", "prices.json"),
                          ("~/econ_exp/configs/s0.yaml", "s0.yaml"),
                          ("text slices of dataset.jsonl (20 characters)", "text slices of dataset.jsonl (20 characters)"),
                          ("5.29 / 3.59 USD, 2,505 tok/s", "5.29 / 3.59 USD, 2,505 tok/s"),
                          ("vllm/vllm-openai:v0.34.0", "vllm/vllm-openai:v0.34.0"),
                          ("https://openrouter.ai/api/v1/models/a/b/endpoints", "https://openrouter.ai/api/v1/models/a/b/endpoints")):
            with self.subTest(raw):
                self.assertEqual(sanitize.text(raw, {}), safe)

    def test_a_local_address_is_not_repeated(self):
        self.assertEqual(sanitize.text("read http://127.0.0.1:18000/metrics every 2 s", {}),
                         "read the local server every 2 s")

    def test_the_price_list_loses_its_providers_and_keeps_its_prices(self):
        for before, after in zip(self.rec["prices"]["by_endpoint"], self.pub["prices"]["by_endpoint"]):
            self.assertNotIn("provider", after)
            self.assertNotIn("tag", after)
            self.assertEqual((after["input"], after["output"], after["quantization"]),
                             (before["input"], before["output"], before["quantization"]))
        self.assertNotIn("Alpha Cloud", json.dumps(self.pub))

    def test_an_image_of_a_personal_namespace_is_named_by_what_it_is(self):
        rec = sample.record()
        rec["engine"].update(image="someone/vllm-6e780d14-withsrc:v1.0", build="nightly", commit="6e780d14", version=None)
        pub = sanitize.public(rec, sample.ALIASES)
        self.assertEqual(pub["engine"]["image"], "vLLM nightly 6e780d14 (custom build)")
        self.assertEqual(self.pub["engine"]["image"], "vllm/vllm-openai:v1.2.0")

    def test_it_fails_closed_on_what_it_cannot_make_safe(self):
        rec = sample.record()
        rec["not_covered"].append("GPU-98cb9ec0-77c1-7694-9950-c28264f29c27 was slow")
        with self.assertRaises(sanitize.Forbidden) as caught:
            sanitize.public(rec, sample.ALIASES)
        self.assertIn("$.not_covered[1]", str(caught.exception))
        rec = sample.record()
        rec["findings"][0]["text"] = "an unlisted host, zzbox9"
        with self.assertRaises(sanitize.Forbidden):
            sanitize.public(rec, sample.ALIASES, words=frozenset({"zzbox"}))

    def test_only_an_internal_record_is_sanitised(self):
        with self.assertRaises(ValueError):
            sanitize.public(self.pub, sample.ALIASES)

    def test_the_public_form_has_nothing_forbidden(self):
        self.assertEqual(patterns.scan(self.pub), [])


if __name__ == "__main__":
    unittest.main()
