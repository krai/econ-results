"""The market snapshot: what providers charge for the most-used open-weight models, and what serving them costs on
each GPU according to public benchmarks. It is the data of the page's Market tab.

    python -m tools.market                 check market/ and say what it holds
    python -m tools.market DIR             the same for another folder

market/ holds one table per file, each a list of rows, as they were read on the snapshot's day:
    models.json       the models, their OpenRouter usage and where their serving cost comes from
    prices.json       every priced OpenRouter endpoint of those models, USD per million tokens
    gpus.json         the GPUs and their USD per GPU-hour: owned, 3-year rent, on demand
    rents.json        the on-demand offers behind each GPU's median
    throughput.json   published benchmark runs: tokens per second per GPU against the speed per user
    mlperf.json       MLPerf Endpoints systems, per GPU
    reference.json    one provider's own published day of traffic and cost
    snapshot.json     when and from where each table was read

`check` says what is wrong with a snapshot; `page` gives what the page needs of it, and nothing else: no address, no
provider's name and no run link. Those stay in the repository's files and its README, where the sources are listed.
The arithmetic on these tables is the page's (web/market-math.js). Standard library only.
"""
from __future__ import annotations

import os
import sys

from . import read_json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOLDER = os.path.join(ROOT, "market")
TABLES = ("models", "prices", "gpus", "rents", "throughput", "mlperf")
COST_SOURCES = ("measured", "proxy", "none")
RUN_FIELDS = ("p90_tok_s_user", "tok_s_gpu", "in_tok_s_gpu", "out_tok_s_gpu", "hit_measured", "hit_trace", "conc", "date")
MODEL_FIELDS = ("model", "name", "author", "rank", "tokens_30d", "share_pct", "in_per_out", "requests_30d", "context",
                "params_total", "params_active", "license", "cost_source", "ix_key", "proxy_of", "cost_note")
GPU_FIELDS = ("chip", "gpu", "vendor", "family", "owned_usd_h", "rent3y_usd_h", "ondemand_usd_h", "ondemand_min",
              "ondemand_max", "ondemand_offers", "tdp_w")


def load(folder=FOLDER):
    """The snapshot of a folder: {table: rows, "reference": {...}, "snapshot": {...}}, or None when there is none."""
    if not os.path.isfile(os.path.join(folder, "snapshot.json")):
        return None
    out = {name: read_json(os.path.join(folder, name + ".json")) for name in TABLES}
    out["reference"] = read_json(os.path.join(folder, "reference.json"))
    out["snapshot"] = read_json(os.path.join(folder, "snapshot.json"))
    return out


def _number(v, low=0.0):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v >= low


def check(snap):
    """The problems of a snapshot: [] when its tables hold together."""
    out = []
    models = {m.get("model") for m in snap["models"]}
    keys = {m.get("ix_key") for m in snap["models"] if m.get("ix_key")}
    chips = {g.get("chip") for g in snap["gpus"]}
    if len(models) != len(snap["models"]):
        out.append("models: a model is listed twice")
    for m in snap["models"]:
        at = f"models/{m.get('model')}"
        if m.get("cost_source") not in COST_SOURCES:
            out.append(f"{at}: cost_source {m.get('cost_source')!r} is not one of {COST_SOURCES}")
        if (m.get("cost_source") == "none") != (not m.get("ix_key")):
            out.append(f"{at}: a model has benchmark runs (ix_key) exactly when its cost has a source")
        if not _number(m.get("tokens_30d"), 1) or not _number(m.get("in_per_out")):
            out.append(f"{at}: its usage is not a number")
    for i, e in enumerate(snap["prices"]):
        at = f"prices[{i}]"
        if e.get("model") not in models:
            out.append(f"{at}: {e.get('model')!r} is not one of the models")
        if not (_number(e.get("input")) and _number(e.get("cached")) and _number(e.get("output")) and e["output"] > 0):
            out.append(f"{at}: prices must be numbers, and the output price above zero")
    for g in snap["gpus"]:
        if not (_number(g.get("owned_usd_h")) and _number(g.get("rent3y_usd_h"))):
            out.append(f"gpus/{g.get('chip')}: owned and 3-year rent must be numbers")
        if g.get("ondemand_usd_h") is not None and not _number(g["ondemand_usd_h"]):
            out.append(f"gpus/{g.get('chip')}: the on-demand price is not a number")
    for i, r in enumerate(snap["rents"]):
        if r.get("chip") not in chips or not _number(r.get("usd_h")):
            out.append(f"rents[{i}]: an unknown GPU, or a price that is not a number")
    for i, r in enumerate(snap["throughput"]):
        at = f"throughput[{i}]"
        if r.get("ix_key") not in keys:
            out.append(f"{at}: no model has the benchmark key {r.get('ix_key')!r}")
        if r.get("chip") not in chips:
            out.append(f"{at}: {r.get('chip')!r} is not one of the GPUs")
        if not (_number(r.get("p90_tok_s_user")) and _number(r.get("tok_s_gpu")) and _number(r.get("out_tok_s_gpu"))
                and _number(r.get("in_tok_s_gpu"))):
            out.append(f"{at}: speed and throughput must be numbers")
    for i, s in enumerate(snap["mlperf"]):
        if not _number(s.get("gpus"), 1) or not any(_number(s.get(f"out_tok_s_gpu_at_{t}")) for t in (20, 50, 100)):
            out.append(f"mlperf[{i}]: a system needs its GPUs and at least one value")
    if not isinstance(snap["reference"].get("deepseek_2025"), dict):
        out.append("reference: no deepseek_2025")
    if not snap["snapshot"].get("as_of"):
        out.append("snapshot: no as_of date")
    return out


