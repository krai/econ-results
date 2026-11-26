"""A made-up run for the tests, in the shape the exporter writes. No number here was measured on any node: the tests
of this public repository hold no real results. Its priced numbers are computed with tools/arith.py, so a sample
record is consistent the way an exported one is."""
from __future__ import annotations

import copy

from tools import SCHEMA, arith, run_id

ENDPOINTS = [
    {"provider": "Alpha Cloud", "tag": "alpha/fp8", "quantization": "fp8", "input": 0.10, "output": 0.40,
     "cached_input": 0.01},
    {"provider": "Beta Compute", "tag": "beta/fp8", "quantization": "fp8", "input": 0.30, "output": 1.20,
     "cached_input": 0.03},
    {"provider": "Gamma AI", "tag": "gamma", "quantization": "unknown", "input": 0.30, "output": 1.20,
     "cached_input": None},
    {"provider": "Delta Hosting", "tag": "delta/fp4", "quantization": "fp4", "input": 0.50, "output": 2.00,
     "cached_input": 0.05},
]
COMMON = {"input": 0.30, "output": 1.20, "endpoints": 2}
RENTS = [2.0, 1.0]


def worth(p, endpoints=ENDPOINTS, rents=RENTS, common=COMMON):
    """econ's `worth` of a point, in its shape."""
    tin, tout, gpus = p["input_tok_s"], p["output_tok_s"], p["gpus"]
    revs = sorted(arith.revenue(tin, tout, e["input"], e["output"], gpus) for e in endpoints)
    rev = arith.revenue(tin, tout, common["input"], common["output"], gpus)
    quart = {"min": revs[0], "p25": arith.pct(revs, 25), "median": arith.pct(revs, 50), "p75": arith.pct(revs, 75),
             "max": revs[-1]}
    return {"endpoints": len(revs), "revenue": quart, "common": dict(common, revenue=rev), "rents": [{
        "rent": r, "break_even_common": arith.break_even(r, rev), "break_even_median": arith.break_even(r, quart["median"]),
        "endpoints_above_rent": sum(1 for v in revs if v >= r),
        "margin_common": {u: arith.margin(r, rev, float(u)) for u in ("1", "0.7", "0.5")},
        "cost_per_m_output": {u: arith.cost_per_million(r, gpus, tout, float(u)) for u in ("1", "0.7", "0.5")}}
        for r in rents]}


def point(label, gpus, tpot, rate, out_per_gpu, p50, met=True, rents=RENTS):
    """One target of the sample: made-up throughput and latencies that keep the format's ranges."""
    slo = f"TTFT p99 <= 2 s, TPOT p99 <= {tpot:g} ms"
    if not met:
        return {"config": label, "slo": slo, "source": "measure.json", "met": False, "note": "not confirmed", "gpus": gpus,
                "tpot_limit": float(tpot), "ttft_limit": 2000.0, "rate_rps": None, "output_tok_s": None,
                "input_tok_s": None, "repeats": 2, "input_known": True}
    out = out_per_gpu * gpus
    watts = 300.0 * gpus
    p = {"config": label, "slo": slo, "source": "measure.json", "met": True, "note": "", "gpus": gpus,
         "tpot_limit": float(tpot), "ttft_limit": 2000.0, "rate_rps": rate, "request_s": rate * 0.98,
         "input_tok_s": out * 4.0, "output_tok_s": out, "p50_ttft_ms": 120.0, "p90_ttft_ms": 300.0, "p99_ttft_ms": 600.0,
         "p50_tpot_ms": p50, "p90_tpot_ms": p50 * 1.2, "p99_tpot_ms": tpot * 0.9, "mean_input_tokens": 1800.0,
         "mean_output_tokens": 450.0, "node_power_w": watts, "tok_per_j": out / watts, "failed": 0.0, "repeats": 2,
         "steady": True, "client_busy": False, "input_known": True,
         "spread_pct": {"output_tok_s": 4.0, "p99_tpot_ms": 6.0, "p99_ttft_ms": 9.0},
         "pooled": {"requests": 800, "p99_ttft_ms": 610.0, "p99_ttft_ci_ms": [520.0, 700.0], "p99_tpot_ms": tpot * 0.9,
                    "p99_tpot_ci_ms": [tpot * 0.85, tpot * 0.97], "margin": "clear"}}
    p["worth"] = worth(p, rents=rents)
    p["cost"] = [{"rent": r, "node_hour": r * gpus, "node_30d": r * gpus * 24 * arith.DAYS,
                  "per_m_output": {u: arith.cost_per_million(r, gpus, out, float(u)) for u in ("1", "0.5")}}
                 for r in rents]
    p["output_tokens_30d"] = out * 86400 * arith.DAYS
    return p


def window(p, scale):
    return {"rate_rps": p["rate_rps"], "measured": 400, "failed": 0, "input_tok_s": p["input_tok_s"] * scale,
            "output_tok_s": p["output_tok_s"] * scale, "p50_tpot_ms": p["p50_tpot_ms"], "p90_tpot_ms": p["p90_tpot_ms"],
            "p99_tpot_ms": p["p99_tpot_ms"], "p99_ttft_ms": p["p99_ttft_ms"],
            "p99_tpot_ci_ms": [p["p99_tpot_ms"] * 0.9, p["p99_tpot_ms"] * 1.1], "p99_ttft_ci_ms": [500.0, None],
            "node_power_w": p["node_power_w"], "tok_per_j": p["tok_per_j"] * scale, "window_s": 120.0, "steady": True}


