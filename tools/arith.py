"""The page's arithmetic in Python: the same checks as web/vendor/math.js's EconMath.check, value for value, on a
record's points. A record carries econ's priced numbers (worth, cost); this recomputes each of them from the measured
numbers, the price snapshot and the rents next to them, so a record whose numbers were edited by hand, or priced with
another snapshot than the one it holds, does not validate.

    checked, mismatches = check(record)        mismatches: ["what: recomputed X, the record has Y"]

It is a check, not a second source of numbers: nothing in the site is priced with this module.
"""
from __future__ import annotations

import math

DAYS = 30  # econ's month of cost and tokens
TOLERANCE = 1e-9
SPEED_SPAN = 2.0  # econ's report.SPEED_SPAN


def revenue(input_tok_s, output_tok_s, input_price, output_price, gpus):
    return (input_tok_s * input_price + output_tok_s * output_price) / 1e6 * 3600 / gpus


def break_even(rent, rev):
    return rent / rev if rev > 0 else None


def cost_per_million(rent, gpus, tok_s, utilization=1.0):
    return rent * gpus / (tok_s * 3600 * utilization) * 1e6 if tok_s > 0 and utilization > 0 else None


def margin(rent, rev, utilization=1.0):
    return rev * utilization - rent


def pct(values, q):
    """The q-th percentile, with linear interpolation between the two nearest values."""
    v = sorted(values)
    if not v:
        return None
    pos = (len(v) - 1) * q / 100
    lo, hi = math.floor(pos), math.ceil(pos)
    return v[lo] + (v[hi] - v[lo]) * (pos - lo)


def at_speed(pts, speed):
    """[value, measured] of a curve at a speed per user, from its (speed, value) points sorted by speed: its own point
    there, or the straight line between its two neighbours; None outside its points, or between two that are more
    than SPEED_SPAN apart in speed. econ's report.at_speed, and the page's RegMath.atSpeed."""
    for s, v in pts:
        if abs(s - speed) <= 1e-9 * speed:
            return [v, True]
    for (s0, v0), (s1, v1) in zip(pts, pts[1:]):
        if s0 < speed < s1:
            return [v0 + (v1 - v0) * (speed - s0) / (s1 - s0), False] if s1 <= s0 * SPEED_SPAN else None
    return None


def same(got, want):
    if isinstance(got, (int, float)) and isinstance(want, (int, float)):
        return abs(got - want) <= TOLERANCE * max(1.0, abs(want))
    return got == want


def check(record):
    """(values checked, mismatches) of a record's priced numbers."""
    bad, count = [], 0

    def expect(what, got, want):
        nonlocal count
        count += 1
        if not same(got, want):
            bad.append(f"{what}: recomputed {got}, the record has {want}")

    endpoints = (record.get("prices") or {}).get("by_endpoint")
    for p in record.get("points") or []:
        at = f"{p.get('config')}, {p.get('slo')}"
        w = p.get("worth")
        if w and w.get("common"):
            _worth(p, w, endpoints, at, expect)
        if p.get("cost"):
            expect(f"{at}: output tokens in 30 days", p["output_tok_s"] * 86400 * DAYS, p.get("output_tokens_30d"))
            for c in p["cost"]:
                expect(f"{at}, rent {c['rent']}: the node for 30 days", c["rent"] * p["gpus"] * 24 * DAYS, c["node_30d"])
                for u, v in c["per_m_output"].items():
                    expect(f"{at}, rent {c['rent']}: cost per M output at {u}",
                           cost_per_million(c["rent"], p["gpus"], p["output_tok_s"], float(u)), v)
    return count, bad


def _worth(p, w, endpoints, at, expect):
    tin, tout, gpus = p["input_tok_s"], p["output_tok_s"], p["gpus"]
    rev = revenue(tin, tout, w["common"]["input"], w["common"]["output"], gpus)
    expect(f"{at}: revenue at the most common price", rev, w["common"]["revenue"])
    revs = [revenue(tin, tout, e["input"], e["output"], gpus) for e in endpoints] if endpoints else None
    if revs:
        expect(f"{at}: endpoints priced", len(revs), w["endpoints"])
        for key, q in (("min", 0), ("p25", 25), ("median", 50), ("p75", 75), ("max", 100)):
            expect(f"{at}: revenue {key} over the endpoints", pct(revs, q), w["revenue"][key])
    for r in w.get("rents") or []:
        on = f"{at}, rent {r['rent']}"
        expect(f"{on}: break-even", break_even(r["rent"], rev), r["break_even_common"])
        expect(f"{on}: break-even at the median price", break_even(r["rent"], w["revenue"]["median"]),
               r["break_even_median"])
        if revs:
            expect(f"{on}: endpoints paying it", sum(1 for v in revs if v >= r["rent"]), r["endpoints_above_rent"])
        for u, v in r["margin_common"].items():
            expect(f"{on}: margin at {u}", margin(r["rent"], rev, float(u)), v)
        for u, v in r["cost_per_m_output"].items():
            expect(f"{on}: rent per M output at {u}", cost_per_million(r["rent"], gpus, tout, float(u)), v)
