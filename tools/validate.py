"""Check econ-run/1 records: the format, the units and ranges, the ids, the arithmetic, that none holds a secret
and, for a public record, everything else that must not be in it.

    python -m tools.validate runs                        every *.json under a folder (or files one by one)
    python -m tools.validate runs --sources sources      and the registry's original files: each record's are there,
                                                         each run folder has its record, none holds a secret
    python -m tools.validate PUBLIC_DIR --public --words private-words.txt
                                                         they must all be public forms, with nothing private left

Per record:
- the JSON Schema (schema/econ-run-1.schema.json, checked by tools/schema.py);
- units and ranges that a schema cannot say: percentiles in order, a met target with its rate and within its limits'
  units, intervals around their value, a power no larger than the boards' limit, accuracy within its interval;
- its id is the one its own fields give, and its file is named after it;
- its priced numbers follow from its measured ones and its price snapshot (tools/arith.py);
- it holds no access token and no private key, whatever its visibility;
- a public record has no provenance and nothing that tools/patterns.py forbids.
Across records: no id twice, and no measurement twice under two ids. With --sources, every file a record cites must
be under that folder, found by its SHA-256 whatever its name: a registry that keeps its originals can prove it. Every
run folder there (one with an export.json) must have the record of its measurement, and no file there may hold a
secret.

Exit status 0 when every record passes, 1 otherwise; every problem is printed with its file and its path.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys

from . import arith, export, patterns, read_json, run_id, schema

SCHEMA_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "schema",
                           "econ-run-1.schema.json")
ORDERED = (("p50_tpot_ms", "p90_tpot_ms", "p99_tpot_ms"), ("p50_ttft_ms", "p90_ttft_ms", "p99_ttft_ms"))
POWER_SLACK = 1.05  # a board may read a little over its limit for a sample


def record_files(paths):
    """Every *.json under the folders, and the files given one by one, sorted."""
    out = []
    for path in paths:
        if os.path.isdir(path):
            out += [os.path.join(root, name) for root, _, names in os.walk(path) for name in names
                    if name.endswith(".json")]
        else:
            out.append(path)
    return sorted(out)


def ranges(rec):
    """Problems of units and ranges in one record."""
    out, hw = [], rec["hardware"]
    limit = hw.get("power_limit_w")
    boards = hw.get("gpus_on_node") or hw["gpus"]
    for i, p in enumerate(rec["points"]):
        at = f"$.points[{i}]"
        if p["gpus"] != hw["gpus"]:
            out.append(f"{at}.gpus: {p['gpus']}, but the hardware has {hw['gpus']} serving GPUs")
        if p["config"] != rec["config"]["label"]:
            out.append(f"{at}.config: {p['config']!r} is not the record's label")
        for keys in ORDERED:
            vals = [(k, p[k]) for k in keys if p.get(k) is not None]
            for (ka, a), (kb, b) in zip(vals, vals[1:]):
                if a > b:
                    out.append(f"{at}: {ka} ({a:.6g}) is above {kb} ({b:.6g})")
        if p["met"]:
            for key in ("rate_rps", "output_tok_s", "input_tok_s", "p99_tpot_ms", "p99_ttft_ms"):
                if not p.get(key) and p.get(key) != 0:
                    out.append(f"{at}: a met target without {key}")
            if p.get("output_tok_s") is not None and p["output_tok_s"] <= 0:
                out.append(f"{at}.output_tok_s: a met target that serves no tokens")
        watts = p.get("node_power_w")
        if watts and limit and watts > limit * p["gpus"] * POWER_SLACK:
            out.append(f"{at}.node_power_w: {watts:.0f} W on {p['gpus']} boards limited to {limit:.0f} W each")
        total = (p.get("power") or {}).get("all_gpus_w")
        if total and limit and total > limit * boards * POWER_SLACK:
            out.append(f"{at}.power.all_gpus_w: {total:.0f} W on {boards} boards limited to {limit:.0f} W each")
        if watts and p.get("tok_per_j") and p.get("output_tok_s"):
            if abs(p["output_tok_s"] / watts - p["tok_per_j"]) > 0.02 * p["tok_per_j"]:
                out.append(f"{at}.tok_per_j: {p['tok_per_j']:.4g} is not output tok/s over watts "
                           f"({p['output_tok_s'] / watts:.4g})")
        for key in ("p99_tpot", "p99_ttft"):
            pooled = p.get("pooled") or {}
            out += _interval(pooled.get(key + "_ms"), pooled.get(key + "_ci_ms"), f"{at}.pooled.{key}_ci_ms")
    out += _results(rec)
    acc = (rec.get("health") or {}).get("accuracy")
    if acc:
        if acc["correct"] > acc["items"]:
            out.append(f"$.health.accuracy: {acc['correct']} correct of {acc['items']} items")
        out += _interval(acc["accuracy"], acc.get("ci95"), "$.health.accuracy.ci95")
    return out


def _results(rec):
    out, pts = [], rec["points"]
    if len(rec["results"]) != len(pts):
        out.append(f"$.results: {len(rec['results'])} targets, but {len(pts)} points")
    for i, (res, p) in enumerate(zip(rec["results"], pts)):
        at = f"$.results[{i}]"
        if res["met"] != bool(p["met"]):
            out.append(f"{at}.met: {res['met']}, but its point says {p['met']}")
        if res["slo"]["tpot_p99_ms"] != p["tpot_limit"]:
            out.append(f"{at}.slo: TPOT {res['slo']['tpot_p99_ms']:g} ms, but its point has {p['tpot_limit']:g} ms")
        if res["met"] and not res.get("rate_rps"):
            out.append(f"{at}: a met target without its rate")
        for j, w in enumerate(res.get("windows") or []):
            for key in ("p99_tpot", "p99_ttft"):
                out += _interval(w.get(key + "_ms"), w.get(key + "_ci_ms"), f"{at}.windows[{j}].{key}_ci_ms")
    return out


def _interval(value, ci, at):
    """An interval holds its value: [low, high], high None when it has no upper bound."""
    if value is None or not ci:
        return []
    low, high = ci[0], ci[1] if len(ci) > 1 else None
    if (low is not None and low > value * (1 + 1e-9)) or (high is not None and high < value * (1 - 1e-9)):
        return [f"{at}: {ci} does not hold its value {value:.6g}"]
    return []


def identity(rec, path):
    """Problems of a record's id and file name."""
    want = run_id(rec["config"]["label"], rec["created"], rec["model"]["id"], rec["hardware"]["gpus"])
    out = [] if rec["id"] == want else [f"$.id: {rec['id']}, but its fields give {want}"]
    if path and os.path.basename(path) != rec["id"] + ".json":
        out.append(f"the file is {os.path.basename(path)}, not {rec['id']}.json")
    return out


