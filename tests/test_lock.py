"""The lock of the page: the key, what a locked page holds and what it does not, the command, and the browser's own
code opening what the build sealed.

The last test runs web/lock.js under node, where WebCrypto is the one a browser has: it needs node, which CI has.
Without node it is skipped, and fails where CI is set."""
import contextlib
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest

from tests import sample
from tools import build, lock, write_json

HERE = os.path.dirname(os.path.abspath(__file__))
KEY, OTHER = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFG", "zyxwvutsrqponmlkjihgfedcba9876543210-_ZYXWV"
PAGE = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>inside</title></head>\n'
        '<body><p>registry: sith2 served 8,210 tok/s, “quoted”, señal</p>\n<script>window.inside = 1;</script>\n</body></html>\n')


class TestKey(unittest.TestCase):
    def test_a_new_key_is_43_characters_that_go_in_a_link_and_never_the_same(self):
        keys = {lock.new_key() for _ in range(20)}
        self.assertEqual(len(keys), 20)
        for key in keys:
            self.assertTrue(lock.KEY.fullmatch(key), key)
            self.assertEqual(len(lock.key_bytes(key)), 32)

    def test_what_is_not_a_key_is_refused(self):
        for text in ("", None, "short", KEY[:-1], KEY + "a", KEY[:-1] + "+", KEY[:-1] + "/", KEY[:20] + " " + KEY[21:]):
            with self.subTest(text), self.assertRaises(ValueError):
                lock.key_bytes(text)
        self.assertEqual(lock.key_bytes("  " + KEY + "\n"), lock.key_bytes(KEY))


