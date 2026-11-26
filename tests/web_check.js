/* The page's arithmetic under node: econ's own check of every record given, the registry's way to a price against
   econ's numbers, the same-speed rule against the values econ computed (tests/golden/same_speed.json), and the
   geometry. Run by tests/test_web.py: node tests/web_check.js INPUT.json; prints a JSON summary, exits 1 on a
   difference. */
"use strict";
const fs = require("fs");
const path = require("path");
require(path.join(__dirname, "..", "web", "vendor", "math.js"));
require(path.join(__dirname, "..", "web", "regmath.js"));
const E = globalThis.EconMath, M = globalThis.RegMath;
const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const bad = [];
const close = (a, b) => a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))) ||
  (Array.isArray(a) && Array.isArray(b) && JSON.stringify(a) === JSON.stringify(b));
const expect = (what, got, want) => { if (!close(got, want)) bad.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

let checked = 0, priced = 0;
input.records.forEach((r, i) => {
  const c = E.check({points: r.points, prices: r.prices});
  checked += c.checked;
  bad.push(...c.mismatches);
  expect(`${r.id}: values checked, against the Python check`, c.checked, input.counts[i]);
  const mk = M.market(r.prices);
  for (const p of r.points) {
    if (!mk || !p.worth || !p.worth.common) continue;
    for (const row of p.worth.rents || []) {
      const x = M.sums(p, mk, row.rent, {u: 1, cached: 0});
      expect(`${r.id}: revenue`, x.rev, p.worth.common.revenue);
      expect(`${r.id}: break-even`, x.be, row.break_even_common);
      expect(`${r.id}: margin`, x.margin, row.margin_common["1"]);
      expect(`${r.id}: rent per M`, x.perM, row.cost_per_m_output["1"]);
      expect(`${r.id}: tokens per USD`, x.tokPerUsd, 1e6 / row.cost_per_m_output["1"]);
      priced += 5;
    }
    const half = M.sums(p, mk, p.worth.rents[0].rent, {u: 0.5, cached: 0});
    expect(`${r.id}: margin at half load`, half.margin, p.worth.rents[0].margin_common["0.5"]);
    expect(`${r.id}: rent per M at half load`, half.perM, p.worth.rents[0].cost_per_m_output["0.5"]);
    expect(`${r.id}: output per GPU`, M.metric("out", p, null), p.output_tok_s / p.gpus);
  }
});

expect("the span of the same-speed rule", M.SPEED_SPAN, input.golden.span);
for (const c of input.golden.cases) {
  const got = M.atSpeed(c.points, c.speed);
  if (c.expect === null || got === null) expect(`at ${c.speed}`, got, c.expect);
  else { expect(`at ${c.speed}: value`, got[0], c.expect[0]); expect(`at ${c.speed}: measured`, got[1], c.expect[1]); }
}

// geometry: a treemap keeps every area in proportion and inside its box; a frontier keeps what nothing beats
const values = [50, 30, 10, 5, 3, 0, 2], box = M.squarify(values, 10, 20, 400, 250), total = values.reduce((a, b) => a + b, 0);
values.forEach((v, i) => {
  if (v <= 0) { expect(`tile ${i} of no value`, box[i], null); return; }
  expect(`tile ${i}: area`, box[i].w * box[i].h, v / total * 400 * 250);
  if (box[i].x < 10 - 1e-9 || box[i].y < 20 - 1e-9 || box[i].x + box[i].w > 410 + 1e-9 || box[i].y + box[i].h > 270 + 1e-9) bad.push(`tile ${i} leaves the box`);
});
expect("frontier, more is better", M.frontier([{x: 30, y: 600}, {x: 60, y: 400}, {x: 40, y: 380}, {x: 110, y: 120}, {x: 60, y: 300}], false), [true, true, false, true, false]);
expect("frontier, less is better", M.frontier([{x: 30, y: 2}, {x: 60, y: 3}, {x: 40, y: 4}], true), [true, true, false]);
expect("ticks", M.niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
expect("log ticks", M.logTicks(0.5, 30), [0.5, 1, 2, 5, 10, 20]);

console.log(JSON.stringify({records: input.records.length, checked, priced, cases: input.golden.cases.length, bad}));
process.exit(bad.length ? 1 : 0);
