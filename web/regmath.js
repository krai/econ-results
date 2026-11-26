/* The registry's arithmetic on econ's numbers, with no page around it: how fast one user's tokens arrive, a run priced
   with the choices of the page (through EconMath, econ's own formulas), a configuration read at a speed it was not
   measured at (econ's same-speed rule), the frontier of a set of points, a run's place among the runs of its
   configuration, and the geometry of a treemap and of an axis. Under node it is the tests' way in. */
(function (root) {
  "use strict";
  const E = root.EconMath;
  const M = {SPEED_SPAN: 2};  // econ's report.SPEED_SPAN: points further apart in speed are not joined by a line
  const has = (v) => v !== null && v !== undefined && !(typeof v === "number" && !Number.isFinite(v));
  M.has = has;

  // Tokens per second that one user receives at a point: 1,000 / the TPOT of the median, 90th or 99th percentile
  const TPOT = {p50: "p50_tpot_ms", p90: "p90_tpot_ms", p99: "p99_tpot_ms"};
  M.speed = (p, q) => (has(p[TPOT[q]]) && p[TPOT[q]] > 0 ? 1000 / p[TPOT[q]] : null);

  // The most common price pair of a snapshot (econ's `common`), with the median cached-input price of the endpoints
  // that charge that pair, else of all of them
  M.market = function (prices) {
    if (!prices || !prices.common || !has(prices.common.output)) return null;
    const eps = prices.by_endpoint || [];
    const cachedOf = (list) => { const v = list.map((e) => e.cached_input).filter(has); return v.length ? E.pct(v, 50) : null; };
    const same = cachedOf(eps.filter((e) => e.input === prices.common.input && e.output === prices.common.output));
    return {input: prices.common.input, output: prices.common.output, cached: has(same) ? same : cachedOf(eps),
            endpoints: prices.common.endpoints};
  };

  // One point priced: price {input, output, cached}, rent per GPU-hour (or null), a {u: utilisation 0-1, cached: share
  // of the input at the cached price 0-1, kwh: USD per kWh, pue}. Revenue is at full load; the utilisation scales the
  // margin and the rent per token.
  M.sums = function (p, price, rent, a) {
    const c = a.cached || 0, u = has(a.u) ? a.u : 1;
    const pin = c > 0 && has(price.cached) ? (1 - c) * price.input + c * price.cached : price.input;
    const rev = E.revenue(p.input_tok_s, p.output_tok_s, pin, price.output, p.gpus);
    const perM = has(rent) ? E.costPerMillion(rent, p.gpus, p.output_tok_s, u) : null;
    const watts = p.node_power_w;
    return {pin, rev, be: has(rent) ? E.breakEven(rent, rev) : null, margin: has(rent) ? E.margin(rent, rev, u) : null,
            perM, tokPerUsd: has(perM) && perM > 0 ? 1e6 / perM : null,
            elec: has(watts) && has(a.kwh) ? watts / p.gpus / 1000 * (a.pue || 1) * a.kwh : null};
  };

  // The value of a metric at a point: x is M.sums of the point, or null where the point has no price
  M.metric = function (key, p, x) {
    if (key === "out") return has(p.output_tok_s) ? p.output_tok_s / p.gpus : null;
    if (key === "tokj") return has(p.tok_per_j) ? p.tok_per_j : null;
    if (!x) return null;
    return {usd: x.rev, tokusd: has(x.tokPerUsd) ? x.tokPerUsd / 1e6 : null, cost: x.perM}[key];
  };

  // [value, measured] of a curve at a speed, from its [speed, value] points sorted by speed: its own point there, or
  // the straight line between its two neighbours; null outside its points, or between two that are more than
  // SPEED_SPAN apart in speed. econ's report.at_speed, operation for operation.
  M.atSpeed = function (pts, speed) {
    for (const [s, v] of pts) if (Math.abs(s - speed) <= 1e-9 * speed) return [v, true];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [s0, v0] = pts[i], [s1, v1] = pts[i + 1];
      if (s0 < speed && speed < s1) return s1 <= s0 * M.SPEED_SPAN ? [v0 + (v1 - v0) * (speed - s0) / (s1 - s0), false] : null;
    }
    return null;
  };

  // Which of [{x, y}] are on the frontier: no other point is at least as fast per user (x) and at least as good in y,
  // and better in one of the two. lower: y is a cost, less is better.
  M.frontier = function (pts, lower) {
    const better = (a, b) => (lower ? a < b : a > b);
    return pts.map((p, i) => !pts.some((q, j) => j !== i && q.x >= p.x && !better(p.y, q.y) && (q.x > p.x || better(q.y, p.y))));
  };

  // A configuration, whatever the day and the versions it ran with: the model, the family and its variant, the
  // tensor-parallel size and the GPUs. Two runs with one key are the same configuration measured twice.
  M.key = (r) => [r.model.id, r.config.family, r.config.variant || "", "tp" + (r.config.tp || "?"),
                  r.hardware.gpu + "x" + r.hardware.gpus].join("|");
  M.byDate = (records) => records.slice().sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : 0));
  // The latest run of each configuration on or before a day ("2026-11-17"), oldest configuration first
  M.asOf = function (records, day) {
    const last = new Map();
    for (const r of M.byDate(records)) if (!day || r.created.slice(0, 10) <= day) last.set(M.key(r), r);
    return Array.from(last.values());
  };
  // The run of the same configuration right before this one, or null
  M.previous = function (records, r) {
    const before = M.byDate(records).filter((o) => M.key(o) === M.key(r) && o.created < r.created);
    return before.length ? before[before.length - 1] : null;
  };
  M.change = (now, before) => (has(now) && has(before) && before !== 0 ? (now - before) / Math.abs(before) : null);
  // The met point of a run at a TPOT limit; "loosest": its loosest met target
  M.at = function (r, limit) {
    const met = (r.points || []).filter((p) => p.met && has(p.output_tok_s));
    if (limit === "loosest") return met.slice().sort((a, b) => b.tpot_limit - a.tpot_limit)[0] || null;
    return met.find((p) => p.tpot_limit === Number(limit)) || null;
  };

  // A squarified treemap: the rectangles {x, y, w, h} of `values` inside one rectangle, each with an area in
  // proportion to its value, laid out largest first in rows along the shorter side so that they stay near square.
  // A value that is not positive gets null.
  M.squarify = function (values, x, y, w, h) {
    const out = values.map(() => null);
    const order = values.map((_, i) => i).filter((i) => values[i] > 0).sort((a, b) => values[b] - values[a]);
    const total = order.reduce((s, i) => s + values[i], 0);
    if (!(total > 0) || !(w > 0) || !(h > 0)) return out;
    const scale = w * h / total;
    const worst = (areas, sum, side) => (areas.length
      ? Math.max(side * side * Math.max(...areas) / (sum * sum), sum * sum / (side * side * Math.min(...areas))) : Infinity);
    let rect = {x, y, w, h}, row = [], sum = 0, i = 0;
    const flush = () => {
      const wide = rect.w >= rect.h, thick = sum / (wide ? rect.h : rect.w);
      let off = 0;
      for (const k of row) {
        const len = values[k] * scale / thick;
        out[k] = wide ? {x: rect.x, y: rect.y + off, w: thick, h: len} : {x: rect.x + off, y: rect.y, w: len, h: thick};
        off += len;
      }
      rect = wide ? {x: rect.x + thick, y: rect.y, w: rect.w - thick, h: rect.h}
        : {x: rect.x, y: rect.y + thick, w: rect.w, h: rect.h - thick};
      row = [];
      sum = 0;
    };
    while (i < order.length) {
      const area = values[order[i]] * scale, side = Math.min(rect.w, rect.h), areas = row.map((k) => values[k] * scale);
      if (!row.length || worst(areas.concat([area]), sum + area, side) <= worst(areas, sum, side)) {
        row.push(order[i]);
        sum += area;
        i++;
      } else flush();
    }
    if (row.length) flush();
    return out;
  };

  // Round tick values from lo to hi, about n of them; and for a log axis, the 1-2-5 values between lo and hi
  M.niceTicks = function (lo, hi, n = 5) {
    if (!(hi > lo)) return [lo];
    const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw);
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
    return out;
  };
  M.logTicks = function (lo, hi) {
    const out = [];
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
      for (const f of [1, 2, 5]) { const v = +(f * Math.pow(10, e)).toPrecision(12); if (v >= lo && v <= hi) out.push(v); }
    }
    return out.length ? out : [lo, hi];
  };

  root.RegMath = M;
})(typeof window !== "undefined" ? window : globalThis);