def check_record(rec, path=None, public=False, words=frozenset(), schema_doc=None):
    """Every problem of one record; an empty list when it passes."""
    out = schema.check(rec, schema_doc or schema.load(SCHEMA_PATH))
    if out:
        return out  # the other checks read fields the schema guarantees
    out = ranges(rec) + identity(rec, path)
    out += [f"arithmetic: {m}" for m in arith.check(rec)[1]]
    if public and rec["visibility"] != "public":
        out.append("$.visibility: an internal record where only public ones may be")
    if rec["visibility"] == "public":
        out += patterns.scan(rec, words)
    else:
        out += [f"{hit}: no record may hold a secret" for hit in patterns.secrets(rec)]
        if "provenance" not in rec:
            out.append("$.provenance: an internal record keeps where it was run")
    return out


def originals(folder):
    """The original files under a folder: {path: SHA-256}, and the problems of the files themselves (a secret)."""
    have, bad = {}, {}
    for root, _, names in os.walk(folder):
        for name in names:
            path = os.path.normpath(os.path.join(root, name))
            with open(path, "rb") as f:
                data = f.read()
            have[path] = hashlib.sha256(data).hexdigest()
            found = patterns.secrets_in_text(data.decode("utf-8", "replace"))
            if found:
                bad[path] = [f"{what}: no file of the registry may hold a secret" for what in found]
    return have, bad


def unrecorded(folder, have, cited):
    """{export.json: [problem]} for the run folders whose measurement no record cites."""
    out = {}
    for root, _, names in os.walk(folder):
        if export.EXPORT_FILE in names:
            measure = export.discover(root)["measure"]
            if measure and have[os.path.normpath(measure)] not in cited:
                out[os.path.join(root, export.EXPORT_FILE)] = [
                    "this run has no record: export it (python -m tools.export --registry . --econ-src GENTIC/src)"]
    return out


def check_all(paths, public=False, words=frozenset(), sources=None):
    """{file: [problems]} for the files with problems, and the number of records and of values re-computed."""
    schema_doc, bad, seen, same, values = schema.load(SCHEMA_PATH), {}, {}, {}, 0
    files, cited = record_files(paths), set()
    have, bad_files = originals(sources) if sources else (None, {})
    held = set(have.values()) if sources else None
    for path in files:
        try:
            rec = read_json(path)
        except (OSError, ValueError) as e:
            bad[path] = [f"not readable as JSON: {e}"]
            continue
        problems = check_record(rec, path, public, words, schema_doc)
        if not problems:
            values += arith.check(rec)[0]
            key = (rec["config"]["label"], rec["created"])
            if rec["id"] in seen:
                problems.append(f"$.id: {rec['id']} is also in {seen[rec['id']]}")
            elif key in same:
                problems.append(f"the same measurement ({key[0]}, {key[1]}) is also in {same[key]}")
            seen.setdefault(rec["id"], path)
            same.setdefault(key, path)
            cited.update(f["sha256"] for f in rec["files"])
            if held is not None:
                problems += [f"$.files: {f['name']} ({f['role']}) is not under {sources}: no file there has its SHA-256"
                             for f in rec["files"] if f["sha256"] not in held]
        if problems:
            bad[path] = problems
    if sources:
        bad.update(bad_files)
        bad.update(unrecorded(sources, have, cited))
    return bad, len(files), values


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m tools.validate", description="Check econ-run/1 records.")
    ap.add_argument("paths", nargs="+", help="record files, or folders of them")
    ap.add_argument("--public", action="store_true", help="every record must be a public one")
    ap.add_argument("--words", help="a private list of words a public record must not hold, one per line")
    ap.add_argument("--sources", help="a folder that must hold every original file the records cite")
    ap.add_argument("--allow-empty", action="store_true", help="no records at all is not an error")
    a = ap.parse_args(argv)
    words = patterns.load_words(a.words) if a.words else frozenset()
    bad, count, values = check_all(a.paths, a.public, words, a.sources)
    for path, problems in bad.items():
        print(f"{path}:")
        for p in problems:
            print(f"  {p}")
    if count == 0 and not a.allow_empty:
        print("no records found")
        return 1
    failed = sum(1 for path in bad if path in set(record_files(a.paths)))
    print(f"{count - failed} of {count} records pass" + (f"; {values} priced values re-computed" if values else "") +
          (f"; {len(bad) - failed} problem(s) under {a.sources}" if len(bad) > failed else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
