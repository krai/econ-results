"""The files of econ's page that this site reuses: web/vendor/, pinned to a commit of econ by web/VENDORED.json.

    python -m tools.vendor                           check that nobody edited them: each file's SHA-256 is the pinned one
    python -m tools.vendor --econ-src GENTIC/src     copy them again from a checkout of gentic, and pin its commit

The shell (shell.js, shell.css) and the arithmetic (math.js) are econ's own: the page prices with the same code as
econ's dashboards. They are never edited in this repository; CI runs the check.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib
import os
import shutil
import sys

from . import read_json, write_json
from .export import _git_head

WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")
PIN = os.path.join(WEB, "VENDORED.json")


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def check(web=WEB):
    """The problems of the vendored files against their pin: [] when each is the file that was copied."""
    pin, out = read_json(os.path.join(web, "VENDORED.json")), []
    for name, want in pin["files"].items():
        path = os.path.join(web, name)
        if not os.path.isfile(path):
            out.append(f"{name}: missing")
        elif sha256(path) != want:
            out.append(f"{name}: edited here (its SHA-256 is not the pinned one); change it in econ and vendor it again")
    folder = os.path.join(web, "vendor")
    listed = {os.path.basename(n) for n in pin["files"]}
    out += [f"vendor/{n}: not in VENDORED.json" for n in sorted(os.listdir(folder)) if n not in listed]
    return out


def update(econ_src, web=WEB):
    """Copy the pinned files from a gentic checkout's src folder and write the new pin."""
    src = os.path.join(os.path.abspath(econ_src), "econ", "web")
    pin = read_json(os.path.join(web, "VENDORED.json"))
    for name in pin["files"]:
        shutil.copyfile(os.path.join(src, os.path.basename(name)), os.path.join(web, name))
        pin["files"][name] = sha256(os.path.join(web, name))
    sys.path.insert(0, os.path.abspath(econ_src))
    pin["econ"] = importlib.import_module("econ").__version__
    pin["commit"] = _git_head(econ_src) or pin["commit"]
    write_json(os.path.join(web, "VENDORED.json"), pin)
    return pin


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m tools.vendor", description="Check or renew the files copied from econ.")
    ap.add_argument("--econ-src", help="the src folder of a gentic checkout: copy the files again and pin its commit")
    a = ap.parse_args(argv)
    if a.econ_src:
        pin = update(a.econ_src)
        print(f"vendored econ {pin['econ']} at {pin['commit'][:10]}: {len(pin['files'])} files")
    problems = check()
    for p in problems:
        print(p)
    if not problems:
        print(f"web/vendor is econ's, unedited ({len(read_json(PIN)['files'])} files at {read_json(PIN)['commit'][:10]})")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