def record(label="sample-tp2", created="2026-01-05T10:00:00", gpus=2, family="recipe", version="1.2.0", scale=1.0,
           targets=((50, 4.0, 500.0, 30.0), (20, 2.0, 260.0, 14.0)), missed=(10,), host="buildhost7",
           taken="2026-01-05T09:00Z", model="acme/Sample-Model-FP8"):
    """An internal record of a made-up run: `targets` are (TPOT limit, req/s, output tok/s per GPU, median TPOT)."""
    points = [point(label, gpus, t, rate * scale, out * scale, p50) for t, rate, out, p50 in targets]
    points += [point(label, gpus, t, None, None, None, met=False) for t in missed]
    results = [{"slo": {"label": p["slo"], "tpot_p99_ms": p["tpot_limit"], "ttft_p99_ms": 2000.0}, "met": bool(p["met"]),
                "rate_rps": p["rate_rps"], "note": p["note"], "probes": 6,
                "windows": [window(p, 0.98), window(p, 1.02)] if p["met"] else []} for p in points]
    curve = [{"x": p["output_tok_s"] / gpus, "y": p["p99_tpot_ms"], "ttft": p["p99_ttft_ms"], "rate": p["rate_rps"],
              "kind": "confirmed", "final": True, "target": p["slo"], "y_ci": p["pooled"]["p99_tpot_ci_ms"]}
             for p in points if p["met"]]
    curve += [{"x": 80.0 * (i + 1), "y": 9.0 + 4 * i, "ttft": 200.0, "rate": 0.5 * (i + 1), "kind": "probe", "final": False}
              for i in range(4)]
    return {
        "schema": SCHEMA, "id": run_id(label, created, model, gpus), "created": created, "visibility": "internal",
        "econ": {"version": "0.0.9", "commit": "0123456789abcdef0123456789abcdef01234567",
                 "exporter": {"version": "0.0.9", "commit": "0123456789abcdef0123456789abcdef01234567",
                              "source": "measure.json", "source_version": "0.0.9"}},
        "model": {"id": model, "name": model.rpartition("/")[2], "precision": "FP8", "max_model_len": 8192,
                  "priced_as": "acme/sample-model"},
        "engine": {"name": "vLLM", "version": version, "build": "release", "commit": None,
                   "image": f"vllm/vllm-openai:v{version}", "digest": "sha256:" + "ab" * 32, "inside": {"vllm": version}},
        "config": {"label": label, "family": family, "variant": None, "tp": gpus, "dp": 1,
                   "flags": ["--tensor-parallel-size", str(gpus)], "env": None, "patch": None,
                   "server_config": "sample.yaml"},
        "hardware": {"gpu": "NVIDIA H200", "gpus": gpus, "gpus_on_node": 8, "driver": "595.58.03", "power_limit_w": 700.0,
                     "memory_mib": 143771.0, "node": "Test node A"},
        "workload": {"mix": "chat-mix", "lengths": "log-normal lengths", "prompts": "random token ids", "seed": 0,
                     "arrival": "Poisson"},
        "method": {"warmup": 45.0, "window": 120.0, "repeats": 2, "min_requests": 400, "search_window": 60.0,
                   "start_rps": 1.0, "growth": 2.0, "bisect_steps": 3},
        "power": {"scope": "GPU boards", "gpus_seen": 8, "notes": ["Node: no power meter to read the whole node from"]},
        "results": results, "points": points, "curve": {"name": label, "points": curve},
        "stability": {"verdict": "PASS", "warnings": 0, "samples": 3600, "seconds": 3600.0, "interval_s": 1.0, "from": None,
                      "rows": [{"check": "GPU 0: Power limit", "result": "held at 700 W", "status": "PASS"}]},
        "health": {"check": {"version": "0.0.9", "created": created, "verdict": "PASS", "warnings": 0, "gpus": 8,
                             "status": {"PASS": 70, "INFO": 2},
                             "rows": [{"check": "GPU 0: Throttling", "result": "at the power limit: normal",
                                       "reference": "the cap is normal at full load", "status": "INFO"}],
                             "system": {"os": "Linux", "cpu": "Some CPU", "cores": 64}},
                   "accuracy": {"benchmark": "gsm8k", "shots": 5, "items": 50, "seed": 0, "correct": 45, "accuracy": 0.9,
                                "ci95": [0.79, 0.96], "strict_accuracy": 0.9, "failed": 0}},
        "prices": {"model": "acme/sample-model", "taken": taken,
                   "source": "https://openrouter.ai/api/v1/models/acme/sample-model/endpoints", "endpoints": len(ENDPOINTS),
                   "providers": 4, "common": dict(COMMON), "by_endpoint": copy.deepcopy(ENDPOINTS)},
        "rents": list(RENTS),
        "findings": [{"level": "INFO", "text": f"{label}: measured with quick settings on {host}."}],
        "not_covered": ["Accuracy: scored on 50 items only"],
        "provenance": {"host": host, "job": "4242", "data_dir": f"/home/someone/runs/{label}",
                       "command": f"econ measure --label {label} --out /home/someone/runs/{label}/measure",
                       "gentic_commit": "0123456789abcdef0123456789abcdef01234567", "image": f"vllm/vllm-openai:v{version}"},
        "files": [{"role": "measure", "name": "measure.json", "sha256": "cd" * 32, "bytes": 1234}]}


ALIASES = {"buildhost7": "Test node A"}
