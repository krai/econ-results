"""Export a run of econ as an econ-run/1 record: one JSON file per run, in the standard format of the registry.

    python -m tools.export RUN_DIR --econ-src GENTIC/src --prices SNAPSHOT.json --rent 5.29 --rent 3.59 \
        --aliases ALIASES.json --out RUNS_DIR                      a run folder (measure, check, accuracy)
    python -m tools.export --measure M.json [--check C.json] [--accuracy A.json] ...       the files one by one
    python -m tools.export --report REPORT.json --config LABEL ...   a configuration of a report.json, when its
                                                                    measure.json is not at hand
    python -m tools.export --manifest MANIFEST.json --econ-src GENTIC/src --out RUNS_DIR [--public-out PUBLIC_DIR]
                                                                    every run of a manifest (a list of the options)
    ... --visibility public --public-out PUBLIC_DIR                 also the sanitised form (tools/sanitize.py)

The points are computed by econ's own code, imported from --econ-src (a checkout of gentic, pinned in the registry):
report.build reads any measure.json since econ 0.0.3 and prices it, so nothing of econ is written again here. A
configuration taken from a report.json keeps the report's measured numbers and is priced again with the same code.
What econ's files do not say (the Slurm job, the image's digest, the family of the configuration) comes from the
options or from the run's provenance.txt. The record does not depend on when or where it was exported: the same
files give the same bytes.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import importlib
import os
import re
import subprocess
import sys

from . import SCHEMA, read_json, run_id, sanitize, write_json

OFFICIAL_IMAGES = ("vllm/vllm-openai",)  # release images: their tag is the engine's version
FAMILIES = {"recipe": "recipe", "s0": "S0", "s1": "S1"}  # a token of the label -> the configuration's family
WINDOW_KEYS = ("rate_rps", "measured", "failed", "input_tok_s", "output_tok_s", "p50_tpot_ms", "p90_tpot_ms",
               "p99_tpot_ms", "p99_ttft_ms", "p99_tpot_ci_ms", "p99_ttft_ci_ms", "node_power_w", "tok_per_j", "window_s",
               "steady")
CURVE_KEYS = ("x", "y", "ttft", "y_ci", "ttft_ci", "rate", "probe", "power_w", "failed", "steady", "client_busy",
              "final", "kind", "target", "margin")
SYSTEM_KEYS = ("os", "kernel", "cpu", "sockets", "cores", "threads", "ram_gib", "driver", "cuda", "docker", "python")
ACCURACY_KEYS = ("benchmark", "shots", "items", "seed", "correct", "accuracy", "ci95", "strict_accuracy", "failed")
SPEC_KEYS = ("run", "measure", "check", "accuracy", "prices", "report", "config", "provenance", "rents", "family",
             "variant", "precision", "tp", "dp", "job", "data_dir", "gentic_commit", "econ_commit", "engine_version",
             "engine_build", "engine_commit", "digest", "weights_gb", "public")


class Econ:
    """econ, imported from a checkout of gentic: its modules, its version and the checkout's commit."""

    def __init__(self, src):
        src = os.path.abspath(src)
        if not os.path.isfile(os.path.join(src, "econ", "report.py")):
            raise SystemExit(f"--econ-src {src}: no econ/report.py there (give the src folder of a gentic checkout)")
        sys.path.insert(0, src)
        self.report = importlib.import_module("econ.report")
        self.economics = importlib.import_module("econ.economics")
        self.evaluation = importlib.import_module("econ.evaluation")
        self.prices = importlib.import_module("econ.prices")
        self.finite = importlib.import_module("econ.stats").finite
        self.version = importlib.import_module("econ").__version__
        self.commit = _git_head(src)


