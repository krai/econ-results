"""Prepare the public record of a run on a branch of this repository, from the private registry.

    python -m tools.publish --runs ../econ-runs ID [ID ...] [--branch runs/NAME] [--base main] [--dry-run]

For each id it reads the registry's internal record (runs/ID.json) and its public form (public/ID.json), and refuses
unless all of this holds:
- the registry has a public form of the run at all: no public/ID.json means the run is not cleared to be public;
- the public form is exactly what tools/sanitize.py makes of the internal record today (nobody edited one of the two);
- it validates as a public record, with the registry's own private word list on top of the patterns.
Then it commits the public form as runs/ID.json on a branch, one commit per record, with the identity of this
repository's git configuration, and returns to the branch it started on.

It never pushes and never commits to the base branch: the push and the pull request are separate steps that a person
takes after reading the branch.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import subprocess
import sys

from . import patterns, read_json, sanitize, validate, write_json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Refused(Exception):
    """A record that must not be published as it is."""


def git(repo, *args, check=True):
    done = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)
    if check and done.returncode:
        raise Refused(f"git {' '.join(args)}: {done.stderr.strip() or done.stdout.strip()}")
    return done.stdout.strip()


def public_form(registry, run_id):
    """The public form of a run, checked against the registry's internal record."""
    internal, twin = os.path.join(registry, "runs", run_id + ".json"), os.path.join(registry, "public", run_id + ".json")
    if not os.path.isfile(internal):
        raise Refused(f"{run_id}: the registry has no such run (runs/{run_id}.json)")
    if not os.path.isfile(twin):
        raise Refused(f"{run_id}: not cleared to be public (the registry has no public/{run_id}.json)")
    words_path = os.path.join(registry, "private-words.txt")
    words = patterns.load_words(words_path) if os.path.isfile(words_path) else frozenset()
    aliases = read_json(os.path.join(registry, "aliases.json"))
    pub = read_json(twin)
    try:
        again = sanitize.public(read_json(internal), aliases, words)
    except sanitize.Forbidden as e:
        raise Refused(str(e)) from None
    if again != pub:
        raise Refused(f"{run_id}: public/{run_id}.json is not what sanitising runs/{run_id}.json gives today: "
                      "export the run again, or look at what was edited")
    problems = validate.check_record(pub, twin, public=True, words=words)
    if problems:
        raise Refused(f"{run_id}: the public form does not validate:\n  " + "\n  ".join(problems))
    return pub


def message(rec, sha):
    met = sum(1 for p in rec["points"] if p["met"])
    engine = " ".join(str(x) for x in (rec["engine"]["name"], rec["engine"]["version"] or rec["engine"]["build"]) if x)
    return (f"runs: add {rec['id']}",
            f"{rec['config']['label']} ({rec['config']['family']}) of {rec['model']['id']} on {rec['hardware']['gpus']} x "
            f"{rec['hardware']['gpu']}, {engine}, measured {rec['created'][:10]} with econ {rec['econ']['version']}: "
            f"{met} of {len(rec['points'])} latency targets met.\n\n"
            f"The public form of the registry's record, as tools/sanitize.py writes it. sha256 {sha}")


def publish(registry, ids, repo=ROOT, branch=None, base="main", dry_run=False, log=print):
    """Commit the public forms of `ids` on `branch`; returns the branch and the commits made."""
    records = [public_form(registry, run_id) for run_id in ids]  # every check before anything is written
    if dry_run:
        for rec in records:
            log(f"{rec['id']}: ready to publish")
        return branch, []
    if git(repo, "status", "--porcelain"):
        raise Refused("the working tree of this repository has changes: commit or stash them first")
    if not git(repo, "config", "user.name", check=False) or not git(repo, "config", "user.email", check=False):
        raise Refused("git has no user.name and user.email here: set them, the commits are made with them")
    start = git(repo, "rev-parse", "--abbrev-ref", "HEAD")
    branch = branch or (f"runs/{ids[0]}" if len(ids) == 1 else None)
    if not branch:
        raise Refused("several runs need a name for their branch: --branch runs/NAME")
    if branch == base:
        raise Refused(f"records are never committed to {base}: they reach it through a pull request")
    exists = git(repo, "rev-parse", "--verify", "--quiet", "refs/heads/" + branch, check=False)
    git(repo, "switch", branch) if exists else git(repo, "switch", "-c", branch, base)
    commits = []
    try:
        for rec in records:
            path = os.path.join(repo, "runs", rec["id"] + ".json")
            if os.path.isfile(path) and read_json(path) == rec:
                log(f"{rec['id']}: already on {branch}")
                continue
            os.makedirs(os.path.dirname(path), exist_ok=True)
            write_json(path, rec)
            with open(path, "rb") as f:
                sha = hashlib.sha256(f.read()).hexdigest()
            subject, body = message(rec, sha)
            git(repo, "add", "--", os.path.join("runs", rec["id"] + ".json"))
            git(repo, "commit", "-q", "-m", subject, "-m", body)
            commits.append(git(repo, "rev-parse", "--short", "HEAD"))
            log(f"{rec['id']}: committed on {branch} as {commits[-1]}")
    finally:
        git(repo, "switch", start)
    return branch, commits


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m tools.publish",
                                 description="Commit the public form of registry runs on a branch; never pushes.")
    ap.add_argument("ids", nargs="+", help="the ids of the runs")
    ap.add_argument("--runs", required=True, help="a checkout of the private registry (runs/, public/, aliases.json)")
    ap.add_argument("--branch", help="the branch to commit on (default for one run: runs/ID)")
    ap.add_argument("--base", default="main", help="the branch a new branch starts from (default: main)")
    ap.add_argument("--dry-run", action="store_true", help="check the runs and commit nothing")
    a = ap.parse_args(argv)
    try:
        branch, commits = publish(a.runs, a.ids, branch=a.branch, base=a.base, dry_run=a.dry_run)
    except Refused as e:
        print(f"refused: {e}")
        return 1
    if not a.dry_run:
        print(f"{len(commits)} commit(s) on {branch}; nothing was pushed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
