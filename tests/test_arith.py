"""econ's arithmetic, re-computed from a record's own numbers."""
import unittest

from tests import sample
from tools import arith


class TestArith(unittest.TestCase):
    def test_the_formulas(self):
        self.assertAlmostEqual(arith.revenue(8000, 2000, 0.3, 1.2, 4), (8000 * 0.3 + 2000 * 1.2) / 1e6 * 3600 / 4)
        self.assertAlmostEqual(arith.break_even(3.59, 7.18), 0.5)
        self.assertIsNone(arith.break_even(1.0, 0.0))
        self.assertAlmostEqual(arith.cost_per_million(5.29, 4, 2500, 0.5), 5.29 * 4 / (2500 * 3600 * 0.5) * 1e6)
        self.assertIsNone(arith.cost_per_million(1.0, 1, 0.0))
        self.assertAlmostEqual(arith.margin(2.0, 5.0, 0.7), 1.5)

    def test_percentiles_interpolate(self):
        self.assertEqual(arith.pct([4, 1, 3, 2], 50), 2.5)
        self.assertEqual(arith.pct([1, 2, 3], 0), 1)
        self.assertEqual(arith.pct([1, 2, 3], 100), 3)
        self.assertIsNone(arith.pct([], 50))

    def test_a_consistent_record_checks_every_priced_value(self):
        checked, bad = arith.check(sample.record())
        self.assertEqual(bad, [])
        # per met point: the common revenue, the endpoints priced, five quartiles; per rent two break-evens, the
        # endpoints above it, three margins and three costs; then the 30-day tokens and, per rent, the node and two costs
        self.assertEqual(checked, 2 * (1 + 1 + 5 + 2 * (2 + 1 + 3 + 3) + 1 + 2 * (1 + 2)))

    def test_an_edited_number_is_found(self):
        rec = sample.record()
        rec["points"][0]["worth"]["common"]["revenue"] *= 1.01
        rec["points"][1]["cost"][0]["node_30d"] += 1
        _, bad = arith.check(rec)
        self.assertEqual(len(bad), 2)
        self.assertIn("revenue at the most common price", bad[0])

    def test_another_snapshot_than_the_one_priced_with_is_found(self):
        rec = sample.record()
        rec["prices"]["by_endpoint"][0]["output"] = 9.0
        self.assertTrue(arith.check(rec)[1])


if __name__ == "__main__":
    unittest.main()
