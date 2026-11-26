"""The validator: format, ranges, ids, arithmetic, and what a public record must not hold."""
import contextlib
import io
import os
import tempfile
import unittest

from tests import sample
from tools import run_id, sanitize, validate, write_json


def problems(rec, **kw):
    return validate.check_record(rec, **kw)


class TestRecord(unittest.TestCase):
    def test_the_sample_passes_in_both_forms(self):
        rec = sample.record()
        self.assertEqual(problems(rec), [])
        self.assertEqual(problems(sanitize.public(rec, sample.ALIASES), public=True), [])

    def test_ranges_a_schema_cannot_say(self):
        def edit(change):
            rec = sample.record()
            change(rec)
            return problems(rec)
        cases = {
            "percentiles out of order": lambda r: r["points"][0].update(p50_tpot_ms=99.0),
            "a met target without its rate": lambda r: r["points"][0].update(rate_rps=None),
            "more power than the boards' limit": lambda r: r["points"][0].update(node_power_w=5000.0, tok_per_j=None),
            "tokens per joule that are not tokens over watts": lambda r: r["points"][0].update(tok_per_j=9.0),
            "an interval that does not hold its value": lambda r: r["points"][0]["pooled"].update(p99_tpot_ci_ms=[1.0, 2.0]),
            "more correct answers than items": lambda r: r["health"]["accuracy"].update(correct=60),
            "an accuracy outside its interval": lambda r: r["health"]["accuracy"].update(ci95=[0.1, 0.2]),
            "a point on other GPUs than the hardware": lambda r: r["points"][0].update(gpus=4),
            "a point of another configuration": lambda r: r["points"][0].update(config="other"),
            "a result that disagrees with its point": lambda r: r["results"][0].update(met=False),
            "a result with another target than its point": lambda r: r["results"][0]["slo"].update(tpot_p99_ms=40.0),
            "fewer results than points": lambda r: r["results"].pop(),
        }
        for name, change in cases.items():
            with self.subTest(name):
                self.assertTrue(edit(change), name)

    def test_the_id_must_be_the_one_the_fields_give(self):
        rec = sample.record()
        rec["id"] = run_id("another", rec["created"], rec["model"]["id"], 2)
        self.assertTrue(any("$.id" in p for p in problems(rec)))

    def test_the_file_is_named_after_the_id(self):
        rec = sample.record()
        self.assertEqual(problems(rec, path=f"runs/{rec['id']}.json"), [])
        self.assertTrue(problems(rec, path="runs/latest.json"))

    def test_edited_priced_numbers_do_not_validate(self):
        rec = sample.record()
        rec["points"][0]["worth"]["rents"][0]["break_even_common"] = 0.5
        self.assertTrue(any(p.startswith("arithmetic:") for p in problems(rec)))

    def test_an_internal_record_keeps_its_provenance(self):
        rec = sample.record()
        del rec["provenance"]
        self.assertTrue(problems(rec))

    def test_an_internal_record_is_refused_where_only_public_ones_may_be(self):
        self.assertTrue(any("internal" in p for p in problems(sample.record(), public=True)))

    def test_a_public_record_with_something_private_is_refused(self):
        pub = sanitize.public(sample.record(), sample.ALIASES)
        for change in (lambda r: r["not_covered"].append("see /home/someone/notes.txt"),
                       lambda r: r["hardware"].update(node="GPU-98cb9ec0-77c1 box"),
                       lambda r: r.update(provenance={"host": "x"})):
            rec = sanitize.walk(pub, {})
            change(rec)
            self.assertTrue(problems(rec, public=True))
        self.assertTrue(problems(dict(pub, findings=[{"level": "INFO", "text": "on zzbox4"}]), public=True,
                                 words=frozenset({"zzbox"})))


class TestFolder(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def put(self, rec, name=None, folder="runs"):
        os.makedirs(os.path.join(self.tmp.name, folder), exist_ok=True)
        path = os.path.join(self.tmp.name, folder, name or rec["id"] + ".json")
        write_json(path, rec)
        return path

    def run_main(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = validate.main(list(args))
        return code, out.getvalue()

    def test_a_folder_of_good_records_passes(self):
        self.put(sample.record())
        self.put(sample.record(label="sample-tp4", gpus=4))
        code, out = self.run_main(os.path.join(self.tmp.name, "runs"))
        self.assertEqual(code, 0, out)
        self.assertIn("2 of 2 records pass", out)
        self.assertIn("priced values re-computed", out)

    def test_the_same_id_twice_is_a_problem(self):
        rec = sample.record()
        self.put(rec)
        self.put(rec, folder="runs/again")
        bad, count, _ = validate.check_all([os.path.join(self.tmp.name, "runs")])
        self.assertEqual(count, 2)
        self.assertTrue(any("is also in" in p for ps in bad.values() for p in ps))

    def test_no_records_is_an_error_unless_allowed(self):
        folder = os.path.join(self.tmp.name, "empty")
        os.makedirs(folder)
        self.assertEqual(self.run_main(folder)[0], 1)
        self.assertEqual(self.run_main(folder, "--allow-empty")[0], 0)

    def test_a_bad_record_fails_the_run_and_is_named(self):
        rec = sample.record()
        rec["points"][0]["p50_tpot_ms"] = 99.0
        path = self.put(rec)
        self.put({"not": "a record"}, name="other.json")
        with open(os.path.join(self.tmp.name, "runs", "broken.json"), "w", encoding="utf-8") as f:
            f.write("{")
        code, out = self.run_main(os.path.join(self.tmp.name, "runs"))
        self.assertEqual(code, 1)
        self.assertIn(os.path.basename(path), out)
        self.assertIn("not readable as JSON", out)
        self.assertIn("0 of 3 records pass", out)

    def test_public_only_and_a_private_word_list(self):
        pub = sanitize.public(sample.record(), sample.ALIASES)
        pub["not_covered"].append("measured in the zzlab room")
        self.put(pub, folder="public")
        words = os.path.join(self.tmp.name, "words.txt")
        with open(words, "w", encoding="utf-8") as f:
            f.write("# private\nzzlab\n")
        folder = os.path.join(self.tmp.name, "public")
        self.assertEqual(self.run_main(folder, "--public")[0], 0)
        code, out = self.run_main(folder, "--public", "--words", words)
        self.assertEqual(code, 1)
        self.assertIn("a private name", out)
        self.assertNotIn("zzlab", out.replace(folder, ""))


if __name__ == "__main__":
    unittest.main()
