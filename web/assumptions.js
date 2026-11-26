/* The assumptions every priced number on the page follows, as a table to edit: the rent of each GPU in two scenarios,
   the prices, the average utilisation, the cached share of the input and the electricity. Under it, what those choices
   give for each configuration, and where the numbers come from with what was counted. The measured numbers never
   change with any of it. */
(function (root) {
  "use strict";
  const D = root.Dash, R = root.Reg, M = root.RegMath;
  if (!R) return;
  const el = D.el, fmt = D.fmt, has = M.has, S = R.S;
  const card = R.section("assumptions", "Assumptions", "Change any of them and every priced number on the page follows: " +
    "the curves, the rankings, the history and the tables. Revenue is at full load and at list prices; the utilisation " +
    "scales the margin and the rent that each token carries.");
  const sources = R.section("sources", "Sources and what was counted", null);
  const inputs = el("div", {class: "assume"}), results = el("div", {});
  card.body.append(inputs, results);

  function set(key, value) { S[key] = value; R.update("typing"); }

  function drawInputs() {
    const gpus = Array.from(new Set(R.scope().map((r) => r.hardware.gpu)));
    const rentRows = gpus.map((g) => {
      const n = (R.scope().find((r) => r.hardware.gpu === g) || {hardware: {}}).hardware.gpus_on_node;
      return el("tr", {}, el("th", {scope: "row", text: g}),
        ["a", "b"].map((w) => el("td", {class: "num"}, "$ ", D.number(`Rent of one ${g} per hour, scenario ${w.toUpperCase()}`,
          S[R.rentKey(g, w)], {min: 0, step: 0.01}, (v) => set(R.rentKey(g, w), v)))),
        el("td", {class: "muted", text: n ? `a node of ${n}: ${fmt.usd(S[R.rentKey(g, S.rent)] * n * 24 * 30)} in 30 days` : ""}));
    });
    const price = [D.select("Prices", [{value: "run", label: "Each run at the price list of its day"},
      {value: "latest", label: "Every run at the latest price list"}, {value: "custom", label: "Your own prices"}], S.price, (v) => {
      if (v === "custom" && S.price !== "custom") { const now = R.scope().map(R.price).find(Boolean) || {}; S.pin = now.input || 0; S.pout = now.output || 0; }
      S.price = v;
      R.update();
    })];
    if (S.price === "custom") {
      price.push(D.number("Input price, USD per million tokens", S.pin, {min: 0, step: 0.01}, (v) => set("pin", v)),
                 D.number("Output price, USD per million tokens", S.pout, {min: 0, step: 0.01}, (v) => set("pout", v)));
    }
    const cachedPrice = (R.scope().map(R.price).find(Boolean) || {}).cached;
    D.replace(inputs,
      el("div", {class: "tablewrap"}, el("table", {class: "rents"}, el("caption", {text: "Rent per GPU-hour, USD: two scenarios to switch between (two public on-demand list prices on the day of the first run: a managed tier and a community tier)"}),
        el("thead", {}, el("tr", {}, el("th", {scope: "col", text: "GPU"}), el("th", {scope: "col", class: "num", text: "Scenario A"}),
          el("th", {scope: "col", class: "num", text: "Scenario B"}), el("th", {scope: "col", text: "The scenario in use"}))),
        el("tbody", {}, rentRows))),
      el("div", {class: "choices"},
        D.control("Rent scenario in use", R.segment("Rent scenario", "rent", [{value: "a", label: "A"}, {value: "b", label: "B"}])),
        D.control("Prices, USD per M tokens", price),
        D.control("Average utilisation", D.slider("Average utilisation", S.u, {min: 5, max: 100, step: 5}, (v) => set("u", v), (v) => v + " %")),
        D.control("Cached share of the input", D.slider("Cached share of the input", S.cached, {min: 0, max: 95, step: 5, disabled: !has(cachedPrice)},
          (v) => set("cached", v), (v) => (has(cachedPrice) ? `${v} % at ${fmt.usd(cachedPrice)}` : "no cached price listed"))),
        D.control("Electricity, USD per kWh · PUE",
          D.number("Electricity price, USD per kWh", S.kwh, {min: 0, step: 0.01}, (v) => set("kwh", v)),
          D.number("Power usage effectiveness", S.pue, {min: 1, step: 0.05}, (v) => set("pue", v)))));
  }

  function drawResults() {
    const rows = M.asOf(R.scope(), R.asOfDay()).map((r) => {
      const p = M.at(r, "loosest"), x = p ? R.sums(r, p) : null, price = R.price(r);
      return {_slot: R.slot(r), name: `${R.config(r)} · ${R.engine(r)}`, hw: R.hw(r), target: p ? R.target(p) : "no met target",
              pair: price ? `${fmt.usd(price.input)} / ${fmt.usd(price.output)}` : "-", rev: x ? x.rev : null, rent: R.rent(r),
              be: x ? x.be : null, margin: x ? x.margin : null, perM: x ? x.perM : null, elec: x ? x.elec : null,
              tokj: p ? p.tok_per_j : null};
    });
    D.replace(results, D.table([
      {key: "name", label: "Configuration, at its loosest met target"}, {key: "hw", label: "Hardware"}, {key: "target", label: "Target"},
      {key: "pair", label: "Prices, in / out", num: true}, {key: "rev", label: "Revenue per GPU-hour", num: true, cell: fmt.usd},
      {key: "rent", label: "Rent", num: true, cell: fmt.usd},
      {key: "be", label: "Break-even utilisation", num: true, cell: fmt.pct, title: "The average utilisation at which the tokens pay the rent"},
      {key: "margin", label: `Margin at ${S.u} %`, num: true, cell: (v) => (has(v) ? (v < 0 ? "−" : "+") + fmt.usd(Math.abs(v)) : "-")},
      {key: "perM", label: `Rent per M output tokens at ${S.u} %`, num: true, cell: R.usd3},
      {key: "elec", label: "Electricity per GPU-hour", num: true, cell: R.usd3, title: "At the measured board power, an upper bound"},
      {key: "tokj", label: "Output tok/J", num: true, cell: (v) => fmt.n(v, 2)}], rows,
      {caption: "What these choices give, for the latest run of each configuration in scope"}));
  }

  function drawSources() {
    const scope = R.scope(), met = scope.flatMap((r) => R.met(r).map((p) => ({r, p})));
    const requests = met.reduce((n, {r, p}) => n + ((p.pooled || {}).requests || p.requests_served ||
      ((r.results.find((q) => q.slo.tpot_p99_ms === p.tpot_limit) || {}).windows || []).reduce((s, w) => s + (w.measured || 0), 0)), 0);
    const windows = met.reduce((n, {p}) => n + (p.repeats || 0), 0), missed = scope.reduce((n, r) => n + r.points.filter((p) => p.met === false).length, 0);
    const lengths = Array.from(new Set(scope.map((r) => r.workload.lengths).filter(Boolean)));
    const span = (key) => { const v = met.map(({p}) => p[key]).filter(has); return v.length ? `${fmt.n(Math.min(...v))} to ${fmt.n(Math.max(...v))}` : "-"; };
    const lists = Array.from(new Set(R.snapshots.map((s) => s.model))).map((m) => {
      const snaps = R.snapshots.filter((s) => s.model === m);
      return `${m}: ${snaps.map((s) => `${R.dateText(s.taken)} (${R.count(s.by_endpoint.length, "endpoint")})`).join(", ")}`;
    });
    const latest = R.records[R.records.length - 1];
    const dl = (pairs) => el("dl", {class: "kv"}, pairs.filter(Boolean).map(([k, v]) => [el("dt", {text: k}), el("dd", {}, v)]));
    D.replace(sources.body, dl([
      ["Prices", "OpenRouter's public list of each model's endpoints (openrouter.ai/api/v1/models/MODEL/endpoints), list prices in USD per million tokens, as taken on each day. " + lists.join("; ") + "."],
      ["Updated", latest ? `The latest run is of ${R.dateText(latest.created)}; the latest price list is of ${R.dateText(R.snapshots.slice(-1)[0].taken)}. ` +
        `${R.count(R.records.length, "run")} in this ${R.site.audience} registry.` : "No runs yet."],
      ["Counted, for the runs in scope", `${R.count(scope.length, "run")}; ${R.count(met.length, "met target")} and ${missed} missed; ` +
        `${fmt.n(requests)} requests in ${R.count(windows, "confirmation window")}.`],
      ["Lengths of the requests", (lengths.join("; ") || "-") + `. In the confirmation windows the mean request had ${span("mean_input_tokens")} input and ${span("mean_output_tokens")} output tokens.`],
      ["Power", "What the GPU boards draw, as the driver reports it; a run's page says what else was counted."],
      ["Method", "Open-loop arrivals at a fixed rate; the rate grows until a probe misses the target, then narrows, and the rate is confirmed over repeated windows. A target is met when the 99th percentiles of the time to first token and of the time per output token are within it."]]));
  }

  function render(reason) {
    if (reason !== "typing") drawInputs();
    drawResults();
    drawSources();
  }
  R.views.push({id: "assumptions", nav: false, root: el("div", {}, card.root, sources.root), render});
})(typeof window !== "undefined" ? window : globalThis);