def _git_head(path):
    try:
        out = subprocess.run(["git", "-C", path, "rev-parse", "HEAD"], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() if out.returncode == 0 and re.fullmatch(r"[0-9a-f]{40}", out.stdout.strip()) else None


def discover(run_dir):
    """The files of a run folder: {measure, check, accuracy, provenance}, each a path or None."""
    def first(*names):
        return next((p for p in (os.path.join(run_dir, n) for n in names) if os.path.isfile(p)), None)
    return {"measure": first("measure/measure.json", "measure.json"), "check": first("check/check.json", "check.json"),
            "accuracy": first("accuracy/accuracy.json", "accuracy.json"), "provenance": first("provenance.txt")}


def parse_provenance(path):
    """A run's provenance.txt (key=value words, and a line of the versions inside the image) as a dict."""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    out = dict(re.findall(r"(\w+)=(\S+)", text))
    inside = re.search(r"^inside:\s*(.+)$", text, re.M)
    if inside:
        out["inside"] = {k.lower(): v.strip() for k, v in (part.split(None, 1) for part in inside.group(1).split("|")
                                                           if len(part.split(None, 1)) == 2)}
    return out


def file_entry(role, path):
    with open(path, "rb") as f:
        data = f.read()
    return {"role": role, "name": os.path.basename(path), "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def snapshot(path):
    """A price snapshot: econ's prices file, or the priced endpoints that a report.json keeps of the one it used."""
    doc = read_json(path)
    if doc.get("kind") != "report":
        return doc
    prices = doc.get("prices") or {}
    if not prices.get("by_endpoint"):
        raise SystemExit(f"--prices {path}: this report keeps no endpoints (it is from before econ 0.0.4)")
    return {"source": prices.get("source"), "model": prices["model"], "taken": prices["taken"],
            "endpoints": prices["by_endpoint"]}


def from_measure(spec, econ):
    """(report dict, results, files) of a measure.json, priced by econ's report.build."""
    path = spec["measure"]
    doc = read_json(path)
    snap = snapshot(spec["prices"]) if spec.get("prices") else None
    checks = [read_json(spec["check"])] if spec.get("check") else []
    accs = [read_json(spec["accuracy"])] if spec.get("accuracy") else []
    rep = econ.report.build(measures=[path], snap=snap, rents=tuple(spec.get("rents") or ()), checks=checks,
                            accuracies=accs, weights_gb=spec.get("weights_gb"))
    for p, res in zip(rep["points"], doc["results"]):  # the median's p90s: report.json leaves them out
        med = res.get("median") or {}
        p["p90_tpot_ms"], p["p90_ttft_ms"] = med.get("p90_tpot_ms"), med.get("p90_ttft_ms")
    results = [{"slo": res["slo"], "met": bool(res["met"]), "rate_rps": res.get("rate_rps"),
                "note": res.get("note") or "", "probes": len(res.get("probes") or []),
                "windows": [{k: w.get(k) for k in WINDOW_KEYS} for w in res.get("runs") or []]}
               for res in doc["results"]]
    files = [file_entry("measure", path)]
    power_csv = os.path.join(os.path.dirname(os.path.abspath(path)), "power.csv")
    if not doc.get("stability") and os.path.isfile(power_csv):  # report.power_rows read it
        files.append(file_entry("power", power_csv))
    files += [file_entry(role, spec[role]) for role in ("check", "accuracy", "prices") if spec.get(role)]
    rep["_source"] = {"file": "measure.json", "version": doc.get("version"), "command": doc.get("command"),
                      "memory_mib": ((doc.get("gpu_info") or [{}])[0]).get("memory_mib"), "checks": checks,
                      "accuracies": accs}
    return rep, results, files


def from_report(spec, econ):
    """(report dict, results, files) of one configuration of a report.json: its measured numbers as the report has
    them, priced again by econ's economics with the report's own endpoints and rents."""
    old, label = read_json(spec["report"]), spec.get("config")
    labels = [s["config"] for s in old.get("setups") or []]
    if label not in labels:
        raise SystemExit(f"--report {spec['report']}: no configuration {label!r} there; it has {labels}")
    setup = dict(next(s for s in old["setups"] if s["config"] == label))
    prices = old.get("prices")
    rents = list(spec.get("rents") or old.get("rents") or [])
    endpoints = (prices or {}).get("by_endpoint") or []
    snap = dict(prices, endpoints=endpoints) if endpoints else None
    pts = []
    for p in old["points"]:
        if p["config"] != label:
            continue
        p = dict(p)
        if snap and p["met"] is not False and p.get("input_tok_s") is not None and p.get("output_tok_s"):
            p["worth"] = econ.economics.worth(p, snap, rents)
        pts.append(p)
    others = [name for name in labels if name != label]
    rep = {"points": pts, "curves": [c for c in old.get("curves") or [] if c["name"] == label], "setups": [setup],
           "prices": dict(prices, by_endpoint=endpoints) if prices else None, "rents": rents,
           "not_covered": [n for n in old.get("not_covered") or [] if not any(o in n for o in others)]}
    checks = [c for c in old.get("checks") or [] if c.get("label") in (None, label)]
    accs = [a for a in old.get("accuracy") or [] if a.get("label") in (None, label)]
    rep = econ.evaluation.add(rep, checks, accs, spec.get("weights_gb"))
    results = [{"slo": {"label": p["slo"], "tpot_p99_ms": p["tpot_limit"], "ttft_p99_ms": p.get("ttft_limit") or 2000.0},
                "met": bool(p["met"]), "rate_rps": p.get("rate_rps") if p["met"] else None, "note": p.get("note") or "",
                "probes": None, "windows": None} for p in pts]
    rep["_source"] = {"file": "report.json", "version": old.get("version"), "command": setup.get("command"),
                      "memory_mib": None, "checks": checks, "accuracies": accs,
                      "data_dir": os.path.dirname(pts[0].get("source") or "") or None}
    return rep, results, [file_entry("report", spec["report"])]


def engine_of(image, spec, prov):
    """The engine of a run from its image and what the options state: {name, version, build, commit, image, digest,
    inside}. A release image's tag is its version; any other image is a build of a commit."""
    repo, _, tag = (image or "").rpartition(":")
    version = build = commit = None
    if repo in OFFICIAL_IMAGES:
        m = re.fullmatch(r"v?(\d+\.\d+\.\d+\S*)", tag)
        version, build = (m.group(1) if m else None), "release"
    elif image:
        m = re.search(r"vllm-([0-9a-f]{7,12})(?![0-9a-f])", repo)
        commit, build = (m.group(1) if m else None), ("nightly" if m else "custom")
    digest = spec.get("digest") or prov.get("digest") or ""
    digest = digest.rpartition("@")[2] if digest else None
    inside = prov.get("inside") or None
    return {"name": "vLLM", "version": spec.get("engine_version") or version or (inside or {}).get("vllm"),
            "build": spec.get("engine_build") or build, "commit": spec.get("engine_commit") or commit,
            "image": image or None, "digest": digest, "inside": inside}


def config_of(setup, spec):
    """The configuration: its family from the label's words unless stated, and TP and DP from the server's flags."""
    label, flags = setup["config"], [str(f) for f in setup.get("flags") or []]
    words = re.split(r"[-_.]", label.lower())
    family = spec.get("family") or next((FAMILIES[w] for w in words if w in FAMILIES), "stock")

    def flag(name):
        value = flags[flags.index(name) + 1] if name in flags and flags.index(name) + 1 < len(flags) else None
        return int(value) if value and value.isdigit() else None
    tp_word = next((int(w[2:]) for w in words if re.fullmatch(r"tp\d+", w)), None)
    return {"label": label, "family": family, "variant": spec.get("variant"),
            "tp": spec.get("tp") or flag("--tensor-parallel-size") or tp_word,
            "dp": spec.get("dp") or flag("--data-parallel-size"),
            "flags": setup.get("flags") or None, "env": setup.get("env") or None, "patch": setup.get("patch"),
            "server_config": os.path.basename(setup["server_config"]) if setup.get("server_config") else None}


def slim_check(c):
    """A check.json as the record keeps it: its verdict, the count of rows by status, the rows that did not pass and
    the node's system."""
    host = c.get("host") or {}
    return {"version": c.get("version"), "created": c.get("created"), "verdict": c["verdict"],
            "warnings": c.get("warnings"), "gpus": len(c.get("gpus") or []),
            "status": dict(collections.Counter(r["status"] for r in c["rows"])),
            "rows": [{k: r.get(k) for k in ("check", "result", "reference", "status")} for r in c["rows"]
                     if r["status"] != "PASS"],
            "system": {k: host.get(k) for k in SYSTEM_KEYS}}


def slim_stability(st):
    if not st:
        return None
    return {"verdict": st["verdict"], "warnings": st.get("warnings"), "samples": st.get("samples"),
            "seconds": st.get("seconds"), "interval_s": st.get("interval_s"), "from": st.get("from"),
            "rows": [{k: r.get(k) for k in ("check", "result", "status")} for r in st.get("rows") or []]}


def record(rep, results, files, spec, econ, aliases):
    """The econ-run/1 record (internal form) of a one-configuration report."""
    setup, src = rep["setups"][0], rep.pop("_source")
    prov = parse_provenance(spec["provenance"]) if spec.get("provenance") else {}
    host = setup.get("host")
    if host not in aliases:
        raise SystemExit(f"no alias for the node of {setup['config']} in --aliases: add it there (a record never "
                         "names a host outside its provenance)")
    model = setup["model"]
    quant = re.search(r"(?i)(?<![a-z0-9])(mxfp4|fp4|fp8|bf16|int4|int8|awq)(?![a-z0-9])", model)
    power = setup.get("power") or {}
    checks, accs = src["checks"], src["accuracies"]
    points = [dict({k: v for k, v in p.items() if k != "check"}, source=src["file"]) for p in rep["points"]]
    curve = rep["curves"][0] if rep.get("curves") else None
    command = src.get("command") or ""
    out_dir = re.search(r"--out (\S+)", command)
    method = dict(setup["method"])
    if "metrics" in method:  # the server's own address says nothing of the method: only that its metrics were read
        method["metrics"] = bool(method["metrics"])
    return econ.finite({
        "schema": SCHEMA, "id": run_id(setup["config"], setup["created"], model, setup["gpus"]),
        "created": setup["created"], "visibility": "internal",
        "econ": {"version": spec.get("measured_with") or _measured_with(src, rep),
                 "commit": spec.get("econ_commit") or prov.get("commit"),
                 "exporter": {"version": econ.version, "commit": econ.commit, "source": src["file"],
                              "source_version": src.get("version")}},
        "model": {"id": model, "name": model.rpartition("/")[2],
                  "precision": spec.get("precision") or (quant.group(1).upper() if quant else None),
                  "max_model_len": setup.get("max_model_len"), "priced_as": (rep.get("prices") or {}).get("model")},
        "engine": engine_of(setup.get("image"), spec, prov),
        "config": config_of(setup, spec),
        "hardware": {"gpu": setup.get("gpu_name") or "GPU", "gpus": setup["gpus"],
                     "gpus_on_node": power.get("gpus_on_node") or (len(checks[0].get("gpus") or []) if checks else None),
                     "driver": setup.get("driver"), "power_limit_w": setup.get("power_limit_w"),
                     "memory_mib": src.get("memory_mib"), "node": aliases[host]},
        "workload": setup["workload"], "method": method,
        "power": {"scope": power.get("scope"), "gpus_seen": power.get("gpus_seen"),
                  "notes": list((power.get("sources") or {}).get("notes") or [])} if power else None,
        "results": results, "points": points,
        "curve": {"name": curve["name"], "points": [{k: q.get(k) for k in CURVE_KEYS} for q in curve["points"]]}
        if curve else None,
        "stability": slim_stability(setup.get("stability")),
        "health": {"check": slim_check(checks[0]) if checks else None,
                   "accuracy": {k: accs[0].get(k) for k in ACCURACY_KEYS} if accs else None}
        if checks or accs else None,
        "prices": rep.get("prices"), "rents": list(rep.get("rents") or []),
        "findings": rep.get("findings") or None, "not_covered": rep.get("not_covered") or None,
        "provenance": {"host": host, "job": spec.get("job") or prov.get("job"),
                       "data_dir": spec.get("data_dir") or (os.path.dirname(out_dir.group(1)) if out_dir else None)
                       or src.get("data_dir"),
                       "command": command or None, "gentic_commit": spec.get("gentic_commit") or prov.get("commit"),
                       "image": setup.get("image"), "server_config": setup.get("server_config"),
                       "started": prov.get("start")},
        "files": files})


def _measured_with(src, rep):
    """The econ that measured: the measure.json's own version; a report.json only says who wrote the report."""
    if src["file"] == "measure.json" and src.get("version"):
        return src["version"]
    raise SystemExit("a record from a report.json needs the version of the econ that measured: state it with "
                     "--measured-with (or measured_with in the manifest)")


def export(spec, econ, aliases):
    """The internal record of one run, from its spec: the options of the command line or one entry of a manifest."""
    spec = dict(spec)
    if spec.get("run"):
        found = discover(spec["run"])
        if not found["measure"]:
            raise SystemExit(f"{spec['run']}: no measure.json there (nor in its measure/ folder)")
        spec = dict({k: v for k, v in found.items() if v}, **{k: v for k, v in spec.items() if v is not None})
    if bool(spec.get("measure")) == bool(spec.get("report")):
        raise SystemExit("give a run folder or --measure, or else --report with --config")
    rep, results, files = from_measure(spec, econ) if spec.get("measure") else from_report(spec, econ)
    return record(rep, results, files, spec, econ, aliases)


def write(rec, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, rec["id"] + ".json")
    write_json(path, rec)
    return path


def manifest_specs(path):
    """The runs of a manifest: {"aliases": FILE, "runs": [spec, ...]}, with paths taken from the manifest's folder."""
    doc, base = read_json(path), os.path.dirname(os.path.abspath(path))
    specs = []
    for entry in doc["runs"]:
        unknown = set(entry) - set(SPEC_KEYS) - {"measured_with", "note"}
        if unknown:
            raise SystemExit(f"{path}: unknown fields {sorted(unknown)} in the run {entry.get('config') or entry}")
        spec = dict(entry)
        for key in ("run", "measure", "check", "accuracy", "prices", "report", "provenance"):
            if spec.get(key):
                spec[key] = os.path.normpath(os.path.join(base, spec[key]))
        specs.append(spec)
    aliases = os.path.join(base, doc["aliases"]) if doc.get("aliases") else None
    return specs, aliases


def parser():
    ap = argparse.ArgumentParser(prog="python -m tools.export", description="Export runs of econ as econ-run/1 records.")
    ap.add_argument("run", nargs="?", help="a run folder: measure.json, check.json, accuracy.json, provenance.txt")
    ap.add_argument("--econ-src", required=True, help="the src folder of a gentic checkout, to import econ from")
    ap.add_argument("--manifest", help="a JSON file listing several runs, instead of one run's options")
    for name in ("measure", "check", "accuracy", "prices", "report", "provenance"):
        ap.add_argument("--" + name, help=f"the run's {name} file")
    ap.add_argument("--config", help="with --report: the label of the configuration to export")
    ap.add_argument("--measured-with", help="with --report: the version of the econ that measured")
    ap.add_argument("--rent", dest="rents", type=float, action="append", help="USD per GPU-hour; repeat it")
    ap.add_argument("--aliases", help="a JSON object {host name: alias}")
    ap.add_argument("--family", help="recipe, S0, S1 or stock (default: from the label)")
    ap.add_argument("--variant", help="what sets the configuration apart inside its family")
    ap.add_argument("--precision", help="the weights' quantisation, when the model's name does not say")
    ap.add_argument("--tp", type=int)
    ap.add_argument("--dp", type=int)
    ap.add_argument("--job", help="the scheduler's job id")
    ap.add_argument("--data-dir", help="the folder that holds the run's files")
    ap.add_argument("--gentic-commit", help="the commit of gentic the run used")
    ap.add_argument("--engine-version")
    ap.add_argument("--engine-build", choices=("release", "nightly", "custom"))
    ap.add_argument("--engine-commit")
    ap.add_argument("--digest", help="the image's digest (sha256:...)")
    ap.add_argument("--weights-gb", type=float, help="as econ report's --weights-gb")
    ap.add_argument("--visibility", choices=("internal", "public"), default="internal",
                    help="public: also write the sanitised form to --public-out")
    ap.add_argument("--out", required=True, help="the folder for the internal records")
    ap.add_argument("--public-out", help="the folder for the public forms")
    return ap


def main(argv=None):
    a = parser().parse_args(argv)
    econ = Econ(a.econ_src)
    if a.manifest:
        specs, aliases_path = manifest_specs(a.manifest)
        aliases_path = a.aliases or aliases_path
    else:
        specs = [dict({k: getattr(a, k) for k in SPEC_KEYS if getattr(a, k, None) is not None},
                      measured_with=a.measured_with, public=a.visibility == "public")]
        aliases_path = a.aliases
    if not aliases_path:
        raise SystemExit("--aliases is needed: the aliases the records name the nodes by")
    if any(s.get("public") for s in specs) and not a.public_out:
        raise SystemExit("--public-out is needed for the runs to be written in their public form")
    aliases = read_json(aliases_path)
    for spec in specs:
        rec = export(spec, econ, aliases)
        print(f"{write(rec, a.out)}  ({len(rec['points'])} targets, econ {rec['econ']['version']})")
        if spec.get("public"):
            print(f"{write(sanitize.public(rec, aliases), a.public_out)}  (public form)")


if __name__ == "__main__":
    main()
