"""Adding a run to the registry: where its files go and which are kept, and, with econ and a real run, the record it
gives and what a refusal leaves behind (nothing).

The second half needs ECON_SRC (the src folder of a gentic checkout at the commit of ECON_REF) and a run of the
registry to add again to an empty one."""
import contextlib
import io
import os
import shutil
import tempfile
import unittest

from tools import add, export, read_json, write_json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ECON_SRC = os.environ.get("ECON_SRC")
GROUP, NAME = "2026-11-17_h200", "s0-tp8-v0.34"
RUN = os.path.join(ROOT, "sources", GROUP, NAME)
PRICES = os.path.join(ROOT, "sources", GROUP, "prices_deepseek-v4.1-flash_2026-11-18.json")
ID = "2026-11-17_s0-tp8-v0.34_cdca8947"
REAL = bool(ECON_SRC) and os.path.isdir(RUN)


class Tmp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def path(self, *parts):
        path = os.path.join(self.tmp.name, *parts)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        return path

    def text(self, text, *parts):
        with open(self.path(*parts), "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        return os.path.join(self.tmp.name, *parts)


class TestPieces(Tmp):
    def run_dir(self, stability=True):
        measure = {"label": "My Run_tp4", "created": "2026-12-01T10:00:00", "gpu_info": [{"name": "NVIDIA H200"}]}
        write_json(self.path("run", "measure", "measure.json"), dict(measure, **({"stability": {"verdict": "PASS"}} if stability else {})))
        write_json(self.path("run", "check", "check.json"), {})
        self.text("job=1\n", "run", "provenance.txt")
        self.text("t,index,power_w\n", "run", "measure", "power.csv")
        self.text("a long log\n", "run", "server.log")
        return os.path.join(self.tmp.name, "run")

    def test_a_run_goes_under_the_day_and_the_gpu_of_its_measurement(self):
        measure = {"label": "My Run_tp4", "created": "2026-12-01T10:00:00", "gpu_info": [{"name": "NVIDIA RTX A5000"}]}
        self.assertEqual(add.place(measure), ("2026-12-01_rtx-a5000", "my-run-tp4"))
        self.assertEqual(add.place(measure, group="lab-day", name="first"), ("lab-day", "first"))
        self.assertEqual(add.place({"label": "x", "created": "2026-12-01T10:00:00"})[0], "2026-12-01_gpu")

    def test_only_what_the_exporter_reads_is_kept(self):
        files, inside = add.gather(self.run_dir())
        kept = sorted(rel.replace(os.sep, "/") for _, rel in files)
        self.assertEqual(kept, ["check/check.json", "measure/measure.json", "provenance.txt"])
        self.assertIsNone(inside)
        files, _ = add.gather(self.run_dir(stability=False))  # an older econ: its stability is read from power.csv
        self.assertIn("measure/power.csv", [rel.replace(os.sep, "/") for _, rel in files])

    def test_the_price_list_goes_next_to_the_run_or_stays_where_it_is_inside_it(self):
        run = self.run_dir()
        outside = self.text("{}", "elsewhere", "prices_model_2026-12-01.json")
        files, inside = add.gather(run, outside)
        self.assertEqual(inside, "prices_model_2026-12-01.json")
        self.assertIn((outside, inside), files)
        report = self.text("{}", "run", "report", "report.json")
        files, inside = add.gather(run, report)
        self.assertEqual(inside.replace(os.sep, "/"), "report/report.json")
        with self.assertRaises(SystemExit):
            add.gather(run, os.path.join(self.tmp.name, "no-such.json"))

    def test_a_folder_without_a_measurement_is_refused(self):
        os.makedirs(self.path("empty", "x"))
        with self.assertRaises(SystemExit):
            add.gather(os.path.join(self.tmp.name, "empty"))

    def test_the_econ_must_be_the_one_the_registry_exports_with(self):
        class Econ:
            commit = "a" * 40
        reg = os.path.dirname(self.text("b" * 40 + "\n", "reg", "ECON_REF"))
        with self.assertRaises(SystemExit) as caught:
            add.pinned(reg, Econ, False)
        self.assertIn("bbbbbbbbbb (ECON_REF), and --econ-src is aaaaaaaaaa", str(caught.exception))
        add.pinned(reg, Econ, True)                                    # allowed by its option
        add.pinned(os.path.dirname(self.path("bare", "x")), Econ, False)  # a registry with no pin
        Econ.commit = "b" * 40
        add.pinned(reg, Econ, False)
        Econ.commit = None
        with self.assertRaises(SystemExit) as caught:
            add.pinned(reg, Econ, False)
        self.assertIn("not a git checkout", str(caught.exception))


@unittest.skipUnless(REAL, "needs ECON_SRC (the src folder of a gentic checkout) and the registry's run of 17 Nov")
class TestRealRun(Tmp):
    @classmethod
    def setUpClass(cls):
        cls.econ = export.Econ(ECON_SRC)
        cls.options = {k: v for k, v in read_json(os.path.join(RUN, "export.json")).items() if k not in ("prices", "note")}

    def setUp(self):
        super().setUp()
        self.reg = os.path.join(self.tmp.name, "registry")
        os.makedirs(self.reg)
        shutil.copyfile(os.path.join(ROOT, "ECON_REF"), os.path.join(self.reg, "ECON_REF"))

    def left(self):
        return sorted(os.path.relpath(os.path.join(root, n), self.reg).replace(os.sep, "/")
                      for root, _, names in os.walk(self.reg) for n in names)

    def test_adding_a_run_gives_the_registrys_own_record(self):
        dest, path, rec = add.add(RUN, self.reg, self.econ, self.options, prices=PRICES, note="added by the test")
        self.assertEqual(rec, read_json(os.path.join(ROOT, "runs", ID + ".json")))
        self.assertEqual(read_json(path), rec)
        self.assertEqual(self.left(), ["ECON_REF", f"runs/{ID}.json"] + [f"sources/{GROUP}/{NAME}/{n}" for n in (
            "accuracy/accuracy.json", "check/check.json", "export.json", "measure/measure.json",
            "prices_deepseek-v4.1-flash_2026-11-18.json", "provenance.txt")])
        for rel in ("measure/measure.json", "check/check.json", "accuracy/accuracy.json", "provenance.txt"):
            with open(os.path.join(RUN, rel), "rb") as a, open(os.path.join(dest, rel), "rb") as b:
                self.assertEqual(a.read(), b.read(), rel)
        self.assertEqual(read_json(os.path.join(dest, "export.json")),
                         dict(self.options, prices="prices_deepseek-v4.1-flash_2026-11-18.json", note="added by the test"))
        before = self.left()
        with self.assertRaises(SystemExit) as caught:  # the same folder again
            add.add(RUN, self.reg, self.econ, self.options, prices=PRICES)
        self.assertIn("already in the registry", str(caught.exception))
        with self.assertRaises(SystemExit) as caught:  # the same measurement under another name
            add.add(RUN, self.reg, self.econ, self.options, prices=PRICES, name="again")
        self.assertIn("this run is already in the registry", str(caught.exception))
        self.assertEqual(self.left(), before)

    def test_a_run_that_does_not_validate_leaves_nothing_behind(self):
        run = os.path.join(self.tmp.name, "run")
        shutil.copytree(RUN, run)
        with open(os.path.join(run, "provenance.txt"), "a", encoding="utf-8") as f:
            f.write("token=ghp_abcdefghijklmnopqrstuvwx\n")
        with self.assertRaises(SystemExit) as caught:
            add.add(run, self.reg, self.econ, self.options, prices=PRICES)
        self.assertIn("no file of the registry may hold a secret", str(caught.exception))
        self.assertNotIn("ghp_abc", str(caught.exception))
        self.assertEqual(self.left(), ["ECON_REF"])
        self.assertEqual(os.listdir(os.path.join(self.reg, "sources")), [])

    def test_the_command_says_what_to_do_next(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = add.main([RUN, "--econ-src", ECON_SRC, "--registry", self.reg, "--prices", PRICES, "--rent", "5.29",
                             "--rent", "3.59", "--cluster", "HPE", "--econ-commit", "31ea28b"])
        self.assertEqual(code, 0)
        text = out.getvalue()
        self.assertIn(f"git switch -c runs/{ID}", text)
        self.assertIn(f"git add sources/{GROUP}/{NAME} runs/{ID}.json", text)
        self.assertEqual(read_json(os.path.join(self.reg, "runs", ID + ".json")), read_json(os.path.join(ROOT, "runs", ID + ".json")))


if __name__ == "__main__":
    unittest.main()
