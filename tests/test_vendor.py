"""The files copied from econ stay as they were copied."""
import os
import shutil
import tempfile
import unittest

from tools import vendor


class TestVendor(unittest.TestCase):
    def test_the_vendored_files_are_the_pinned_ones(self):
        self.assertEqual(vendor.check(), [])

    def test_an_edit_a_missing_file_and_an_extra_file_are_found(self):
        with tempfile.TemporaryDirectory() as tmp:
            web = os.path.join(tmp, "web")
            shutil.copytree(vendor.WEB, web)
            with open(os.path.join(web, "vendor", "math.js"), "a", encoding="utf-8") as f:
                f.write("// a local fix\n")
            os.remove(os.path.join(web, "vendor", "shell.css"))
            with open(os.path.join(web, "vendor", "extra.js"), "w", encoding="utf-8") as f:
                f.write("")
            problems = vendor.check(web)
            self.assertEqual(len(problems), 3)
            self.assertTrue(any("math.js: edited here" in p for p in problems))
            self.assertTrue(any("shell.css: missing" in p for p in problems))
            self.assertTrue(any("extra.js: not in VENDORED.json" in p for p in problems))


if __name__ == "__main__":
    unittest.main()
