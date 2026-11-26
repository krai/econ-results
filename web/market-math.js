/* The arithmetic of the Market section, with no page around it: from the snapshot's tables (models, endpoint prices,
   GPU-hour costs, published benchmark runs) to what one GPU earns serving a model at providers' prices, against what
   the GPU costs. Throughput is per GPU, prices are USD per million tokens, costs are USD per GPU-hour, a load is a
   share from 0 to 1. Nothing here is rounded: the page rounds what it prints. Under node it is the tests' way in.

   The choices (params): target, the P90 tokens per second each user must get; basis, how the GPU is paid for ("owned",
   "rent3y", "ondemand"); util, the average load, 0 to 1; price, which endpoint's price ("median", "p25", "min", "max"
   of the endpoints' revenues, or "common", the pair most endpoints list); mix, the tokens sold ("bench": the run's
   own input and output; "openrouter": the run's output with the model's input per output token on OpenRouter;
   "output": output only); cache, the share of input billed at the cached price ("measured" by the server, or the
   "trace" maximum). */
(function (root) {
  "use strict";
  const K = {};
  const has = (v) => v !== null && v !== undefined && !(typeof v === "number" && !Number.isFinite(v));
  const lerp = (a, b, w) => (has(a) && has(b) ? a + (b - a) * w : null);
  K.has = has;
  K.BASES = {owned: "owned_usd_h", rent3y: "rent3y_usd_h", ondemand: "ondemand_usd_h"};
  K.GRID = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 180, 200, 250, 300];

  // The q-th quantile (0 to 1) of a list, between its two nearest values
  K.quantile = function (values, q) {
    const v = values.slice().sort((a, b) => a - b);
    if (!v.length) return null;
    const pos = (v.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
  };

  // The runs of a curve as points, slowest per user first: {speed, tput, inp, out, hit, hitTrace, measured, conc, date}
  K.points = function (market, curve) {
    const f = market.run_fields, at = (run, name) => run[f.indexOf(name)];
    return curve.runs.map((run) => {
      const hm = at(run, "hit_measured"), ht = at(run, "hit_trace");
      return {speed: at(run, "p90_tok_s_user"), tput: at(run, "tok_s_gpu"), inp: at(run, "in_tok_s_gpu"), out: at(run, "out_tok_s_gpu"),
              hit: has(hm) ? hm : ht, hitTrace: ht, measured: has(hm), conc: String(at(run, "conc")), date: at(run, "date")};
    }).filter((p) => has(p.speed) && has(p.tput)).sort((a, b) => a.speed - b.speed);
  };

  // The most tokens per second per GPU that one curve gives while each user gets at least `target` tokens per second:
  // one of its runs at that speed or faster, or the line between the two runs around the target. null: it never does.
  K.atSpeed = function (pts, target) {
    let top = null;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (a.speed <= target && target <= b.speed) {
        const w = b.speed === a.speed ? 0 : (target - a.speed) / (b.speed - a.speed);
        const c = {speed: target, tput: lerp(a.tput, b.tput, w), inp: lerp(a.inp, b.inp, w), out: lerp(a.out, b.out, w),
                   hit: lerp(a.hit, b.hit, w), hitTrace: lerp(a.hitTrace, b.hitTrace, w), measured: a.measured && b.measured,
                   conc: a.conc + "–" + b.conc, date: a.date > b.date ? a.date : b.date, method: "interpolated"};
        if (!top || c.tput > top.tput) top = c;
      }
    }
    for (const p of pts) if (p.speed >= target && (!top || p.tput > top.tput)) top = Object.assign({}, p, {method: "measured"});
    return top;
  };

  // For every model with benchmark runs and every GPU it ran on: the best recipe at the target, how many recipes reach
  // it, and how far the best is above their median. A model whose cost is estimated uses the runs of the model it is
  // estimated from.
  K.frontier = function (market, target) {
    const best = new Map();
    for (const curve of market.curves) {
      const top = K.atSpeed(K.points(market, curve), target);
      if (!top) continue;
      const key = curve.key + "|" + curve.chip;
      if (!best.has(key)) best.set(key, []);
      best.get(key).push(Object.assign(top, {recipe: curve.recipe, engine: curve.engine, gpus: curve.gpus, runs: curve.runs.length}));
    }
    const out = [];
    for (const m of market.models) {
      if (!m.ix_key) continue;
      for (const g of market.gpus) {
        const list = best.get(m.ix_key + "|" + g.chip);
        if (!list) continue;
        const ranked = list.slice().sort((a, b) => b.tput - a.tput), median = K.quantile(ranked.map((x) => x.tput), 0.5);
        out.push(Object.assign({}, ranked[0], {model: m.model, chip: g.chip, recipes: ranked.length, median,
                                               spread: ranked.length > 1 ? ranked[0].tput / median : null}));
      }
    }
    return out;
  };

  K.cost = (gpu, basis) => { const v = gpu[K.BASES[basis] || K.BASES.owned]; return has(v) ? v : null; };
  // The share of the input billed at the cached price, and the input tokens per second sold with the run's output
  K.hit = (f, params) => (params.cache === "trace" ? (has(f.hitTrace) ? f.hitTrace : f.hit || 0) : f.hit || 0);
  K.input = (f, model, params) => (params.mix === "bench" ? f.inp : params.mix === "openrouter" ? f.out * model.in_per_out : 0);
  // USD per GPU-hour at full load, in its three parts: uncached input, cached input, output. price: [input, output, cached]
  K.parts = function (f, model, price, params) {
    const h = K.hit(f, params), i = K.input(f, model, params);
    return [3600 * i * (1 - h) * price[0] / 1e6, 3600 * i * h * price[2] / 1e6, 3600 * f.out * price[1] / 1e6];
  };
  K.revenue = (f, model, price, params) => K.parts(f, model, price, params).reduce((a, b) => a + b, 0);

  // The input and output pair most endpoints list (ties: the cheaper output, then the cheaper input), with the cached
  // price most of those list
  K.common = function (endpoints) {
    const n = new Map();
    for (const e of endpoints) n.set(e[0] + "/" + e[1], (n.get(e[0] + "/" + e[1]) || 0) + 1);
    const pair = Array.from(n.entries()).sort((a, b) => b[1] - a[1] || Number(a[0].split("/")[1]) - Number(b[0].split("/")[1]) ||
      Number(a[0].split("/")[0]) - Number(b[0].split("/")[0]))[0][0];
    const same = endpoints.filter((e) => e[0] + "/" + e[1] === pair), c = new Map();
    for (const e of same) c.set(e[2], (c.get(e[2]) || 0) + 1);
    const cached = Array.from(c.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    return {price: [same[0][0], same[0][1], cached], endpoints: same.length};
  };

  // One model on one GPU: what its throughput earns at the chosen price against what the GPU costs. revs: every
  // endpoint's revenue at full load; rev: the chosen one; breakeven: the load from which the GPU is paid (above 1:
  // never); ratio and profit: at the chosen load; perM: the GPU-hour spread over a million output tokens at that load;
  // covering: the endpoints whose prices pay the GPU at that load; split: the chosen price's revenue by part.
  K.pair = function (market, f, params) {
    const model = market.models.find((m) => m.model === f.model), gpu = market.gpus.find((g) => g.chip === f.chip);
    const endpoints = market.prices[f.model] || [];
    if (!model || !gpu || !endpoints.length) return null;
    const revs = endpoints.map((e) => K.revenue(f, model, e, params));
    let rev, ref;
    if (params.price === "common") { ref = K.common(endpoints).price; rev = K.revenue(f, model, ref, params); }
    else {
      rev = params.price === "min" ? Math.min(...revs) : params.price === "max" ? Math.max(...revs)
        : K.quantile(revs, params.price === "p25" ? 0.25 : 0.5);
      ref = endpoints[revs.reduce((bi, x, k) => (Math.abs(x - rev) < Math.abs(revs[bi] - rev) ? k : bi), 0)];
    }
    const cost = K.cost(gpu, params.basis), ok = has(cost) && rev > 0, u = params.util;
    const parts = K.parts(f, model, ref, params), total = parts[0] + parts[1] + parts[2];
    return {model: f.model, chip: f.chip, f, revs, rev, ref, cost,
            breakeven: ok ? cost / rev : null, ratio: ok ? rev * u / cost : null, profit: has(cost) ? rev * u - cost : null,
            perM: has(cost) && f.out > 0 && u > 0 ? cost / (f.out * 3600 * u) * 1e6 : null,
            endpoints: endpoints.length, covering: has(cost) ? revs.filter((x) => x * u >= cost).length : null,
            split: total > 0 ? parts.map((x) => x / total) : [0, 0, 0]};
  };
  K.pairs = (market, frontier, params) => frontier.map((f) => K.pair(market, f, params)).filter(Boolean);

  // The headline of a set of pairs: how many pay the GPU at the chosen load, which GPU is the cheapest way to serve
  // the most models, and the share of endpoint prices that pay an owned GPU of each family at that load.
  K.family = (gpu) => (gpu.vendor === "AMD" ? "amd" : gpu.family === "Hopper" ? "hopper" : "blackwell");
  K.headline = function (market, pairs, params) {
    const rows = pairs.filter((p) => has(p.breakeven)), fam = new Map(market.gpus.map((g) => [g.chip, K.family(g)]));
    const share = (name) => {
      const rs = rows.filter((p) => fam.get(p.chip) === name);
      const all = rs.reduce((a, p) => a + p.endpoints, 0), ok = rs.reduce((a, p) => a + p.covering, 0);
      return all ? ok / all : null;
    };
    const cheapest = new Map();
    for (const p of rows) if (!cheapest.has(p.model) || p.breakeven < cheapest.get(p.model).breakeven) cheapest.set(p.model, p);
    const tally = new Map();
    for (const p of cheapest.values()) tally.set(p.chip, (tally.get(p.chip) || 0) + 1);
    const top = Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0] || [null, 0];
    return {pairs: rows.length, covered: rows.filter((p) => p.breakeven <= params.util).length, models: cheapest.size,
            topChip: top[0], topChipModels: top[1], cheapest, blackwell: share("blackwell"), hopper: share("hopper"), amd: share("amd")};
  };

  // For one model: per GPU, the best output tokens per second per GPU at each speed per user of the grid
  K.curves = function (market, model, grid) {
    const out = new Map();
    if (!model || !model.ix_key) return [];
    for (const curve of market.curves) {
      if (curve.key !== model.ix_key) continue;
      const pts = K.points(market, curve);
      for (const speed of grid || K.GRID) {
        const top = K.atSpeed(pts, speed);
        if (!top) continue;
        if (!out.has(curve.chip)) out.set(curve.chip, new Map());
        const cur = out.get(curve.chip).get(speed);
        if (!cur || top.tput > cur.tput) out.get(curve.chip).set(speed, {speed, out: top.out, tput: top.tput, recipe: curve.recipe});
      }
    }
    return Array.from(out.entries()).map(([chip, by]) => ({chip, points: Array.from(by.values()).sort((a, b) => a.speed - b.speed)}));
  };

  // A model's endpoint prices: how many, and the lowest, median and highest of each price
  K.priceStats = function (market, model) {
    const list = market.prices[model] || [];
    const of = (k) => { const v = list.map((e) => e[k]); return v.length ? {min: Math.min(...v), median: K.quantile(v, 0.5), max: Math.max(...v)} : null; };
    return {endpoints: list.length, input: of(0), output: of(1), cached: of(2), discounted: list.filter((e) => e[4] > 0).length,
            quantizations: Array.from(new Set(list.map((e) => e[5]))).sort()};
  };

  root.MarketMath = K;
})(typeof window !== "undefined" ? window : globalThis);
