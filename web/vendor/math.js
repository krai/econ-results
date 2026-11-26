/* econ's arithmetic in the browser: economics.py's formulas and stats.pct, operation for operation, and EconMath.check,
   which recomputes every priced number of a report.json and lists what differs; and EconMath.scopeText, a power
   scope in the report's words. The dashboard (econ.js) and the demo (demo.js) price with it; under node it is the
   test's way in. */
(function (root) {
  "use strict";
  // economics.py and stats.pct, operation for operation, so that the check can ask for the same numbers
  const E = {
    revenue: (tin, tout, pin, pout, gpus) => (tin * pin + tout * pout) / 1e6 * 3600 / gpus,
    breakEven: (rent, revenue) => (revenue > 0 ? rent / revenue : null),
    costPerMillion: (rent, gpus, tok, u = 1) => (tok > 0 && u > 0 ? rent * gpus / (tok * 3600 * u) * 1e6 : null),
    margin: (rent, revenue, u = 1) => revenue * u - rent,
    pct(values, q) {
      const v = values.slice().sort((a, b) => a - b);
      if (!v.length) return null;
      const pos = (v.length - 1) * q / 100, lo = Math.floor(pos), hi = Math.ceil(pos);
      return v[lo] + (v[hi] - v[lo]) * (pos - lo);
    },
    days: 30,  // economics.DAYS: a month of cost and tokens
  };
  E.node30d = (rent, gpus) => rent * gpus * 24 * E.days;
  E.tokens30d = (tok) => tok * 86400 * E.days;

  // What a power scope (power.scopes) covers, in the words of evaluation.scope_text: the dashboard and the demo say it
  // as the report does
  E.scopeText = function (pw) {
    const scope = String(pw.scope), n = pw.gpus_seen, m = pw.nvswitches;
    if (scope.indexOf("node") === 0) return "the node's own meter";
    let text = n ? `every GPU board (${n} GPU${n !== 1 ? "s" : ""})` : "every GPU board";
    if (scope.indexOf("CPU") >= 0) text += " + CPU packages";
    if (scope.indexOf("NvSwitch") >= 0) {
      text += m ? ` + ${Math.trunc(m)} NvSwitch${m !== 1 ? "es" : ""}` : " + NvSwitches";
    }
    return text;
  };

  // Every priced number of a report.json, recomputed here: {checked, mismatches}
  E.check = function (rep) {
    const bad = [], eps = rep.prices && rep.prices.by_endpoint;
    let checked = 0;
    const expect = (what, got, want) => {
      checked++;
      const close = typeof got === "number" && typeof want === "number" &&
        Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want));
      if (got !== want && !close) bad.push(`${what}: the page has ${got}, econ ${want}`);
    };
    for (const p of rep.points || []) {
      const w = p.worth;
      if (!w || !w.common) continue;
      const at = `${p.config}, ${p.slo}`;
      const rev = E.revenue(p.input_tok_s, p.output_tok_s, w.common.input, w.common.output, p.gpus);
      expect(`${at}: revenue at the most common price`, rev, w.common.revenue);
      const revs = eps ? eps.map((e) => E.revenue(p.input_tok_s, p.output_tok_s, e.input, e.output, p.gpus)) : null;
      if (revs) {
        expect(`${at}: endpoints priced`, revs.length, w.endpoints);
        for (const [k, q] of [["min", 0], ["p25", 25], ["median", 50], ["p75", 75], ["max", 100]]) {
          expect(`${at}: revenue ${k} over the endpoints`, E.pct(revs, q), w.revenue[k]);
        }
      }
      for (const r of w.rents || []) {
        const on = `${at}, rent ${r.rent}`;
        expect(`${on}: break-even`, E.breakEven(r.rent, rev), r.break_even_common);
        expect(`${on}: break-even at the median price`, E.breakEven(r.rent, w.revenue.median), r.break_even_median);
        if (revs) expect(`${on}: endpoints paying it`, revs.filter((v) => v >= r.rent).length, r.endpoints_above_rent);
        for (const [u, v] of Object.entries(r.margin_common)) expect(`${on}: margin at ${u}`, E.margin(r.rent, rev, Number(u)), v);
        for (const [u, v] of Object.entries(r.cost_per_m_output)) {
          expect(`${on}: rent per M output at ${u}`, E.costPerMillion(r.rent, p.gpus, p.output_tok_s, Number(u)), v);
        }
      }
    }
    for (const p of rep.points || []) {  // the cost over 30 days, at each rent, whatever the prices
      if (!p.cost) continue;
      const at = `${p.config}, ${p.slo}`;
      expect(`${at}: output tokens in 30 days`, E.tokens30d(p.output_tok_s), p.output_tokens_30d);
      for (const c of p.cost) {
        expect(`${at}, rent ${c.rent}: the node for 30 days`, E.node30d(c.rent, p.gpus), c.node_30d);
        for (const [u, v] of Object.entries(c.per_m_output)) {
          expect(`${at}, rent ${c.rent}: cost per M output at ${u}`, E.costPerMillion(c.rent, p.gpus, p.output_tok_s, Number(u)), v);
        }
      }
    }
    return {checked, mismatches: bad};
  };
  root.EconMath = E;
})(typeof window !== "undefined" ? window : globalThis);
