/* History: one configuration across its runs, whatever the engine and the version of econ that measured each. A line
   per latency target over the run dates, and the runs as a table with each one's change against the run before. */
(function (root) {
  "use strict";
  const D = root.Dash, R = root.Reg, M = root.RegMath;
  if (!R) return;
  const el = D.el, fmt = D.fmt, has = M.has, S = R.S, C = R.charts;
  const card = R.section("history", "History",
    "The same configuration measured again: on another day, with another engine, with another econ. Each line is one " +
    "latency target; a run that did not meet a target leaves a gap in its line.");

  function render() {
    const scope = R.scope(), keys = Array.from(new Set(scope.map(M.key))), met = R.METRICS[S.hm];
    const runs = scope.filter((r) => M.key(r) === S.hist), name = runs.length ? R.keyName(runs[0]) : "";
    D.replace(card.controls,
      R.pick("Configuration", "hist", keys.map((k) => { const of = scope.filter((r) => M.key(r) === k); return {value: k, label: `${R.keyName(of[0])} (${R.count(of.length, "run")})`}; })),
      R.pick("Value", "hm", Object.entries(R.METRICS).map(([value, m]) => ({value, label: m.label}))));
    if (!runs.length) { D.replace(card.body, el("p", {class: "muted", text: "No runs in scope."})); return; }
    const limits = R.limits.filter((l) => runs.some((r) => M.at(r, l)));
    const value = (r, l) => R.value(S.hm, r, M.at(r, l)), open = (r) => () => { S.run = r.id; R.goto("runs", "run"); };
    const series = limits.map((l, i) => ({name: `TPOT ≤ ${fmt.n(l)} ms`, cls: "o" + Math.min(4, i + 1), kind: "line",
      values: runs.map((r) => (M.at(r, l) ? value(r, l) : null)), picks: runs.map(open),
      rows: runs.map((r, j) => {
        const p = M.at(r, l), before = runs.slice(0, j).reverse().find((o) => M.at(o, l));
        return p ? [[met.show(value(r, l)), met.short], [fmt.n(p.rate_rps, 2), "requests/s"], [R.engine(r), "engine"], [`econ ${r.econ.version}`, "measured with"],
                    before ? [R.signed(M.change(value(r, l), value(before, l))), `against ${R.dateText(before.created, false)}`] : null] : null;
      })}));
    const fig = limits.length ? C.ordinal({title: `${met.label}: ${name}`, sub: "One line per latency target, over the run dates", mode: "lines",
      show: met.show, legend: series, categories: runs.map((r) => ({label: R.dateText(r.created, false), sub: R.engine(r).replace(/^vLLM /, "")})), series})
      : el("p", {class: "muted", text: "This configuration has not met a target yet."});
    const tried = R.limits.filter((l) => runs.some((r) => r.points.some((p) => p.tpot_limit === l)));  // met or missed
    const rows = runs.map((r, j) => {
      const row = {date: R.dateText(r.created), engine: R.engine(r), econ: r.econ.version, node: r.hardware.node, _r: r, _prev: runs[j - 1]};
      for (const l of tried) row["l" + l] = M.at(r, l) ? value(r, l) : null;
      return row;
    });
    const cell = (l) => (v, row) => {
      if (!has(v)) return el("span", {class: "muted", text: (row._r.points.find((p) => p.tpot_limit === l) || {}).met === false ? "missed" : "not run"});
      const before = row._prev && M.at(row._prev, l) ? value(row._prev, l) : null;
      return [met.show(v), " ", has(before) ? R.delta(M.change(v, before), met.lower) : null];
    };
    const openCell = (_, row) => { const b = el("button", {type: "button", class: "linkish", text: "open"}); b.addEventListener("click", open(row._r)); return b; };
    const table = D.table([{key: "date", label: "Measured"}, {key: "engine", label: "Engine"}, {key: "econ", label: "econ"}, {key: "node", label: "Node"}]
      .concat(tried.map((l) => ({key: "l" + l, label: `TPOT ≤ ${fmt.n(l)} ms`, num: true, cell: cell(l)})), [{key: "open", label: "", cell: openCell}]),
      rows, {caption: `${met.label} at each target, with the change against the run before`});
    D.replace(card.body, fig, R.summary(summary(runs, limits, value, met, name)), table);
  }

  function summary(runs, limits, value, met, name) {
    const span = runs.length > 1 ? `${R.count(runs.length, "run")} from ${R.dateText(runs[0].created)} to ${R.dateText(runs[runs.length - 1].created)}`
      : `one run, of ${R.dateText(runs[0].created)}`;
    const parts = limits.map((l) => {
      const have = runs.filter((r) => M.at(r, l));
      if (have.length < 2) return `within TPOT ≤ ${fmt.n(l)} ms it has one value, ${met.show(value(have[0], l))}`;
      const a = have[0], b = have[have.length - 1];
      return `within TPOT ≤ ${fmt.n(l)} ms it went from ${met.show(value(a, l))} (${R.engine(a)}) to ${met.show(value(b, l))} (${R.engine(b)}), ${R.signed(M.change(value(b, l), value(a, l)))}`;
    });
    return `${name}: ${span}. In ${R.lower(met.label)}, ${parts.join("; ") || "no target met"}.`;
  }
  R.views.push({id: "history", title: "History", icon: "history", root: card.root, render});
})(typeof window !== "undefined" ? window : globalThis);
