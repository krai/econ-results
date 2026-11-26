"""Add a run of econ to the registry: its files, its export options and its record, ready for a pull request.

    python -m tools.add RUN_DIR --econ-src GENTIC/src --prices PRICES.json --rent 5.29 --rent 3.59 --cluster NAME

RUN_DIR is the folder econ wrote the run to: measure.json (or measure/measure.json) and what there is of check.json,
accuracy.json and provenance.txt. The command
1. copies those files as they are to sources/DATE_GPU/LABEL/ of the registry (the day and the GPU of the measurement,
   and its label), with the price list next to them;
2. writes the run's export.json there: the options given here, which are what econ's files do not say;
3. exports the record to runs/ID.json with econ's own code, and validates the registry with it.
Then it prints the git commands that put the run in a pull request. It adds files and edits none, it does not commit
and it does not push. If a step fails, it removes what it wrote.

    --registry DIR      the registry's folder (default: this repository)
    --group NAME        the folder under sources/ (default: DATE_GPU of the measurement)
    --name NAME         the run's folder under it (default: the measurement's label)
    --note TEXT         a line for whoever reads the run's options later
    --allow-other-econ  export with an econ that is not at the commit of the registry's ECON_REF
The other options are tools.export's: --node, --cluster, --family, --variant, --precision, --tp, --dp, --job, ...

The registry exports every record with one econ, the commit in ECON_REF, so that exporting a run again gives the same
bytes. --econ-src must be a checkout at that commit.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys

from . import export, read_json, slug, validate, write_json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def place(measure, group=None, name=None):
    """(group, name): where a measurement's run goes under sources/, from what it says of itself."""
    gpu = ((measure.get("gpu_info") or [{}])[0].get("name") or "gpu").replace("NVIDIA ", "")
    return group or f"{measure['created'][:10]}_{slug(gpu)}", name or slug(measure["label"])


def gather(run_dir, prices=None):
    """The files of a run to keep, as [(source path, path inside the run's folder)], and the price list's path
    inside it. Only what the exporter reads: a run folder may hold logs and much else."""
    found = export.discover(run_dir)
    if not found["measure"]:
        raise SystemExit(f"{run_dir}: no measure.json there (nor in its measure/ folder)")
    files = [(path, os.path.relpath(path, run_dir)) for path in found.values() if path]
    power = os.path.join(os.path.dirname(found["measure"]), "power.csv")
    if os.path.isfile(power) and not read_json(found["measure"]).get("stability"):  # the exporter reads it then
        files.append((power, os.path.relpath(power, run_dir)))
    inside = None
    if prices:
        if not os.path.isfile(prices):
            raise SystemExit(f"--prices {prices}: no such file")
        try:
            rel = os.path.relpath(os.path.abspath(prices), os.path.abspath(run_dir))
        except ValueError:  # on another drive: not inside the run's folder
            rel = ".."
        inside = rel if not rel.startswith("..") and not os.path.isabs(rel) else os.path.basename(prices)
        if inside not in [r for _, r in files]:
            files.append((prices, inside))
    return files, inside