def _curves(rows):
    """Benchmark runs grouped as the page reads them: one curve per model key, GPU, recipe and benchmark date, its
    runs as rows of RUN_FIELDS."""
    curves = {}
    for r in rows:
        key = (r["ix_key"], r["chip"], r["recipe"], r["curve"])
        curve = curves.setdefault(key, {"key": r["ix_key"], "chip": r["chip"], "recipe": r["recipe"],
                                        "engine": r["engine"], "gpus": r["gpus"], "runs": []})
        curve["runs"].append([r.get(f) for f in RUN_FIELDS])
    return list(curves.values())


def _system(s):
    """An MLPerf system as the page names it: KRAI's by its own name, any other by its hardware and software."""
    ours = (s.get("org") or "").lower() == "krai"
    label = s["system"] if ours else s["system"].split(" · ", 1)[-1]
    return {"label": label, "ours": ours, "submission": s["submission"] if ours else None, "chip": s["chip"], "gpus": s["gpus"],
            "status": s["status"], "published": s["published"],
            "at": {str(t): s.get(f"out_tok_s_gpu_at_{t}") for t in (20, 50, 100)}}


def page(snap):
    """What the page holds of a snapshot. Endpoints carry their prices and quantisation, not who sells them."""
    prices = {}
    for e in snap["prices"]:
        prices.setdefault(e["model"], []).append([e["input"], e["output"], e["cached"], 1 if e.get("cached_listed") else 0,
                                                  e.get("discount_pct") or 0, e.get("quantization") or "unknown"])
    providers = {}
    for e in snap["prices"]:
        providers.setdefault(e["model"], set()).add(e["provider"])
    reference = {k: v for k, v in snap["reference"]["deepseek_2025"].items() if k != "url"}
    return {"schema": snap["snapshot"]["schema"], "as_of": snap["snapshot"]["as_of"],
            "usage_window": snap["snapshot"]["usage_window"],
            "models": [dict({f: m.get(f) for f in MODEL_FIELDS}, providers=len(providers.get(m["model"], ())))
                       for m in sorted(snap["models"], key=lambda m: m["rank"])],
            "gpus": [{f: g.get(f) for f in GPU_FIELDS} for g in snap["gpus"]],
            "prices": prices, "run_fields": list(RUN_FIELDS), "curves": _curves(snap["throughput"]),
            "mlperf": [_system(s) for s in snap["mlperf"]], "reference": reference}


def main(argv=None):
    folder = (argv if argv is not None else sys.argv[1:] or [FOLDER])[0]
    snap = load(folder)
    if snap is None:
        print(f"{folder}: no snapshot.json there")
        return 1
    problems = check(snap)
    for p in problems:
        print(p)
    if problems:
        return 1
    print(f"{folder}: as of {snap['snapshot']['as_of']}: {len(snap['models'])} models, {len(snap['prices'])} priced endpoints, "
          f"{len(snap['gpus'])} GPUs with {len(snap['rents'])} on-demand offers, {len(snap['throughput'])} benchmark runs, "
          f"{len(snap['mlperf'])} MLPerf systems")
    return 0


if __name__ == "__main__":
    sys.exit(main())