class TestLock(unittest.TestCase):
    def test_a_locked_page_opens_with_its_key_and_only_with_it(self):
        locked = lock.lock(PAGE, KEY)
        self.assertEqual(lock.unlock(locked, KEY), PAGE)
        with self.assertRaises(ValueError):
            lock.unlock(locked, OTHER)
        iv, sealed = lock.SEALED.search(locked).group(2, 3)
        changed = locked.replace(sealed, sealed[:40] + ("A" if sealed[40] != "A" else "B") + sealed[41:])
        with self.assertRaises(ValueError):
            lock.unlock(changed, KEY)
        with self.assertRaises(ValueError):
            lock.unlock(locked.replace(iv, iv[:-1] + ("A" if iv[-1] != "A" else "B")), KEY)
        with self.assertRaises(ValueError):
            lock.unlock(PAGE, KEY)  # not a locked page at all

    def test_nothing_of_the_page_can_be_read_in_the_locked_one(self):
        locked = lock.lock(PAGE * 50, KEY)
        for needle in ("sith2", "8,210", "registry", "inside", "señal", KEY):
            self.assertNotIn(needle, locked, needle)
        self.assertLess(len(lock.SEALED.search(locked).group(3)), len(PAGE) * 50 // 4)  # compressed before it is sealed

    def test_the_locked_page_is_one_file_that_fetches_nothing(self):
        locked = lock.lock(PAGE, KEY, title="A <title> & more")
        self.assertIn("<title>A &lt;title&gt; &amp; more</title>", locked)
        text = lock.SEALED.sub("", locked)
        for needle in ("<link", "<img", "<iframe", " src=", "@import", "fetch(", "XMLHttpRequest", "import(", "sendBeacon", "@@"):
            self.assertNotIn(needle, text, needle)
        self.assertEqual(re.findall(r"url\((?!#)", text), [])
        self.assertEqual(set(re.findall(r'href="([^"]+)"', text)), {"https://krai.ai"})
        self.assertIn('name="robots" content="noindex, nofollow"', text)
        self.assertNotIn("\r", locked)

    def test_two_locks_of_one_page_differ_and_a_given_iv_repeats(self):
        self.assertNotEqual(lock.lock(PAGE, KEY), lock.lock(PAGE, KEY))
        self.assertEqual(lock.lock(PAGE, KEY, iv=bytes(12)), lock.lock(PAGE, KEY, iv=bytes(12)))


class TestCommand(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.page = os.path.join(self.tmp.name, "site", "index.html")
        os.makedirs(os.path.dirname(self.page))
        with open(self.page, "w", encoding="utf-8", newline="") as f:
            f.write(PAGE)
        self.locked = os.path.join(self.tmp.name, "locked", "index.html")
        saved = os.environ.pop(lock.ENV, None)
        self.addCleanup(lambda: os.environ.__setitem__(lock.ENV, saved) if saved is not None else os.environ.pop(lock.ENV, None))

    def run_main(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = lock.main(list(args))
        return code, out.getvalue()

    def read(self, path):
        with open(path, encoding="utf-8", newline="") as f:
            return f.read()

    def test_it_locks_with_the_environments_key_and_opens_again(self):
        os.environ[lock.ENV] = KEY
        code, out = self.run_main(self.page, "--out", self.locked)
        self.assertEqual(code, 0, out)
        self.assertNotIn(KEY, out)
        self.assertEqual(lock.unlock(self.read(self.locked), KEY), PAGE)
        back = os.path.join(self.tmp.name, "back.html")
        self.assertEqual(self.run_main(self.locked, "--open", "--out", back)[0], 0)
        self.assertEqual(self.read(back), PAGE)
        os.environ[lock.ENV] = OTHER
        code, out = self.run_main(self.locked, "--open", "--out", back)
        self.assertEqual(code, 1)
        self.assertEqual(self.read(back), PAGE)  # a refusal writes nothing

    def test_the_key_comes_from_a_file_or_the_environment_and_never_from_the_command_line(self):
        with self.assertRaises(SystemExit) as caught:
            self.run_main(self.page, "--out", self.locked)
        self.assertIn(lock.ENV, str(caught.exception))
        os.environ[lock.ENV] = "not a key"
        with self.assertRaises(SystemExit):
            self.run_main(self.page, "--out", self.locked)
        del os.environ[lock.ENV]
        key_file = os.path.join(self.tmp.name, "key")
        with open(key_file, "w", encoding="utf-8") as f:
            f.write(KEY + "\n")
        self.assertEqual(self.run_main(self.page, "--out", self.locked, "--key-file", key_file)[0], 0)
        self.assertEqual(lock.unlock(self.read(self.locked), KEY), PAGE)
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            lock.main([self.page, "--out", self.locked, "--key", KEY])  # there is no such option

    def test_a_new_key_is_printed_alone(self):
        code, out = self.run_main("--new-key")
        self.assertEqual(code, 0)
        self.assertTrue(lock.KEY.fullmatch(out.strip()), out)


class TestBrowser(unittest.TestCase):
    def test_the_pages_own_code_opens_what_the_build_sealed(self):
        node = shutil.which("node")
        if not node:
            if os.environ.get("CI"):
                self.fail("node is needed to check the page's lock, and CI has none")
            self.skipTest("needs node (CI has it): it runs the page's lock with the WebCrypto a browser has")
        with tempfile.TemporaryDirectory() as tmp:
            runs = os.path.join(tmp, "runs")
            os.makedirs(runs)
            for rec in (sample.record(), sample.record(label="sample-tp4", gpus=4)):
                write_json(os.path.join(runs, rec["id"] + ".json"), rec)
            build.build([runs], os.path.join(tmp, "site"), audience="internal", built="2026-01-06T00:00Z")
            with open(os.path.join(tmp, "site", "index.html"), encoding="utf-8", newline="") as f:
                page = f.read()  # the whole built page: a few hundred kilobytes
            _, iv, sealed = lock.SEALED.search(lock.lock(page, KEY)).groups()
            link = "https://krai.github.io/somewhere/"
            path = os.path.join(tmp, "input.json")
            write_json(path, {
                "format": lock.FORMAT, "page": page, "key": KEY, "iv": iv, "sealed": sealed, "other_key": OTHER,
                "other_iv": iv[:-1] + ("A" if iv[-1] != "A" else "B"),
                "changed": sealed[:100] + ("A" if sealed[100] != "A" else "B") + sealed[101:],
                "keys": [[link + "#k=" + KEY, KEY], ["#at=runs&k=" + KEY + "&run=x", KEY], ["#k=" + KEY + "&at=runs", KEY],
                         [KEY, KEY], ["  " + KEY + "\n", KEY], [link + "#k=" + KEY[:-1], None], [link, None], ["", None],
                         ["#at=runs&run=" + KEY, None], [KEY + "a", None], ["#k=" + KEY + "a", None]]})
            done = subprocess.run([node, os.path.join(HERE, "lock_check.js"), path], capture_output=True, text=True,
                                  timeout=120, encoding="utf-8")
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        summary = json.loads(done.stdout)
        self.assertEqual(summary["bad"], [])
        self.assertEqual(summary["characters"], len(page.encode("utf-16-le")) // 2)  # as JavaScript counts them


if __name__ == "__main__":
    unittest.main()
