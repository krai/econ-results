"""The page's arithmetic against econ's numbers.

Three links of one chain, each checked where it can be:
- econ's own same-speed rule gives the values of tests/golden/same_speed.json (needs ECON_SRC; `python -m
  tests.test_web --write` writes the file again from econ);
- the Python check (tools/arith.py) gives the same values, always;
- the page's own JavaScript (web/vendor/math.js and web/regmath.js) gives them too, and reproduces every priced number
  of the sample records: needs node, which CI has. Without node the test is skipped, and fails where CI is set.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from tests import sample
from tools import arith, read_json, write_json

HERE = os.path.dirname(os.path.abspath(__file__))
GOLDEN = os.path.join(HERE, "golden", "same_speed.json")
ECON_SRC = os.environ.get("ECON_SRC")
CURVES = ([(20.0, 500.0), (35.0, 420.0), (61.25, 300.5), (130.0, 90.0)], [(15.0, 700.0), (33.0, 480.0)],
          [(78.0, 265.85), (34.9, 626.4), (43.5, 526.1)], [(10.0, 100.0)], [(40.0, 3.5), (60.0, 2.1), (119.9, 1.0), (240.1, 0.4)])
SPEEDS = (5.0, 15.0, 20.0, 27.5, 33.0, 34.9, 40.0, 50.0, 61.25, 78.0, 100.0, 119.9, 130.0, 200.0, 240.1, 300.0)


def cases(at_speed, span):
    """Every curve read at every speed by `at_speed`: the cases of the golden file."""
    out = []
    for curve in CURVES:
        pts = sorted(curve)
        out += [{"points": [list(p) for p in pts], "speed": s, "expect": at_speed(pts, s)} for s in SPEEDS]
    return {"span": span, "cases": out}


def from_econ():
    sys.path.insert(0, os.path.abspath(ECON_SRC))
    from econ import report
    return cases(report.at_speed, report.SPEED_SPAN)


class TestSameSpeed(unittest.TestCase):
    def test_the_python_check_gives_the_golden_values(self):
        self.assertEqual(cases(arith.at_speed, arith.SPEED_SPAN), read_json(GOLDEN))

    def test_the_golden_values_cover_the_rule(self):
        got = [c["expect"] for c in read_json(GOLDEN)["cases"]]
        self.assertTrue(any(e is None for e in got))                      # outside the points, or too far apart
        self.assertTrue(any(e and e[1] for e in got))                      # measured
        self.assertTrue(any(e and not e[1] for e in got))                  # on the line between two points

    @unittest.skipUnless(ECON_SRC, "needs ECON_SRC (the src folder of a gentic checkout)")
    def test_the_golden_values_are_econs(self):
        self.assertEqual(from_econ(), read_json(GOLDEN))


class TestPage(unittest.TestCase):
    def test_the_pages_javascript_gives_econs_numbers(self):
        node = shutil.which("node")
        if not node:
            if os.environ.get("CI"):
                self.fail("node is needed to check the page's arithmetic, and CI has none")
            self.skipTest("needs node (CI has it); the same values are checked in Python by test_arith and above")
        records = [sample.record(), sample.record(label="sample-tp8", gpus=8, scale=1.7, created="2026-01-07T09:30:00"),
                   sample.record(label="sample-miss", targets=(), missed=(50, 10))]
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "input.json")
            write_json(path, {"records": records, "counts": [arith.check(r)[0] for r in records], "golden": read_json(GOLDEN)})
            done = subprocess.run([node, os.path.join(HERE, "web_check.js"), path], capture_output=True, text=True, timeout=120)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        summary = json.loads(done.stdout)
        self.assertEqual(summary["bad"], [])
        self.assertEqual(summary["checked"], sum(arith.check(r)[0] for r in records))
        self.assertGreater(summary["priced"], 0)


if __name__ == "__main__":
    if sys.argv[1:] == ["--write"]:
        os.makedirs(os.path.dirname(GOLDEN), exist_ok=True)
        write_json(GOLDEN, from_econ())
        print(f"{GOLDEN}: {len(read_json(GOLDEN)['cases'])} cases from econ")
    else:
        unittest.main()
