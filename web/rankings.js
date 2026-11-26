/* Rankings: where each configuration stands. A leaderboard of each configuration's latest run with its change against
   the run before it, a treemap of the configurations that met each latency target, and bars by run date. One row of
   choices above the three: the value, the target and the period. */
(function (root) {
  "use strict";
  const D = root.Dash, R = root.Reg, M = root.RegMath;
  if (!R) return;
  const el = D.el, fmt = D.fmt, has = M.has, S = R.S, C = R.charts;
  const SHOWN = 8;
  const card = R.section("rankings", "Rankings",
    "Each configuration by its latest run in the period, at the value and the latency target chosen here. The change " +
    "is against the run of the same configuration before it, at the same target.");
  const board = el("div", {}), tree = el("div", {}), time = el("div", {});
  card.body.append(el("h3", {text: "Leaderboard"}), board, el("h3", {class: "sub", text: "By latency target"}), tree,
    el("h3", {class: "sub", text: "Over time"}), time);

  const epoch = (r) => Date.parse(R.day(r) + "T00:00:00Z");
  function pool() {  // the runs in scope within the period, counted back from the latest run
    const scope = R.scope();
    if (S.per === "all" || !scope.length) return scope;
    const last = epoch(scope[scope.length - 1]);
    return scope.filter((r) => last - epoch(r) <= Number(S.per) * 864e5);
  }
  function entry(r, limit, key = S.lbm) {  // a run at a target: its value, and its change against the run before it
    const p = M.at(r, limit);
    if (!p) return null;
    const v = R.value(key, r, p), prev = M.previous(R.scope(), r), pp = prev ? M.at(prev, p.tpot_limit) : null;
    return has(v) ? {r, p, v, prev: pp ? prev : null, change: M.change(v, pp ? R.value(key, prev, pp) : null)} : null;
  }
  const open = (r) => () => { S.run = r.id; R.goto("runs", "run"); };
  const targetName = () => (S.lbt === "loosest" ? "its loosest met target" : `TPOT ≤ ${S.lbt} ms`);
  const rowsOf = (e, met) => [[met.show(e.v), met.short], [R.target(e.p), "the target met (p99)"], [fmt.n(e.p.rate_rps, 2), "requests/s on " + R.hw(e.r)],
    [R.engine(e.r), "engine"], [R.dateText(e.r.created), "measured"],
    has(e.change) ? [R.signed(e.change), `against ${R.engine(e.prev)}, ${R.dateText(e.prev.created, false)}`] : null];

  function drawBoard(latest, met) {
    const ranked = latest.map((r) => entry(r, S.lbt)).filter(Boolean).sort((a, b) => (met.lower ? a.v - b.v : b.v - a.v));
    const out = latest.filter((r) => !ranked.some((e) => e.r === r));
    const items = ranked.slice(0, S.more ? ranked.length : SHOWN).map((e, i) => {
      const b = el("button", {type: "button", class: "entry", title: "Open this run"},
        el("span", {class: "rank num", text: String(i + 1)}), D.swatch(R.slot(e.r)),
        el("span", {class: "who"}, el("span", {class: "bname", text: R.keyName(e.r)}),
          el("span", {class: "bsub", text: `${R.engine(e.r)} · ${R.dateText(e.r.created)} · ${R.target(e.p)}`})),
        el("span", {class: "score"}, el("span", {class: "bval", text: met.show(e.v)}), el("span", {class: "bunit", text: met.short}),
          R.delta(e.change, met.lower)));
      b.addEventListener("click", open(e.r));
      return el("li", {}, b);
    });
    const more = ranked.length > SHOWN ? R.button(S.more ? "Show fewer" : `Show ${ranked.length - SHOWN} more`, null, () => { S.more = S.more ? 0 : 1; R.update(); }, "text") : null;
    const lead = ranked[0], moved = ranked.filter((e) => has(e.change)).sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
    const text = !ranked.length ? `No configuration in the period met ${targetName()}.`
      : `${R.count(ranked.length, "configuration")} ranked by ${R.lower(met.label)} at ${targetName()}. ${R.keyName(lead.r)} leads with ${met.show(lead.v)} ` +
        `(${R.engine(lead.r)}, ${R.dateText(lead.r.created)}).` + (moved ? ` The largest change against the run before is ${R.signed(moved.change)}, for ${R.keyName(moved.r)}.` : "") +
        (out.length ? ` Not ranked, because they did not meet it: ${out.map(R.keyName).join("; ")}.` : "");
    D.replace(board, items.length ? el("ol", {class: "board"}, items) : el("p", {class: "muted", text: "Nothing to rank here."}), more, R.summary(text));
  }

  function drawTree(latest, met) {
    const limits = R.limits.filter((l) => latest.some((r) => M.at(r, l)));
    const groups = limits.map((l, i) => ({name: `TPOT ≤ ${fmt.n(l)} ms`, step: Math.min(4, i + 1), limit: l,
      items: latest.map((r) => entry(r, l)).filter(Boolean).map((e) => ({name: R.keyName(e.r), sub: R.engine(e.r), value: e.v,
        rows: rowsOf(e, met), pick: open(e.r), e}))}));
    if (!groups.length) { D.replace(tree, el("p", {class: "muted", text: "No met target to draw."})); return; }
    const best = (g) => g.items.reduce((a, b) => ((met.lower ? b.value < a.value : b.value > a.value) ? b : a));
    const legend = el("ul", {class: "legend"}, groups.map((g) => el("li", {}, C.key(null, "block", "o" + g.step),
      el("span", {text: `${g.name}: ${R.count(g.items.length, "configuration")}, ${met.lower ? "lowest" : "highest"} ${met.show(best(g).value)}`}))));
    const rows = groups.flatMap((g) => g.items.map((it) => ({target: g.limit, name: it.name, engine: it.sub, value: it.value, change: it.e.change})));
    const fig = C.treemap({title: `${met.label}, by latency target`,
      sub: "A tile is a configuration that met the target; its area is the value" + (met.lower ? " (a larger tile costs more)" : ""), show: met.show, groups});
    fig.insertBefore(legend, fig.host);
    fig.append(D.tableToggle("the values as a table", () => D.table([
      {key: "target", label: "Target, TPOT p99", num: true, cell: (v) => `≤ ${fmt.n(v)} ms`}, {key: "name", label: "Configuration"},
      {key: "engine", label: "Engine"}, {key: "value", label: met.label, num: true, cell: met.show},
      {key: "change", label: "Against the run before", num: true, cell: (v) => R.delta(v, met.lower)}], rows, {sort: "target", dir: -1})));
    const tight = groups[groups.length - 1];
    D.replace(tree, fig, R.summary(`${R.count(groups.length, "latency target")} met by at least one configuration. ` +
      groups.map((g) => `Within ${g.name}, ${best(g).name} has the ${met.lower ? "lowest" : "highest"} value, ${met.show(best(g).value)}`).join(". ") +
      `. The tightest target, ${tight.name}, was met by ${R.count(tight.items.length, "configuration")}.`));
  }

  function drawTime(runs, met) {
    const days = Array.from(new Set(runs.map(R.day))), keys = Array.from(new Set(runs.map(M.key)));
    const series = keys.map((k) => {
      const mine = runs.filter((r) => M.key(r) === k), at = days.map((d) => { const r = mine.filter((x) => R.day(x) === d).slice(-1)[0]; return r ? entry(r, S.lbt) : null; });
      return {name: R.keyName(mine[0]), slot: R.slot(mine[0]), values: at.map((e) => (e ? e.v : null)),
              rows: at.map((e) => (e ? rowsOf(e, met) : null)), picks: at.map((e) => (e ? open(e.r) : null))};
    }).filter((s) => s.values.some(has));
    if (!series.length) { D.replace(time, el("p", {class: "muted", text: "No run in the period met this target."})); return; }
    const fig = C.ordinal({title: `${met.label} by run date`, sub: `Each bar is a run, at ${targetName()}`, mode: "bars", keys: "block", log: S.blog > 0,
      show: met.show, legend: series, categories: days.map((d) => ({label: R.dateText(d, false), sub: d.slice(0, 4)})), series});
    fig.append(D.tableToggle("the values as a table", () => D.table(
      [{key: "name", label: "Configuration"}].concat(days.map((d, i) => ({key: "d" + i, label: R.dateText(d), num: true, cell: (v) => (has(v) ? met.show(v) : "-")}))),
      series.map((s) => Object.assign({name: s.name, _slot: s.slot}, Object.fromEntries(s.values.map((v, i) => ["d" + i, v])))))));
    const first = runs[0], lastRun = runs[runs.length - 1];
    D.replace(time, fig, R.summary(`${R.count(runs.length, "run")} of ${R.count(keys.length, "configuration")} on ${R.count(days.length, "day")}, ` +
      `from ${R.dateText(first.created)} to ${R.dateText(lastRun.created)}; ${R.count(series.reduce((n, s) => n + s.values.filter(has).length, 0), "bar")} at ${targetName()}.`));
  }

  function render() {
    const met = R.METRICS[S.lbm], runs = pool(), latest = M.asOf(runs, null);
    D.replace(card.controls,
      R.pick("Value", "lbm", Object.entries(R.METRICS).map(([value, m]) => ({value, label: m.label}))),
      R.pick("Latency target", "lbt", [{value: "loosest", label: "Each one's loosest met target"}].concat(R.limits.map((l) => ({value: String(l), label: `TPOT ≤ ${fmt.n(l)} ms`})))),
      R.pick("Period", "per", [{value: "all", label: "Every run"}, {value: "30", label: "The last 30 days"}, {value: "7", label: "The last 7 days"}]),
      D.control("Bars over time", R.toggle("Log scale", "blog")));
    drawBoard(latest, met);
    drawTree(latest, met);
    drawTime(runs, met);
  }
  R.views.push({id: "rankings", title: "Rankings", icon: "rankings", root: card.root, render});
})(typeof window !== "undefined" ? window : globalThis);
