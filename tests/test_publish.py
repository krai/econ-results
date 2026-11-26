"""Preparing a public record on a branch: what is committed, and everything that refuses."""
import os
import subprocess
import tempfile
import unittest

from tests import sample
from tools import publish, read_json, sanitize, write_json


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=True).stdout.strip()


class TestPublish(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo, self.reg = os.path.join(self.tmp.name, "site"), os.path.join(self.tmp.name, "registry")
        os.makedirs(self.repo)
        subprocess.run(["git", "init", "-q", "-b", "main", self.repo], check=True)
        for key, value in (("user.name", "tester"), ("user.email", "tester@example.invalid"), ("core.autocrlf", "false")):
            git(self.repo, "config", key, value)
        with open(os.path.join(self.repo, "README.md"), "w", encoding="utf-8") as f:
            f.write("site\n")
        git(self.repo, "add", "README.md")
        git(self.repo, "commit", "-q", "-m", "repo: start")
        self.recs = [sample.record(), sample.record(label="sample-tp4", gpus=4), sample.record(label="kept-private")]
        for folder in ("runs", "public"):
            os.makedirs(os.path.join(self.reg, folder))
        write_json(os.path.join(self.reg, "aliases.json"), sample.ALIASES)
        with open(os.path.join(self.reg, "private-words.txt"), "w", encoding="utf-8") as f:
            f.write("zzlab\n")
        for i, rec in enumerate(self.recs):
            write_json(os.path.join(self.reg, "runs", rec["id"] + ".json"), rec)
            if i < 2:  # the third run is not cleared to be public
                write_json(os.path.join(self.reg, "public", rec["id"] + ".json"), sanitize.public(rec, sample.ALIASES))
        self.ids = [r["id"] for r in self.recs]
        self.log = []

    def publish(self, ids, **kw):
        return publish.publish(self.reg, ids, repo=self.repo, log=self.log.append, **kw)

    def test_one_commit_per_record_on_a_branch_and_main_untouched(self):
        main = git(self.repo, "rev-parse", "main")
        branch, commits = self.publish(self.ids[:2], branch="runs/first")
        self.assertEqual((branch, len(commits)), ("runs/first", 2))
        self.assertEqual(git(self.repo, "rev-parse", "main"), main)
        self.assertEqual(git(self.repo, "rev-parse", "--abbrev-ref", "HEAD"), "main")
        subjects = git(self.repo, "log", "--format=%s", "main..runs/first").splitlines()
        self.assertEqual(subjects, [f"runs: add {self.ids[1]}", f"runs: add {self.ids[0]}"])
        self.assertEqual(git(self.repo, "log", "--format=%an <%ae>", "-1", "runs/first"), "tester <tester@example.invalid>")
        shown = git(self.repo, "show", f"runs/first:runs/{self.ids[0]}.json")
        with open(os.path.join(self.reg, "public", self.ids[0] + ".json"), encoding="utf-8") as f:
            self.assertEqual(shown, f.read().rstrip("\n"))
        body = git(self.repo, "log", "--format=%B", "-1", "runs/first")
        self.assertIn("latency targets met", body)
        self.assertNotIn("buildhost7", git(self.repo, "log", "-p", "main..runs/first"))

    def test_one_run_names_its_own_branch_and_again_changes_nothing(self):
        branch, commits = self.publish(self.ids[:1])
        self.assertEqual((branch, len(commits)), ("runs/" + self.ids[0], 1))
        _, again = self.publish(self.ids[:1])
        self.assertEqual(again, [])
        self.assertIn("already on", self.log[-1])

    def test_a_dry_run_commits_nothing(self):
        self.publish(self.ids[:2], branch="runs/first", dry_run=True)
        self.assertEqual(git(self.repo, "branch", "--list", "runs/*"), "")

    def refused(self, ids, why, **kw):
        with self.assertRaises(publish.Refused) as caught:
            self.publish(ids, **kw)
        self.assertIn(why, str(caught.exception))
        self.assertEqual(git(self.repo, "branch", "--list", "runs/*"), "")
        self.assertEqual(git(self.repo, "rev-parse", "--abbrev-ref", "HEAD"), "main")

    def test_a_run_that_is_not_cleared_is_refused_and_so_are_the_runs_with_it(self):
        self.refused(self.ids, "not cleared to be public", branch="runs/all")

    def test_an_unknown_run_is_refused(self):
        self.refused(["2026-01-05_nothing_00000000"], "no such run")

    def test_an_edited_public_form_is_refused(self):
        path = os.path.join(self.reg, "public", self.ids[0] + ".json")
        rec = read_json(path)
        rec["points"][0]["rate_rps"] = 99.0
        write_json(path, rec)
        self.refused(self.ids[:1], "is not what sanitising")

    def test_a_private_word_in_the_run_is_refused(self):
        path = os.path.join(self.reg, "runs", self.ids[0] + ".json")
        rec = read_json(path)
        rec["not_covered"].append("measured in the zzlab room")
        write_json(path, rec)
        self.refused(self.ids[:1], "not safe to publish")

    def test_a_dirty_tree_several_runs_without_a_branch_and_the_base_branch_are_refused(self):
        self.refused(self.ids[:2], "need a name for their branch")
        self.refused(self.ids[:1], "never committed to main", branch="main")
        with open(os.path.join(self.repo, "README.md"), "a", encoding="utf-8") as f:
            f.write("an edit\n")
        self.refused(self.ids[:1], "has changes")


if __name__ == "__main__":
    unittest.main()