def add(run_dir, registry, econ, options, prices=None, group=None, name=None, note=None):
    """Put a run in the registry; returns (the run's folder, the record's path, the record). SystemExit, with nothing
    left behind, when the run is already there or does not validate."""
    files, inside = gather(run_dir, prices)
    measure = read_json(export.discover(run_dir)["measure"])
    group, name = place(measure, group, name)
    sources, runs = os.path.join(registry, "sources"), os.path.join(registry, "runs")
    dest = os.path.join(sources, group, name)
    if os.path.exists(dest):
        raise SystemExit(f"{dest} is already in the registry: give the run another --name, or remove that folder first")
    made_group = not os.path.isdir(os.path.dirname(dest))
    written = []

    def undo():
        shutil.rmtree(dest, ignore_errors=True)
        if made_group and os.path.isdir(os.path.dirname(dest)) and not os.listdir(os.path.dirname(dest)):
            os.rmdir(os.path.dirname(dest))
        for path in written:
            os.remove(path)

    try:
        for source, rel in files:
            os.makedirs(os.path.dirname(os.path.join(dest, rel)), exist_ok=True)
            shutil.copyfile(source, os.path.join(dest, rel))
        spec = dict(options, **({"prices": inside.replace(os.sep, "/")} if inside else {}), **({"note": note} if note else {}))
        write_json(os.path.join(dest, export.EXPORT_FILE), spec)
        rec = export.export(next(s for s in export.registry_specs(sources) if os.path.samefile(s["run"], dest)), econ)
        path = os.path.join(runs, rec["id"] + ".json")
        if os.path.exists(path):
            raise SystemExit(f"this run is already in the registry: {path}")
        written.append(export.write(rec, runs))
        bad, _, _ = validate.check_all([runs], sources=sources)
        if bad:
            raise SystemExit("the registry does not validate with this run:\n" + "\n".join(
                f"{p}:\n  " + "\n  ".join(problems) for p, problems in bad.items()))
    except BaseException:
        undo()
        raise
    return dest, path, rec


def pinned(registry, econ, allow):
    """Stop unless econ is the one the registry exports with (ECON_REF), or the caller allows another."""
    pin = os.path.join(registry, "ECON_REF")
    if allow or not os.path.isfile(pin):
        return
    with open(pin, encoding="utf-8") as f:
        want = f.read().strip()
    if econ.commit != want:
        have = econ.commit[:10] if econ.commit else "not a git checkout"
        raise SystemExit(
            f"the registry exports with the econ of gentic at {want[:10]} (ECON_REF), and --econ-src is {have}.\n"
            f"Check that commit out next to yours and give its src folder:\n"
            f"  git -C GENTIC fetch origin {want} && git -C GENTIC worktree add ../gentic-econ-ref FETCH_HEAD\n"
            "To export with another econ anyway: --allow-other-econ, and say so in the pull request.")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m tools.add", description="Add a run of econ to the registry.")
    ap.add_argument("run", help="the folder econ wrote the run to: measure.json, check.json, accuracy.json, provenance.txt")
    ap.add_argument("--econ-src", required=True, help="the src folder of a gentic checkout at the commit of ECON_REF")
    ap.add_argument("--prices", help="the price list the run is priced with: econ's prices file, or a report.json")
    ap.add_argument("--registry", default=ROOT, help="the registry's folder (default: this repository)")
    ap.add_argument("--group", help="the folder under sources/ (default: DATE_GPU of the measurement)")
    ap.add_argument("--name", help="the run's folder under it (default: the measurement's label)")
    ap.add_argument("--note", help="a line for whoever reads the run's options later")
    ap.add_argument("--allow-other-econ", action="store_true", help="export with an econ that is not at ECON_REF")
    export.add_options(ap)
    a = ap.parse_args(argv)
    econ = export.Econ(a.econ_src)
    pinned(a.registry, econ, a.allow_other_econ)
    options = {k: v for k, v in export.options(a).items() if k not in ("run",) + export.PATH_KEYS}
    dest, path, rec = add(a.run, a.registry, econ, options, a.prices, a.group, a.name, a.note)

    def rel(p):
        return os.path.relpath(p, a.registry).replace(os.sep, "/")
    met = sum(1 for p in rec["points"] if p["met"])
    print(f"added to the registry:\n  {rel(dest)}/   (its files and its export.json)\n  {rel(path)}   "
          f"({met} of {len(rec['points'])} latency targets met, econ {rec['econ']['version']})\n"
          f"look at it:\n  python -m tools.build runs --out site    then open site/index.html\n"
          f"and put it in a pull request:\n  git switch -c runs/{rec['id']}\n  git add {rel(dest)} {rel(path)}\n"
          f"  git commit -m \"runs: add {rec['id']}\"\n  git push -u origin runs/{rec['id']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
