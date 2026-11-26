/* The Market section's arithmetic under node: web/market-math.js on a made-up snapshot whose answers are worked out
   here by hand, and on the repository's own snapshot against the figures the study reported. Run by
   tests/test_market.py: node tests/market_check.js INPUT.json; prints a JSON summary, exits 1 on a difference. */
"use strict";
const fs = require("fs");
const path = require("path");
require(path.join(__dirname, "..", "web", "market-math.js"));
const K = globalThis.MarketMath;
const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const bad = [];
const close = (a, b) => a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)));
const expect = (what, got, want) => { if (!close(got, want)) bad.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

// --- the made-up snapshot: one model with runs, on two GPUs
const m = input.made_up, P = {target: 50, basis: "owned", util: 0.6, price: "median", mix: "bench", cache: "measured"};
expect("quantile, even count", K.quantile([4, 1, 3, 2], 0.5), 2.5);
expect("quantile, a quarter", K.quantile([10, 20, 30, 40, 50], 0.25), 20);
const front = K.frontier(m, 50), g1 = front.find((f) => f.chip === "g1"), g2 = front.find((f) => f.chip === "g2");
expect("frontier rows: the model without runs has none", front.map((f) => f.model + "/" + f.chip).join(","), "alpha-1/g1,alpha-1/g2");
// g1: between the runs at 40 and 80 tok/s per user, a quarter of the way: 9000 - 5000 / 4 = 7750, above the other recipe's 5000
for (const [k, got, want] of [["tput", g1.tput, 7750], ["out", g1.out, 77.5], ["inp", g1.inp, 7672.5], ["hit", g1.hit, 0.9],
                              ["recipes", g1.recipes, 2], ["median", g1.median, 6375], ["spread", g1.spread, 7750 / 6375]]) {
  expect("g1 " + k, got, want);
}
expect("g1 method and recipe", g1.method + " / " + g1.recipe, "interpolated / vllm FP8");
expect("g2 best: a run faster than the target", g2.tput + " / " + g2.method, "3000 / measured");
expect("g2: one recipe has no spread", g2.spread, null);
expect("at 100 tok/s per user nothing reaches the speed", K.frontier(m, 100).length, 0);
// revenue at full load, cheap endpoint: 3600 x (7672.5 x (0.1 x 0.1 + 0.9 x 0.01) + 77.5 x 0.4) / 1e6
const alpha = m.models[0], cheap = m.prices["alpha-1"][0], dear = m.prices["alpha-1"][1];
const rCheap = 3600 * (7672.5 * (0.1 * 0.1 + 0.9 * 0.01) + 77.5 * 0.4) / 1e6, rDear = 3600 * (7672.5 * (0.1 * 0.3 + 0.9 * 0.3) + 77.5 * 1.2) / 1e6;
expect("revenue, cheap endpoint", K.revenue(g1, alpha, cheap, P), rCheap);
expect("revenue, dear endpoint", K.revenue(g1, alpha, dear, P), rDear);
const pair = K.pair(m, g1, P), median = (rCheap + rDear) / 2;
expect("pair: the median of the endpoints", pair.rev, median);
expect("pair: break-even = cost / revenue", pair.breakeven, 1.0 / median);
expect("pair: profit at 60 % load", pair.profit, median * 0.6 - 1.0);
expect("pair: ratio at 60 % load", pair.ratio, median * 0.6 / 1.0);
expect("pair: the GPU-hour over a million output tokens", pair.perM, 1.0 / (77.5 * 3600 * 0.6) * 1e6);
expect("pair: endpoints that pay the GPU", pair.covering + " of " + pair.endpoints, (rCheap * 0.6 >= 1 ? 1 : 0) + (rDear * 0.6 >= 1 ? 1 : 0) + " of 2");
expect("pair: the split adds up", pair.split[0] + pair.split[1] + pair.split[2], 1);
expect("on demand, the dearer GPU-hour", K.pair(m, g1, Object.assign({}, P, {basis: "ondemand"})).cost, 4.0);
expect("a GPU with no on-demand price has no break-even there", K.pair(m, g2, Object.assign({}, P, {basis: "ondemand"})).breakeven, null);
expect("output only: no input is sold", K.revenue(g1, alpha, cheap, Object.assign({}, P, {mix: "output"})), 3600 * 77.5 * 0.4 / 1e6);
expect("OpenRouter's mix: the model's input per output token", K.input(g1, alpha, Object.assign({}, P, {mix: "openrouter"})), 77.5 * 50);
expect("the trace's hit rate", K.hit(g1, Object.assign({}, P, {cache: "trace"})), 0.95);
expect("the common pair of one endpoint each: the cheaper output", K.common(m.prices["alpha-1"]).price.join("/"), "0.1/0.4/0.01");
const head = K.headline(m, K.pairs(m, front, P), P);
expect("headline: pairs", head.pairs, 2);
expect("headline: families", [head.hopper === null, head.amd === null, head.blackwell].join(), "false,false,");
const curve = K.curves(m, alpha, [40, 50, 80, 90]).find((c) => c.chip === "g1");
expect("curve on g1: its speeds", curve.points.map((p) => p.speed).join(), "40,50,80");
expect("curve on g1: output at 40", curve.points[0].out, 90);
expect("price stats", JSON.stringify(K.priceStats(m, "alpha-1")),
  JSON.stringify({endpoints: 2, input: {min: 0.1, median: 0.2, max: 0.3}, output: {min: 0.4, median: 0.8, max: 1.2},
                  cached: {min: 0.01, median: 0.155, max: 0.3}, discounted: 1, quantizations: ["fp4", "fp8"]}));

// --- the repository's snapshot, against what the study reported for it
let ours = null;
if (input.ours) {
  const o = input.ours, f = K.frontier(o, 50), pairs = K.pairs(o, f, P), h = K.headline(o, pairs, P);
  const pct = (v) => (v < 0.1 ? Math.round(1000 * v) / 10 : Math.round(100 * v));
  ours = {pairs: h.pairs, covered: h.covered, top: h.topChip, top_models: h.topChipModels, models: h.models,
          families: [h.blackwell, h.hopper, h.amd].map((v) => Math.round(100 * v)),
          flash: o.gpus.map((g) => { const q = pairs.find((p) => p.model === "deepseek-v4.1-flash" && p.chip === g.chip); return q ? pct(q.breakeven) : null; })};
  for (const [what, got, want] of input.expect_ours.map((e) => [e[0], JSON.stringify(ours[e[0]]), JSON.stringify(e[1])])) expect("ours: " + what, got, want);
}
console.log(JSON.stringify({made_up_pairs: front.length, ours, bad}));
process.exit(bad.length ? 1 : 0);
