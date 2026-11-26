"""Build the site from records: one HTML page that works offline, with the records inside it.

    python -m tools.build runs --out site                       the public site, from the public records
    python -m tools.build ../econ-runs/runs --out site --audience internal [--words WORDS]
                                                                the private page, from every record

It writes, in --out:
    index.html                  the whole site in one file: styles, scripts and data inline, nothing fetched
    data.json                   the same data on its own
    runs/ID.json                each record
    schema/econ-run-1.schema.json
    .nojekyll                   so that GitHub Pages serves the folder as it is

Every record is validated first (tools/validate.py), and a public site takes only public records: one internal record,
or anything forbidden in a public one, stops the build. Standard library only. The page's files and their order are
web/page.json; the files copied from econ must be the pinned ones (tools/vendor.py).
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import shutil
import sys
import time

from . import patterns, read_json, validate, vendor, write_json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
SITE_SCHEMA = "econ-site/1"


def read_text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def site_data(records, audience, built):
    """What the page holds: the records, oldest first, the changelog of econ's versions and what was vendored."""
    pin = read_json(os.path.join(WEB, "VENDORED.json"))
    return {"schema": SITE_SCHEMA, "audience": audience, "built": built,
            "records": sorted(records, key=lambda r: (r["created"], r["id"])),
            "changelog": read_json(os.path.join(WEB, "changelog.json")),
            "vendored": {"econ": pin["econ"], "commit": pin["commit"]}}


def inert(data):
    """A JSON text that stays data inside a <script> element, whatever its strings hold."""
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    for raw, safe in (("<", "\\u003c"), (">", "\\u003e"), ("&", "\\u0026"), (" ", "\\u2028"), (" ", "\\u2029")):
        text = text.replace(raw, safe)
    return text


def page(data, title=None):
    """The site as one HTML string: web/page.html with the styles, the scripts and the data put in."""
    spec = read_json(os.path.join(WEB, "page.json"))
    scripts = []
    for name in spec["scripts"]:
        source = read_text(os.path.join(WEB, name))
        if "</script" in source.lower():
            raise SystemExit(f"web/{name}: it would close its own <script> element")
        scripts.append(f"<script>\n/* {name} */\n{source}\n</script>")
    parts = {"TITLE": html.escape(title or spec["title"]),
             "STYLE": "\n".join(f"/* {name} */\n" + read_text(os.path.join(WEB, name)) for name in spec["styles"]),
             "SCRIPTS": "\n".join(scripts), "DATA": inert(data)}
    return re.sub(r"@@([A-Z]+)@@", lambda m: parts[m.group(1)], read_text(os.path.join(WEB, "page.html")))


def load(paths, audience, words=frozenset()):
    """The records under `paths`, validated for the audience; SystemExit with every problem when one does not pass."""
    bad, _, _ = validate.check_all(paths, public=audience == "public", words=words)
    if bad:
        lines = [f"{path}:\n  " + "\n  ".join(problems) for path, problems in bad.items()]
        raise SystemExit("the site is not built: these records do not pass\n" + "\n".join(lines))
    return [read_json(path) for path in validate.record_files(paths)]


def build(paths, out, audience="public", built=None, words=frozenset(), title=None):
    """Write the site to `out`; returns {records, bytes} of index.html."""
    problems = vendor.check()
    if problems:
        raise SystemExit("the site is not built: " + "; ".join(problems))
    records = load(paths, audience, words)
    data = site_data(records, audience, built or time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime()))
    text = page(data, title)
    os.makedirs(os.path.join(out, "runs"), exist_ok=True)
    os.makedirs(os.path.join(out, "schema"), exist_ok=True)
    for name in os.listdir(os.path.join(out, "runs")):  # a record that left the registry leaves the site
        os.remove(os.path.join(out, "runs", name))
    with open(os.path.join(out, "index.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    write_json(os.path.join(out, "data.json"), data)
    for rec in records:
        write_json(os.path.join(out, "runs", rec["id"] + ".json"), rec)
    shutil.copyfile(validate.SCHEMA_PATH, os.path.join(out, "schema", "econ-run-1.schema.json"))
    with open(os.path.join(out, ".nojekyll"), "w", encoding="utf-8"):
        pass
    return {"records": len(records), "bytes": len(text.encode("utf-8"))}


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m tools.build", description="Build the site from econ-run/1 records.")
    ap.add_argument("paths", nargs="+", help="folders of records (or record files)")
    ap.add_argument("--out", default="site", help="the folder to write the site to (default: site)")
    ap.add_argument("--audience", choices=("public", "internal"), default="public",
                    help="public (default): only public records, checked for what is forbidden")
    ap.add_argument("--words", help="a private list of words a public record must not hold")
    ap.add_argument("--built", help="the build's time stamp, to make two builds the same bytes")
    ap.add_argument("--title", help="the page's title")
    a = ap.parse_args(argv)
    words = patterns.load_words(a.words) if a.words else frozenset()
    done = build(a.paths, a.out, a.audience, a.built, words, a.title)
    print(f"{a.out}/index.html: {done['records']} records, {done['bytes']:,} bytes, {a.audience}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
