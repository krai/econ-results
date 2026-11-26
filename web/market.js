/* Market: what providers charge for the most-used open-weight models against what a GPU-hour of serving them costs,
   from the snapshot the page holds (public price lists, usage and benchmark runs read on one day). This file is the
   section's frame: its choices (kept in the URL like every other), the headline, the models and the table of every
   model on every GPU. The detail of one model and the rest of the section are in market-detail.js and market-more.js;
   the arithmetic is MarketMath's. Where each table was read from is in the repository's README, not here. */
(function (root) {
  "use strict";
  const D = root.Dash, R = root.Reg, K = root.MarketMath;
  if (!R || !K || !R.site.market) return;
  const el = D.el, fmt = D.fmt, has = K.has, market = R.site.market;

  // --- the section's choices
  Object.assign(R.defaults, {mt: 50, mb: "owned", mu: 60, mp: "median", mx: "bench", mc: "measured", mm: "", mg: "h200",
                             mk: "breakeven", ms: "all", mq: ""});
  const S = D.readState(R.defaults);
  const X = R.market = {data: market, blocks: []};
  X.BASES = [{key: "owned", label: "Owned", phrase: "owned", slot: 1}, {key: "rent3y", label: "3-year rent", phrase: "rented on a 3-year commit", slot: 2},
             {key: "ondemand", label: "On demand", phrase: "rented on demand", slot: 3}];
  X.PRICES = {median: "the median endpoint's price", p25: "the lower-quartile endpoint's price", min: "the cheapest endpoint's price",
              max: "the dearest endpoint's price", common: "the most common price"};
  X.METRICS = {
    breakeven: {label: "Break-even load", show: (p) => X.load(p.breakeven), value: (p) => p.breakeven, lower: true},
    ratio: {label: "Revenue ÷ cost at your load", show: (p) => (has(p.ratio) ? fmt.n(p.ratio, p.ratio < 10 ? 2 : 1) + "×" : "-"), value: (p) => p.ratio},
    profit: {label: "Profit per GPU-hour at your load", show: (p) => X.usd(p.profit), value: (p) => p.profit},
    perM: {label: "GPU cost per million output tokens", show: (p) => X.usd(p.perM), value: (p) => p.perM, lower: true},
    out: {label: "Output tokens/s per GPU", show: (p) => fmt.n(p.f.out), value: (p) => p.f.out},
    rev: {label: "Revenue per GPU-hour at full load", show: (p) => X.usd(p.rev), value: (p) => p.rev}};
  X.params = (basis) => ({target: S.mt, basis: basis || S.mb, util: S.mu / 100, price: S.mp, mix: S.mx, cache: S.mc});
  const fronts = new Map();
  X.frontier = () => { if (!fronts.has(S.mt)) fronts.set(S.mt, K.frontier(market, S.mt)); return fronts.get(S.mt); };
  X.pairs = (basis) => K.pairs(market, X.frontier(), X.params(basis));
  X.pair = function (model, chip, basis) {
    const f = X.frontier().find((x) => x.model === model && x.chip === chip);
    return f ? K.pair(market, f, X.params(basis)) : null;
  };
  X.model = (key) => market.models.find((m) => m.model === key);
  X.gpu = (chip) => market.gpus.find((g) => g.chip === chip);
  X.gpuName = (chip) => (X.gpu(chip) ? X.gpu(chip).gpu.replace(" NVL72", "") : chip.toUpperCase());
  X.basis = () => X.BASES.find((b) => b.key === S.mb);
  X.load = (u) => (!has(u) ? "-" : u > 1 ? "never" : (u < 0.1 ? fmt.n(100 * u, 1) : fmt.n(100 * u)) + " %");
  X.big = (v) => (!has(v) ? "-" : v >= 1e12 ? fmt.n(v / 1e12, 1) + "T" : v >= 1e9 ? fmt.n(v / 1e9, 1) + "B" : v >= 1e6 ? fmt.n(v / 1e6, 1) + "M" : fmt.n(v));
  X.usd = (v) => (!has(v) ? "-" : Math.abs(v) >= 100 ? (v < 0 ? "-$" : "$") + fmt.n(Math.abs(v)) : fmt.usd(v));
  X.costed = () => market.models.filter((m) => m.ix_key);
  X.source = (m) => (m.cost_source === "measured" ? D.tag("measured", "solid", "Benchmark runs of this very model")
    : m.cost_source === "proxy" ? D.tag("estimated", "dotted", "From the runs of " + m.proxy_of + ", a model of the same architecture")
      : D.tag("prices only", "", "No public benchmark of this model on these GPUs"));
  // A run of the registry on this market: the market's model of that name and its GPU, or null when it has no such model
  const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-|-$/g, "");
  X.ofRun = function (r) {
    const model = X.model(slug(r.model.name));
    return model ? {model, gpu: market.gpus.find((g) => slug(r.hardware.gpu).endsWith(g.chip)) || null} : null;
  };
  X.choose = function (model, chip, land) {
    S.mm = model;
    if (chip) S.mg = chip;
    if (land) R.goto(land); else R.update();
  };
  X.settle = function () {
    const one = (key, values) => { if (!values.includes(S[key])) S[key] = R.defaults[key]; };
    one("mt", [20, 50, 100]); one("mb", Object.keys(K.BASES)); one("mp", Object.keys(X.PRICES)); one("mx", ["bench", "openrouter", "output"]);
    one("mc", ["measured", "trace"]); one("mk", Object.keys(X.METRICS)); one("ms", ["all", "costed"]);
    S.mu = Math.min(100, Math.max(5, Math.round(Number(S.mu) || 60)));
    if (!X.model(S.mm)) S.mm = (X.costed()[0] || market.models[0]).model;
    const chips = X.frontier().filter((f) => f.model === S.mm).map((f) => f.chip);
    if (chips.length && !chips.includes(S.mg)) S.mg = chips.includes("h200") ? "h200" : chips[0];
  };

  // --- the headline: the choices and what all the pairs say with them
  const top = R.section("market", "Do open-model prices cover the GPU?",
    `For the ${market.models.length} open-weight models with the most OpenRouter tokens in 30 days: what providers charge for them, against ` +
    "what a GPU-hour of serving them costs on each GPU. Throughput is from published benchmark runs, so every revenue here is a ceiling. " +
    "Change a choice and every number of the section follows.");
  const tiles = el("div", {class: "tiles"}), asof = el("p", {class: "meta"});
  top.body.append(tiles, asof);
  const back = R.button("Put the six choices back as the page opens with", null, () => { for (const k of ["mt", "mb", "mu", "mp", "mx", "mc"]) S[k] = R.defaults[k]; R.update(); }, "text");
  back.lastChild.textContent = "Reset";
  back.dataset.k = "mreset";
  function drawChoices() {
    const [range, out] = D.slider("Average load", S.mu, {min: 5, max: 100, step: 5}, (v) => { S.mu = v; R.update("typing"); }, (v) => v + " %");
    range.dataset.k = "mu";
    D.replace(top.controls,
      D.control("Speed each user gets (P90)", R.segment("Speed each user gets", "mt", [20, 50, 100].map((t) => ({value: t, label: `≥ ${t} tok/s`})))),
      D.control("GPU paid as", R.segment("GPU paid as", "mb", X.BASES.map((b) => ({value: b.key, label: b.label})))),
      D.control("Average load", range, out),
      R.pick("Price", "mp", [{value: "median", label: "Median endpoint"}, {value: "p25", label: "Lower-quartile endpoint"}, {value: "min", label: "Cheapest endpoint"},
                             {value: "max", label: "Dearest endpoint"}, {value: "common", label: "Most common price"}]),
      R.pick("Tokens sold", "mx", [{value: "bench", label: "The benchmark's own mix"}, {value: "openrouter", label: "OpenRouter's input per output"},
                                   {value: "output", label: "Output only"}]),
      D.control("Cache hits billed", R.segment("Cache hits billed", "mc", [{value: "measured", label: "Measured"}, {value: "trace", label: "Trace maximum"}])),
      D.control("Choices", back));
  }
  function drawHeadline() {
    const pairs = X.pairs(), h = K.headline(market, pairs, X.params()), pc = (v) => (has(v) ? fmt.n(100 * v) + " %" : "-");
    const tile = (label, value, note) => el("div", {class: "tile"}, el("div", {class: "tlabel", text: label}), el("div", {class: "tvalue", text: value}), el("div", {class: "tnote", text: note}));
    D.replace(tiles,
      tile("Pairs that pay the GPU", `${h.covered} of ${h.pairs}`, `model and GPU pairs whose revenue at ${S.mu} % load covers the GPU-hour, ${X.basis().phrase}`),
      tile("Cheapest GPU for most models", h.topChip ? X.gpuName(h.topChip) : "-", h.topChip ? `the lowest break-even load for ${h.topChipModels} of ${h.models} models` : "no pair has a price and a cost"),
      tile("Prices that pay a Blackwell GPU", pc(h.blackwell), "of the endpoint prices, on B200, B300, GB200 and GB300"),
      tile("Prices that pay a Hopper GPU", pc(h.hopper), "on H100 and H200"),
      tile("Prices that pay an AMD GPU", pc(h.amd), "on MI300X, MI325X and MI355X"));
    asof.textContent = `Snapshot of ${R.dateText(market.as_of)}: usage of ${market.usage_window}; ${R.count(Object.values(market.prices).reduce((a, l) => a + l.length, 0), "priced endpoint")}; ` +
      `${R.count(market.curves.reduce((a, c) => a + c.runs.length, 0), "benchmark run")} on ${R.count(market.gpus.length, "GPU")}. Each user gets at least ${S.mt} tokens per second (P90), at ${X.PRICES[S.mp]}.`;
  }

  // --- the models
  const list = R.section("market-models", "The models", "By tokens on OpenRouter over the 30 days. Pick one to see it on every GPU below; a header sorts the table.");
  function drawModelChoices() {
    const box = el("input", {type: "search", class: "search", placeholder: "Find a model or a lab", "aria-label": "Find a model or a lab", value: S.mq, "data-k": "mq"});
    box.addEventListener("input", () => { S.mq = box.value; R.update("typing"); });
    D.replace(list.controls, D.control("Find", box),
      D.control("Show", R.segment("Models shown", "ms", [{value: "all", label: `All ${market.models.length}`}, {value: "costed", label: `With a serving cost (${X.costed().length})`}])));
  }
  function drawModels() {
    const h = K.headline(market, X.pairs(), X.params()), q = S.mq.trim().toLowerCase();
    const rows = market.models.filter((m) => (S.ms === "all" || m.ix_key) && (!q || (m.name + " " + m.author).toLowerCase().includes(q))).map((m) => {
      const st = K.priceStats(market, m.model), best = h.cheapest.get(m.model);
      return {_m: m, rank: m.rank, name: m.name, author: m.author, tokens: m.tokens_30d, share: m.share_pct, mix: m.in_per_out,
              size: m.params_total + (m.params_active ? ` · ${m.params_active} active` : ""), license: m.license, endpoints: st.endpoints,
              output: st.output ? st.output.median : null, range: st.output, source: m.cost_source, best: best ? best.breakeven : null, bestPair: best};
    });
    const pick = (_, row) => {
      const b = el("button", {type: "button", class: "linkish" + (row._m.model === S.mm ? " chosen" : ""), text: row.name, "data-k": "model:" + row._m.model,
                              "aria-pressed": String(row._m.model === S.mm), title: "Show " + row.name + " on every GPU"});
      b.addEventListener("click", () => X.choose(row._m.model, null, "market-detail"));
      return b;
    };
    D.replace(list.body, rows.length ? D.table([
      {key: "rank", label: "#", num: true}, {key: "name", label: "Model", cell: pick}, {key: "author", label: "Lab"},
      {key: "tokens", label: "Tokens, 30 days", num: true, cell: (v) => X.big(v)}, {key: "share", label: "Share of all tokens", num: true, cell: (v) => fmt.n(v, 1) + " %"},
      {key: "mix", label: "Input per output", num: true, cell: (v) => fmt.n(v) + " : 1", title: "Input tokens per output token in its OpenRouter traffic"},
      {key: "size", label: "Parameters"}, {key: "license", label: "Licence"},
      {key: "endpoints", label: "Endpoints", num: true, cell: (v, row) => `${v} of ${R.count(row._m.providers, "provider")}`},
      {key: "output", label: "Output price, median (range)", num: true, cell: (v, row) => (row.range ? `${X.usd(v)} (${X.usd(row.range.min)} to ${X.usd(row.range.max)})` : "-"), title: "USD per million output tokens"},
      {key: "source", label: "Serving cost", cell: (_, row) => X.source(row._m)},
      {key: "best", label: "Pays the GPU from", num: true, title: "The lowest break-even load among the GPUs, at the choices above",
       cell: (v, row) => (row.bestPair ? `${X.load(v)} on ${X.gpuName(row.bestPair.chip)}` : "-")}],
      rows, {caption: `${R.count(rows.length, "model")}; the one chosen is ${X.model(S.mm).name}`}) : el("p", {class: "muted", text: "No model matches."}));
  }

  // --- every model on every GPU
  const matrix = R.section("market-matrix", "Every model on every GPU", null);
  function drawMatrix() {
    const met = X.METRICS[S.mk], u = S.mu / 100, pairs = X.pairs(), by = new Map(pairs.map((p) => [p.model + "|" + p.chip, p]));
    D.replace(matrix.controls, R.pick("Each cell shows", "mk", Object.entries(X.METRICS).map(([value, m]) => ({value, label: m.label}))));
    const head = el("tr", {}, el("th", {scope: "col", text: "Model"}), market.gpus.map((g) => el("th", {scope: "col", class: "num" + (g.chip === S.mg ? " selcol" : "")},
      el("div", {text: X.gpuName(g.chip)}), el("div", {class: "muted", text: has(K.cost(g, S.mb)) ? X.usd(K.cost(g, S.mb)) + "/h" : "no price"}))));
    const body = X.costed().map((m) => el("tr", {class: m.model === S.mm ? "sel" : null},
      el("th", {scope: "row"}, m.name, m.cost_source === "proxy" ? [" ", D.tag("est.", "dotted", "Estimated from the runs of " + m.proxy_of)] : null),
      market.gpus.map((g) => {
        const p = by.get(m.model + "|" + g.chip), cls = "num" + (g.chip === S.mg ? " selcol" : "");
        if (!p) return el("td", {class: cls + " muted", text: "no run"});
        if (!has(p.breakeven)) return el("td", {class: cls + " muted", text: S.mk === "out" ? fmt.n(p.f.out) : "no price"});
        const ok = p.breakeven <= u, name = `${m.name} on ${X.gpuName(g.chip)}`;
        const b = el("button", {type: "button", class: "cellbtn", "data-k": `cell:${m.model}:${g.chip}`,
                                title: `${name}: revenue ${X.usd(p.rev)} per GPU-hour at full load, cost ${X.usd(p.cost)}`,
                                "aria-label": `${name}: ${met.label.toLowerCase()} ${met.show(p)}; ${ok ? "pays" : "does not pay"} the GPU at ${S.mu} % load`},
          el("span", {class: "st " + (ok ? "ok" : "no"), "aria-hidden": "true", text: ok ? "✓" : "✕"}), el("span", {text: met.show(p)}),
          S.mk === "breakeven" ? el("span", {class: "meter", "aria-hidden": "true"}, el("i", {style: `width:${Math.min(100, 100 * p.breakeven)}%`}), el("b", {style: `left:${S.mu}%`})) : null);
        b.addEventListener("click", () => X.choose(m.model, g.chip, "market-detail"));
        return el("td", {class: cls}, b);
      })));
    const h = K.headline(market, pairs, X.params());
    D.replace(matrix.body,
      el("p", {class: "lead", text: `✓: the GPU-hour, ${X.basis().phrase}, is covered at ${S.mu} % load by what its tokens earn at ${X.PRICES[S.mp]}. ` +
        "✕: it is not; “never”: not even at full load. A cell opens that model on that GPU below."}),
      el("div", {class: "tablewrap"}, el("table", {class: "matrix"}, el("thead", {}, head), el("tbody", {}, body))),
      R.summary(`${h.covered} of ${h.pairs} model and GPU pairs pay the GPU-hour (${X.basis().phrase}) at ${S.mu} % load and ${X.PRICES[S.mp]}, with each user at ${S.mt} tokens per second or more. ` +
        (h.topChip ? `${X.gpuName(h.topChip)} has the lowest break-even load for ${h.topChipModels} of ${h.models} models.` : "")));
  }

  X.blocks.push({draw(reason) { if (reason !== "typing") { drawChoices(); drawModelChoices(); } drawHeadline(); drawModels(); drawMatrix(); }});
  const view = el("div", {}, top.root, list.root, matrix.root);
  X.root = view;
  R.views.push({id: "market", title: "Market", icon: "market", scope: false, root: view,
                also: ["market-models", "market-matrix", "market-detail", "market-hardware", "market-reference", "market-ours", "market-method"],
                render(reason) { X.settle(); D.writeState(); for (const b of X.blocks) b.draw(reason); }});
})(typeof window !== "undefined" ? window : globalThis);
