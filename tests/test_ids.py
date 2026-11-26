"""A run's id and the JSON files the tools write."""
import os
import tempfile
import unittest

from tools import read_json, run_id, slug, write_json


class TestIds(unittest.TestCase):
    def test_an_id_is_the_date_the_label_and_eight_hex_digits(self):
        rid = run_id("recipe-tp4-v0.34", "2026-11-17T20:59:05", "org/Model", 4)
        self.assertRegex(rid, r"^2026-11-17_recipe-tp4-v0\.34_[0-9a-f]{8}$")

    def test_the_same_run_keeps_its_id_and_another_run_gets_another(self):
        a = run_id("cfg", "2026-01-05T10:00:00", "org/Model", 4)
        self.assertEqual(a, run_id("cfg", "2026-01-05T10:00:00", "org/Model", 4))
        for other in (run_id("cfg", "2026-01-05T10:00:01", "org/Model", 4),
                      run_id("cfg", "2026-01-05T10:00:00", "org/M2", 4),
                      run_id("cfg", "2026-01-05T10:00:00", "org/Model", 8)):
            self.assertNotEqual(a, other)

    def test_a_label_becomes_safe_for_a_file_name(self):
        self.assertEqual(slug("My Config/TP8 (v2)"), "my-config-tp8-v2")
        self.assertEqual(slug("///"), "run")

    def test_json_files_end_lines_with_lf_on_every_platform(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "x.json")
            write_json(path, {"a": [1, 2], "text": "≤ 50 ms"})
            with open(path, "rb") as f:
                data = f.read()
            self.assertNotIn(b"\r", data)
            self.assertTrue(data.endswith(b"\n"))
            self.assertEqual(read_json(path), {"a": [1, 2], "text": "≤ 50 ms"})


if __name__ == "__main__":
    unittest.main()
