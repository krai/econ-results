"""The builder: one page that works offline, with the records inside it."""
import contextlib
import io
import json
import os
import re
import tempfile
import unittest

from tests import sample
from tools import build, read_json, sanitize, write_json

DATA = re.compile(r'<script type="application/json" id="data">(.*?)</script>', re.S)
STAMP = "2026-01-06T00:00Z"


class TestBuild(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.runs, self.out = os.path.join(self.tmp.name, "runs"), os.path.join(self.tmp.name, "site")
        os.makedirs(self.runs)
        self.internal = [sample.record(), sample.record(label="sample-tp4", gpus=4, created="2026-01-04T08:00:00")]
        self.public = [sanitize.public(r, sample.ALIASES) for r in self.internal]

    def put(self, records, folder=None):
        folder = folder or self.runs
        os.makedirs(folder, exist_ok=True)
        for rec in records:
            write_json(os.path.join(folder, rec["id"] + ".json"), rec)

    def page(self):
        with open(os.path.join(self.out, "index.html"), encoding="utf-8", newline="") as f:
            return f.read()

    def test_the_site_is_one_page_with_the_records_inside(self):
        self.put(self.public)
        done = build.build([self.runs], self.out, audience="public", built=STAMP)
        self.assertEqual(done["records"], 2)
        data = json.loads(DATA.search(self.page()).group(1))
        self.assertEqual((data["schema"], data["audience"], data["built"]), ("econ-site/1", "public", STAMP))
        self.assertEqual([r["id"] for r in data["records"]], [self.public[1]["id"], self.public[0]["id"]])  # oldest first
        self.assertEqual(data["records"][1], self.public[0])
        self.assertEqual(read_json(os.path.join(self.out, "data.json")), data)
        for rec in self.public:
            self.assertEqual(read_json(os.path.join(self.out, "runs", rec["id"] + ".json")), rec)
        self.assertTrue(os.path.isfile(os.path.join(self.out, "schema", "econ-run-1.schema.json")))
        self.assertTrue(os.path.isfile(os.path.join(self.out, ".nojekyll")))
        self.assertTrue(data["changelog"] and data["vendored"]["commit"])

    def test_the_page_fetches_nothing(self):
        self.put(self.public)
        build.build([self.runs], self.out, audience="public", built=STAMP)
        text = DATA.sub("", self.page())
        for needle in ("<link", "<img", "<iframe", " src=", "@import", "fetch(", "XMLHttpRequest", "import(", "sendBeacon"):
            self.assertNotIn(needle, text, needle)
        self.assertEqual(re.findall(r"url\((?!#)", text), [])  # only references to the page's own clip paths and gradients
        links = set(re.findall(r'href="([^"]+)"', text))
        self.assertEqual(links, {"https://krai.ai"})

    def test_every_file_of_the_page_is_inside_it(self):
        self.put(self.public)
        build.build([self.runs], self.out, audience="public", built=STAMP)
        text, spec = self.page(), read_json(os.path.join(build.WEB, "page.json"))
        for name in spec["scripts"] + spec["styles"]:
            self.assertTrue(os.path.isfile(os.path.join(build.WEB, name)), name)
            self.assertIn(f"/* {name} */", text)
        self.assertEqual(text.count("<script>"), len(spec["scripts"]) + 1)  # and the one that sets the stored theme
        self.assertNotIn("@@", DATA.sub("", text))
        self.assertNotIn("\r", text)

    def test_a_text_of_a_record_cannot_break_out_of_the_page(self):
        rec = sample.record()
        rec["not_covered"].append("</script><script>alert(1)</script> & more   lines")
        self.put([sanitize.public(rec, sample.ALIASES)])
        build.build([self.runs], self.out, audience="public", built=STAMP)
        text = self.page()
        self.assertNotIn("</script><script>alert(1)", text)
        self.assertNotIn(" ", text)
        data = json.loads(DATA.search(text).group(1))
        self.assertEqual(data["records"][0]["not_covered"][-1], "</script><script>alert(1)</script> & more   lines")

    def test_a_public_site_takes_no_internal_record(self):
        self.put([self.public[0], self.internal[1]])
        with self.assertRaises(SystemExit) as caught:
            build.build([self.runs], self.out, audience="public", built=STAMP)
        self.assertIn("internal", str(caught.exception))
        self.assertFalse(os.path.exists(os.path.join(self.out, "index.html")))

    def test_a_private_word_stops_a_public_build(self):
        rec = sample.record()
        rec["not_covered"].append("ran in the zzlab room")
        self.put([sanitize.public(rec, sample.ALIASES)])
        build.build([self.runs], self.out, audience="public", built=STAMP)
        with self.assertRaises(SystemExit):
            build.build([self.runs], self.out, audience="public", built=STAMP, words=frozenset({"zzlab"}))

    def test_an_internal_page_takes_every_record(self):
        self.put([self.internal[0], self.public[1]])
        build.build([self.runs], self.out, audience="internal", built=STAMP)
        data = json.loads(DATA.search(self.page()).group(1))
        self.assertEqual(data["audience"], "internal")
        self.assertEqual({r["visibility"] for r in data["records"]}, {"internal", "public"})

    def test_the_same_records_and_stamp_give_the_same_bytes(self):
        self.put(self.public)
        build.build([self.runs], self.out, audience="public", built=STAMP)
        first = self.page()
        build.build([self.runs], self.out, audience="public", built=STAMP)
        self.assertEqual(self.page(), first)

    def test_a_record_that_left_the_registry_leaves_the_site(self):
        self.put(self.public)
        build.build([self.runs], self.out, audience="public", built=STAMP)
        os.remove(os.path.join(self.runs, self.public[0]["id"] + ".json"))
        build.build([self.runs], self.out, audience="public", built=STAMP)
        self.assertEqual(os.listdir(os.path.join(self.out, "runs")), [self.public[1]["id"] + ".json"])

    def test_the_page_is_the_internal_one_unless_a_public_one_is_asked_for(self):
        self.put(self.internal)
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(build.main([self.runs, "--out", self.out, "--built", STAMP]), 0)
        self.assertIn("2 records", out.getvalue())
        self.assertEqual(json.loads(DATA.search(self.page()).group(1))["audience"], "internal")
        with self.assertRaises(SystemExit):
            build.main([self.runs, "--out", self.out, "--built", STAMP, "--audience", "public"])

    def test_no_records_still_builds_a_page(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(build.main([self.runs, "--out", self.out, "--built", STAMP]), 0)
        self.assertEqual(json.loads(DATA.search(self.page()).group(1))["records"], [])


if __name__ == "__main__":
    unittest.main()
