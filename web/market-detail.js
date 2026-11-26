/* Market, one model on every GPU: the load from which each GPU is paid on the three ways of paying for it, every
   endpoint's revenue on one GPU against that GPU's costs, how the throughput falls as each user is served faster, and
   the same in a table. A model with no public benchmark shows its prices alone. */
(function (root) {
  "use strict";
  const D = root.Dash, R = root.Reg, K = root.MarketMath, M = root.RegMath;
  const X = R && R.market;
  if (!X) return;
  const el = D.el, svgEl = D.svgEl, fmt = D.fmt, has = K.has, S = R.S, C = R.charts, market = X.data;
  const card = R.section("market-detail", "One model on every GPU", null);
  const FAMILY = {hopper: {slot: 1, name: "Hopper (H100, H200)"}, blackwell: {slot: 2, name: "Blackwell (B200, B300, GB200, GB300)"},
                  amd: {slot: 3, name: "AMD Instinct (MI300X, MI325X, MI355X)"}};
  const pick = (chip) => () => X.choose(S.mm, chip);

  // The load from which each GPU is paid: a row per GPU, a dot per way of paying for it, the chosen load as a line
  function breakeven(m, chips) {
    const rows = chips.map((chip) => ({chip, pairs: X.BASES.map((b) => X.pair(m.model, chip, b.key))}));
    return C.frame({title: "Break-even load by GPU", legend: X.BASES.map((b) => ({name: b.label, slot: b.slot, kind: "dot"})),
                    sub: `Left of the line, the GPU is paid at the ${S.mu} % load chosen. At ${X.PRICES[S.mp]}.`}, (W) => {
      const rowH = 30, g = {l: 74, r: 84, t: 26, b: 28}, H = g.t + rowH * rows.length + g.b, pw = W - g.l - g.r;
      const x = (u) => g.l + Math.min(u, 1) * pw, zone = g.l + pw + 26, never = zone + 27;  // past 100 %: its own column
      const svg = C.svg(W, H, `Break-even load by GPU for ${m.name}`), marks = [];
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        svg.append(svgEl("line", {x1: x(t), x2: x(t), y1: g.t - 6, y2: H - g.b, class: "gl"}),
                   svgEl("text", {x: x(t), y: H - g.b + 16, class: "tick num", "text-anchor": "middle"}, 100 * t + " %"));
      }
      svg.append(svgEl("rect", {x: zone, y: g.t - 6, width: 54, height: rowH * rows.length + 6, rx: 4, class: "zone"}),
                 svgEl("text", {x: never, y: H - g.b + 16, class: "tick", "text-anchor": "middle"}, "never"));
      rows.forEach((row, i) => {
        const y = g.t + i * rowH + rowH / 2;
        svg.append(svgEl("text", {x: g.l - 10, y: y + 4, class: "rlabel" + (row.chip === S.mg ? " strong" : ""), "text-anchor": "end"}, X.gpuName(row.chip)),
                   svgEl("line", {x1: g.l, x2: g.l + pw, y1: y, y2: y, class: "gl"}));
        row.pairs.forEach((p, j) => {
          if (!p || !has(p.breakeven)) return;
          const b = X.BASES[j], cx = p.breakeven > 1 ? never + (j - 1) * 13 : x(p.breakeven), cy = y + (j - 1) * 5;
          svg.append(svgEl("circle", {cx, cy, r: 5, class: "dot " + C.cls(b.slot)}));
          marks.push({x: cx, y: cy, title: `${X.gpuName(row.chip)} · ${b.label.toLowerCase()}`, slot: b.slot, pick: pick(row.chip),
                      rows: [[X.load(p.breakeven), "break-even load"], [X.usd(p.rev) + "/h", "revenue at full load"], [X.usd(p.cost) + "/h", "the GPU's cost"],
                             [X.usd(p.profit) + "/h", `profit at ${S.mu} % load`]]});
        });
      });
      svg.append(svgEl("line", {x1: x(S.mu / 100), x2: x(S.mu / 100), y1: g.t - 12, y2: H - g.b, class: "ref"}),
                 svgEl("text", {x: x(S.mu / 100) + 4, y: g.t - 12, class: "reflabel halo num"}, S.mu + " % load"));
      C.marks(svg, marks);
      return svg;
    });
  }

  // Every endpoint on the chosen GPU: what its prices earn per GPU-hour at the chosen load, on a log axis, against the
  // GPU-hour's three costs. A filled dot pays the GPU as it is paid in the choices; a ring does not.
  function endpoints(m, p) {
    const u = S.mu / 100, gpu = X.gpu(p.chip), list = market.prices[m.model];
    const costs = X.BASES.map((b) => ({b, v: K.cost(gpu, b.key)})).filter((c) => has(c.v));
    const vals = p.revs.map((r) => r * u), all = vals.concat(costs.map((c) => c.v)).filter((v) => v > 0);
    const lo = Math.pow(10, Math.floor(Math.log10(Math.min(...all)))), hi = Math.pow(10, Math.ceil(Math.log10(Math.max(...all))));
    return C.frame({title: `Each endpoint's revenue on one ${X.gpuName(p.chip)}, at ${S.mu} % load`, keys: "dot",
                    legend: [{name: "pays the GPU", slot: 1, kind: "dot"}, {name: "does not", cls: "hollow s1", kind: "dot"}],
                    sub: `One dot per endpoint, with its own input, output and cached prices. ${p.covering} of ${p.endpoints} cover the GPU-hour, ${X.basis().phrase}. Log scale.`}, (W) => {
      const g = {l: 14, r: 14, t: 50, b: 30}, pw = W - g.l - g.r, placed = [], marks = [];
      const x = (v) => g.l + (Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) * pw;
      vals.map((v, i) => ({v, i})).sort((a, b) => a.v - b.v).forEach((o) => {
        const cx = x(o.v);
        let k = 0, dy = 0;  // a dot that would cover another goes above or below it
        while (placed.some((q) => Math.abs(q.cx - cx) < 9 && Math.abs(q.dy - dy) < 9)) { k++; dy = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 9; }
        placed.push({cx, dy, v: o.v, i: o.i});
      });
      // the plot is as tall as its tallest pile of endpoints at one price
      const half = Math.max(60, ...placed.map((q) => Math.abs(q.dy))) + 12, H = g.t + 2 * half + g.b, base = g.t + half, mine = K.cost(gpu, S.mb);
      const svg = C.svg(W, H, `Revenue per GPU-hour of each endpoint of ${m.name} on ${X.gpuName(p.chip)}`);
      for (let d = lo; d <= hi * 1.0001; d *= 10) {
        svg.append(svgEl("line", {x1: x(d), x2: x(d), y1: g.t - 6, y2: H - g.b, class: "gl"}),
                   svgEl("text", {x: x(d), y: H - g.b + 16, class: "tick num", "text-anchor": "middle"}, "$" + (d < 1 ? String(+d.toPrecision(1)) : fmt.n(d))));
      }
      placed.forEach((o) => {
        const cx = o.cx, cy = base + o.dy;
        const e = list[o.i], pays = has(mine) && o.v >= mine;
        svg.append(svgEl("circle", {cx, cy, r: 4.5, class: (pays ? "dot " : "hollow ") + "s1"}));
        marks.push({x: cx, y: cy, title: `Endpoint, ${e[5] === "unknown" ? "precision not stated" : e[5].toUpperCase()}`, slot: 1,
                    rows: [[X.usd(o.v) + "/h", `revenue at ${S.mu} % load`], [`${X.usd(e[0])} / ${X.usd(e[1])} / ${X.usd(e[2])}`, "input / output / cached, per M tokens"],
                           e[4] > 0 ? [fmt.n(e[4]) + " %", "promotion off its list price"] : null, [pays ? "yes" : "no", `pays the GPU, ${X.basis().label.toLowerCase()}`]]});
      });
      costs.forEach((c, i) => {
        svg.append(svgEl("line", {x1: x(c.v), x2: x(c.v), y1: g.t - 34 + i * 13, y2: H - g.b, class: "ref" + (c.b.key === S.mb ? "" : " faint")}),
                   svgEl("text", {x: x(c.v) + 5, y: g.t - 30 + i * 13, class: "reflabel halo num"}, `${c.b.label.toLowerCase()} ${X.usd(c.v)}`));
      });
      C.marks(svg, marks);
      return svg;
    });
  }

  // How the output per GPU falls as each user is served faster: a line per GPU, coloured by its family, on two log axes
  function curves(m) {
    const data = K.curves(market, m).map((c) => Object.assign(c, {fam: K.family(X.gpu(c.chip))})).filter((c) => c.points.length);
    if (!data.length) return null;
    const used = Array.from(new Set(data.map((c) => c.fam)));
    return C.frame({title: "Output tokens/s per GPU against the speed each user gets",
                    sub: "The best published recipe on each GPU at each speed (P90). Faster for each user means fewer tokens per GPU. Both axes are logarithmic.",
                    legend: used.map((f) => ({name: FAMILY[f].name, slot: FAMILY[f].slot}))}, (W) => {
      const g = {l: 56, r: 62, t: 14, b: 40}, H = Math.round(Math.min(360, Math.max(250, W * 0.5))), pw = W - g.l - g.r, ph = H - g.t - g.b;
      const xs = data.flatMap((c) => c.points.map((q) => q.speed)), ys = data.flatMap((c) => c.points.map((q) => q.out)).filter((v) => v > 0);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys) / 1.4, y1 = Math.max(...ys) * 1.4;
      const x = (v) => g.l + pw * Math.log(v / x0) / Math.log(x1 / x0 || 2), y = (v) => g.t + ph * (1 - Math.log(Math.max(v, y0) / y0) / Math.log(y1 / y0));
      const svg = C.svg(W, H, `Output tokens per second per GPU of ${m.name} against the speed per user`), marks = [], ends = [];
      for (const v of M.logTicks(y0, y1)) {
        svg.append(svgEl("line", {x1: g.l, x2: W - g.r, y1: y(v), y2: y(v), class: "gl"}),
                   svgEl("text", {x: g.l - 8, y: y(v) + 4, class: "tick num", "text-anchor": "end"}, fmt.tick(v, y1)));
      }
      for (const v of [5, 10, 20, 50, 100, 200, 300].filter((t) => t >= x0 && t <= x1)) {
        svg.append(svgEl("text", {x: x(v), y: H - g.b + 16, class: "tick num", "text-anchor": "middle"}, String(v)));
      }
      svg.append(svgEl("line", {x1: g.l, x2: W - g.r, y1: H - g.b, y2: H - g.b, class: "axisl"}),
                 svgEl("text", {x: g.l + pw / 2, y: H - 6, class: "tick", "text-anchor": "middle"}, "Tokens/s each user gets (P90)"));
      if (S.mt >= x0 && S.mt <= x1) {
        svg.append(svgEl("line", {x1: x(S.mt), x2: x(S.mt), y1: g.t, y2: H - g.b, class: "ref faint"}),
                   svgEl("text", {x: x(S.mt) + 4, y: g.t + 10, class: "reflabel halo num"}, `≥ ${S.mt} tok/s`));
      }
      for (const c of data) {
        const cls = C.cls(FAMILY[c.fam].slot), chosen = c.chip === S.mg;
        if (c.points.length > 1) svg.append(svgEl("polyline", {class: `line ${cls}` + (chosen ? " thick" : ""), points: c.points.map((q) => `${x(q.speed).toFixed(1)},${y(q.out).toFixed(1)}`).join(" ")}));
        for (const q of c.points) {
          svg.append(svgEl("circle", {cx: x(q.speed), cy: y(q.out), r: chosen ? 4 : 3, class: "dot " + cls}));
          marks.push({x: x(q.speed), y: y(q.out), title: X.gpuName(c.chip), slot: FAMILY[c.fam].slot, pick: pick(c.chip),
                      rows: [[fmt.n(q.out), "output tokens/s per GPU"], [`≥ ${q.speed}`, "tokens/s each user gets"], [X.big(q.tput), "all tokens/s per GPU"], [q.recipe, "recipe"]]});
        }
        const last = c.points[c.points.length - 1];
        ends.push({x: x(last.speed), y: y(last.out), text: X.gpuName(c.chip), places: [[8, 4, false], [8, -8, false], [8, 16, false], [-8, -8, true]]});
      }
      C.labels(svg, ends, W, H - g.b);
      C.marks(svg, marks);
      return svg;
    });
  }

  function curveTable(m) {  // the lines' values: a row per GPU, a column per speed
    const data = K.curves(market, m).filter((c) => c.points.length), speeds = Array.from(new Set(data.flatMap((c) => c.points.map((q) => q.speed)))).sort((a, b) => a - b);
    return D.table([{key: "gpu", label: "GPU"}].concat(speeds.map((s) => ({key: "s" + s, label: "≥ " + s, num: true, cell: (v) => fmt.n(v)}))),
      data.map((c) => Object.assign({gpu: X.gpuName(c.chip)}, Object.fromEntries(c.points.map((q) => ["s" + q.speed, q.out])))),
      {caption: `Output tokens per second per GPU of ${m.name}, by the tokens per second each user gets (P90)`});
  }

  function gpuTable(m, pairs) {
    const rows = pairs.map((p) => ({_p: p, gpu: X.gpuName(p.chip), out: p.f.out, tput: p.f.tput, mix: p.f.out > 0 ? p.f.inp / p.f.out : null, hit: K.hit(p.f, X.params()),
                                    rev: p.rev, cost: p.cost, breakeven: p.breakeven, profit: p.profit, perM: p.perM, covering: p.covering, recipes: p.f.recipes,
                                    spread: p.f.spread, recipe: p.f.recipe}));
    return D.table([
      {key: "gpu", label: "GPU", cell: (v, row) => { const b = el("button", {type: "button", class: "linkish" + (row._p.chip === S.mg ? " chosen" : ""), text: v}); b.addEventListener("click", pick(row._p.chip)); return b; }},
      {key: "out", label: "Output tok/s", num: true, cell: (v) => fmt.n(v), title: "Output tokens per second per GPU"},
      {key: "tput", label: "All tok/s", num: true, cell: (v) => X.big(v), title: "Input and output tokens per second per GPU"},
      {key: "mix", label: "Input per output", num: true, cell: (v) => (has(v) ? fmt.n(v) + " : 1" : "-")},
      {key: "hit", label: "Cache hits", num: true, cell: (v) => fmt.n(100 * v) + " %", title: "Share of the input served from the prefix cache"},
      {key: "rev", label: "Revenue per GPU-hour", num: true, cell: (v) => X.usd(v), title: "At full load"},
      {key: "split", label: "Its parts", cell: (_, row) => row._p.split.map((s) => fmt.n(100 * s) + " %").join(" · "), title: "Share of the revenue: uncached input · cached input · output"},
      {key: "cost", label: "Cost per GPU-hour", num: true, cell: (v) => X.usd(v)}, {key: "breakeven", label: "Break-even load", num: true, cell: (v) => X.load(v)},
      {key: "profit", label: `Profit at ${S.mu} %`, num: true, cell: (v) => X.usd(v), title: "Revenue × load − cost, per GPU-hour"},
      {key: "perM", label: "Cost per M output", num: true, cell: (v) => X.usd(v), title: "The GPU-hour spread over the output tokens at your load"},
      {key: "covering", label: "Endpoints that pay it", num: true, cell: (v, row) => (has(v) ? `${v} of ${row._p.endpoints}` : "-")},
      {key: "recipes", label: "Recipes at this speed", num: true}, {key: "spread", label: "Best ÷ median recipe", num: true, cell: (v) => (has(v) ? fmt.n(v, 1) + "×" : "-"),
       title: "What serving software and configuration are worth on one GPU"},
      {key: "recipe", label: "Best recipe", cell: (v, row) => `${v} · ${row._p.f.method} ${row._p.f.date || ""}`}],
      rows, {caption: `${m.name}, each user at ${S.mt} tokens per second or more (P90), ${S.mu} % load, ${X.PRICES[S.mp]}, GPUs ${X.basis().phrase}` +
        (m.cost_source === "proxy" ? `. Estimated from the runs of ${m.proxy_of}.` : ".")});
  }
  function endpointTable(m, p) {
    const u = S.mu / 100, rows = market.prices[m.model].map((e, i) => ({input: e[0], output: e[1], cached: e[2], listed: e[3], off: e[4], quant: e[5], rev: p ? p.revs[i] * u : null}));
    return D.table([{key: "quant", label: "Precision", cell: (v) => (v === "unknown" ? "not stated" : v.toUpperCase())},
      {key: "input", label: "Input", num: true, cell: (v) => X.usd(v)}, {key: "output", label: "Output", num: true, cell: (v) => X.usd(v)},
      {key: "cached", label: "Cached input", num: true, cell: (v, row) => (row.listed ? X.usd(v) : X.usd(v) + " (as input)")},
      {key: "off", label: "Promotion", num: true, cell: (v) => (v > 0 ? fmt.n(v) + " %" : "-")}].concat(p ? [
      {key: "rev", label: `Revenue per GPU-hour on ${X.gpuName(p.chip)} at ${S.mu} %`, num: true, cell: (v) => X.usd(v)}] : []), rows,
      {caption: `${R.count(rows.length, "endpoint")} of ${m.name}, USD per million tokens`, sort: p ? "rev" : "output", dir: -1});
  }

  function draw(reason) {
    const m = X.model(S.mm), pairs = X.pairs().filter((p) => p.model === m.model), chips = X.frontier().filter((f) => f.model === m.model).map((f) => f.chip);
    const p = pairs.find((q) => q.chip === S.mg) || null, st = K.priceStats(market, m.model);
    if (reason !== "typing") {
      const group = (label, list) => ({group: label, options: list.map((x) => ({value: x.model, label: x.name}))});
      D.replace(card.controls,
        R.pick("Model", "mm", [group("With a serving cost", X.costed()), group("Prices only", market.models.filter((x) => !x.ix_key))]),
        chips.length ? R.pick("GPU for the endpoints", "mg", chips.map((c) => ({value: c, label: X.gpuName(c)}))) : null);
    }
    card.root.querySelector("h2").firstChild.textContent = m.name + " on every GPU";
    const about = el("p", {class: "lead"}, `${m.author} · ${m.params_total}` + (m.params_active ? `, ${m.params_active} active per token` : "") + ` · licence ${m.license} · ` +
      `${X.big(m.tokens_30d)} tokens in 30 days, ${fmt.n(m.in_per_out)} input per output token · ${R.count(st.endpoints, "endpoint")} of ${R.count(m.providers, "provider")}. `, X.source(m),
      m.cost_note ? el("span", {text: " " + m.cost_note}) : null);
    if (!chips.length) {
      D.replace(card.body, about, D.notice("info", m.ix_key ? `No published recipe keeps each user at ${S.mt} tokens per second on these GPUs: lower the speed above.`
        : "No public benchmark runs this model on these GPUs, so it has prices and no serving cost."), endpointTable(m, null));
      return;
    }
    const best = pairs.filter((q) => has(q.breakeven)).sort((a, b) => a.breakeven - b.breakeven)[0], lines = curves(m);
    if (lines) lines.append(D.tableToggle("the lines as a table", () => curveTable(m)));
    D.replace(card.body, about,
      el("div", {class: "grid2"}, breakeven(m, chips), p ? endpoints(m, p) : el("p", {class: "muted", text: "No run on this GPU at this speed."})),
      el("div", {class: "mspace"}, lines), gpuTable(m, pairs), D.tableToggle("its endpoints as a table", () => endpointTable(m, p)),
      R.summary(best ? `${m.name}: cheapest to serve on ${X.gpuName(best.chip)}, which is paid (${X.basis().phrase}) from ${X.load(best.breakeven)} load at ${X.PRICES[S.mp]}` +
        (p && has(p.breakeven) ? `; on ${X.gpuName(p.chip)} from ${X.load(p.breakeven)}, where ${p.covering} of ${p.endpoints} endpoints pay the GPU at ${S.mu} % load.` : ".")
        : `${m.name} has no endpoint price to set against its serving cost.`));
  }
  X.root.append(card.root);
  X.blocks.push({draw});
})(typeof window !== "undefined" ? window : globalThis);
