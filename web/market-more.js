/* Market, the rest of the section: the one benchmark that runs a model the same way on every system (hardware against
   software), a provider's own published day as a reference, the registry's runs of the models that are on this
   market, and how every number of the section is made. */
(function (root) {
  "use strict";
  const D = root.Dash, R = root.Reg, K = root.MarketMath, M = root.RegMath;
  const X = R && R.market;
  if (!X) return;
  const el = D.el, svgEl = D.svgEl, fmt = D.fmt, has = K.has, S = R.S, C = R.charts, market = X.data;
  const CHIP = {vr200: "Vera Rubin"};
  const chipName = (c) => CHIP[c] || X.gpuName(c);

  // --- hardware or software: MLPerf Endpoints, one model, every system
  const hw = R.section("market-hardware", "Hardware or software? The same model on every system",
    "MLPerf Endpoints runs DeepSeek V4.1 Flash, agentic, the same way on every system submitted. Per GPU is a system's output divided by its GPUs: " +
    "that division is ours, not an MLPerf metric.");
  // KRAI's own systems, and the best other submission on each chip: a bar each
  function systems() {
    const key = String(S.mt), rows = market.mlperf.filter((s) => has(s.at[key]));
    const ours = rows.filter((s) => s.ours).map((s) => ({label: s.label.replace(/^KRAI · /, ""), value: s.at[key], ours: true, s}));
    const others = new Map();
    for (const s of rows.filter((x) => !x.ours)) if (!others.has(s.chip) || s.at[key] > others.get(s.chip).at[key]) others.set(s.chip, s);
    return ours.concat(Array.from(others.values()).map((s) => ({label: `${chipName(s.chip)} · best other submission`, value: s.at[key], ours: false, s})))
      .sort((a, b) => a.value - b.value);
  }
  function bars(rows) {
    return C.frame({title: `Output tokens/s per GPU at ${S.mt} tokens/s per user`, keys: "block",
                    legend: [{name: "KRAI's submissions", slot: 1}, {name: "the best other submission on a chip", slot: 0}],
                    sub: "MLPerf Endpoints v1.0, DeepSeek V4.1 Flash, at the average speed per user."}, (W) => {
      const rowH = 26, lw = Math.min(250, W * 0.46), g = {l: lw + 10, r: 58, t: 6, b: 24}, H = g.t + rowH * rows.length + g.b, pw = W - g.l - g.r;
      const max = Math.max(...rows.map((r) => r.value)), x = (v) => g.l + pw * v / max, fit = Math.max(6, Math.floor(lw / 6.6));
      const svg = C.svg(W, H, "Output tokens per second per GPU of each MLPerf Endpoints system"), marks = [];
      for (const t of M.niceTicks(0, max, 4)) {
        if (t > max) continue;
        svg.append(svgEl("line", {x1: x(t), x2: x(t), y1: g.t, y2: H - g.b, class: "gl"}),
                   svgEl("text", {x: x(t), y: H - g.b + 16, class: "tick num", "text-anchor": "middle"}, fmt.tick(t, max)));
      }
      rows.forEach((r, i) => {
        const y = g.t + i * rowH, w = Math.max(2, x(r.value) - g.l), short = r.label.length > fit ? r.label.slice(0, fit - 1) + "…" : r.label;
        const t = svgEl("text", {x: g.l - 8, y: y + rowH / 2 + 4, class: "rlabel", "text-anchor": "end"}, short);
        if (short !== r.label) t.append(svgEl("title", {}, r.label));
        svg.append(t, svgEl("rect", {x: g.l, y: y + 6, width: w, height: rowH - 12, rx: 3, class: "bar " + C.cls(r.ours ? 1 : 0)}),
                   svgEl("text", {x: g.l + w + 6, y: y + rowH / 2 + 4, class: "dlabel num"}, fmt.n(r.value)));
        marks.push({x: g.l + w, y: y + rowH / 2, box: [g.l, y, W, y + rowH], title: r.label, slot: r.ours ? 1 : 0,
                    rows: [[fmt.n(r.value), `output tokens/s per GPU at ${S.mt} tokens/s per user`], [String(r.s.gpus), "GPUs in the system"],
                           [`${r.s.status}, ${R.dateText(r.s.published)}`, "MLPerf status"]]});
      });
      C.marks(svg, marks);
      return svg;
    });
  }
  // The same chip before and after our kernels: a line from the stock result to ours
  const STEPS = [["bf6ac0d5", "647657c4", "H200: stock vLLM 0.32, then with KRAI kernels"], ["061107c7", "647657c4", "H200: first submission, then with KRAI kernels"],
                 ["758a50bc", "73c4b6bc", "MI300X: stock vLLM, then with KRAI MoE kernels"], ["758a50bc", "3525d905", "MI300X: stock vLLM, then with MoE and sparse-MLA kernels"]];
  function steps() {
    const key = String(S.mt), at = (sub) => { const s = market.mlperf.find((x) => x.submission === sub); return s ? s.at[key] : null; };
    return STEPS.map(([a, b, label]) => ({label, a: at(a), b: at(b)})).filter((r) => has(r.a) && has(r.b));
  }
  function dumbbells(rows) {
    return C.frame({title: "Same chip, better software", legend: [{name: "before", slot: 0, kind: "dot"}, {name: "after", slot: 1, kind: "dot"}],
                    sub: `Output tokens/s per GPU at ${S.mt} tokens/s per user, before and after. MLPerf Endpoints, DeepSeek V4.1 Flash.`}, (W) => {
      const rh = 46, g = {l: 14, r: 74, t: 6, b: 24}, H = g.t + rh * rows.length + g.b, max = Math.max(...rows.map((r) => r.b)) * 1.05, pw = W - g.l - g.r;
      const x = (v) => g.l + pw * v / max, svg = C.svg(W, H, "The same chip with stock software and with KRAI kernels"), marks = [];
      for (const t of M.niceTicks(0, max, 4)) {
        if (t > max) continue;
        svg.append(svgEl("line", {x1: x(t), x2: x(t), y1: g.t, y2: H - g.b, class: "gl"}),
                   svgEl("text", {x: x(t), y: H - g.b + 16, class: "tick num", "text-anchor": "middle"}, fmt.n(t)));
      }
      rows.forEach((r, i) => {
        const y = g.t + i * rh + 30, gain = "+" + fmt.n(100 * (r.b / r.a - 1)) + " %";
        svg.append(svgEl("text", {x: g.l, y: y - 13, class: "rlabel"}, r.label), svgEl("line", {x1: x(r.a), x2: x(r.b), y1: y, y2: y, class: "band"}),
                   svgEl("circle", {cx: x(r.a), cy: y, r: 5, class: "dot sx"}), svgEl("circle", {cx: x(r.b), cy: y, r: 5, class: "dot s1"}),
                   svgEl("text", {x: x(r.b) + 10, y: y + 4, class: "dlabel num"}, gain));
        marks.push({x: x(r.b), y, box: [g.l, y - 14, W, y + 14], title: r.label, slot: 1, rows: [[fmt.n(r.a), "before, output tokens/s per GPU"], [fmt.n(r.b), "after"], [gain, "gain"]]});
      });
      C.marks(svg, marks);
      return svg;
    });
  }
  function drawHardware() {
    const rows = systems(), pairs = steps(), key = String(S.mt);
    const table = () => D.table([{key: "label", label: "System"}, {key: "gpus", label: "GPUs", num: true},
      {key: "v20", label: "At 20 tok/s per user", num: true, cell: (v) => fmt.n(v)}, {key: "v50", label: "At 50", num: true, cell: (v) => fmt.n(v)},
      {key: "v100", label: "At 100", num: true, cell: (v) => fmt.n(v)}, {key: "status", label: "Status"}],
      market.mlperf.map((s) => ({label: s.ours ? s.label : `${chipName(s.chip)} · ${s.label.split(" · ").slice(1).join(" · ") || "another submission"}`, gpus: s.gpus,
                                 v20: s.at["20"], v50: s.at["50"], v100: s.at["100"], status: `${s.status}, ${R.dateText(s.published)}`})),
      {caption: "Output tokens per second per GPU of every system", sort: "v" + key, dir: -1});
    const best = rows.filter((r) => !r.ours).slice(-1)[0], mine = rows.filter((r) => r.ours).slice(-1)[0], chart = rows.length ? bars(rows) : null;
    if (chart) chart.append(D.tableToggle("every system as a table", table));
    D.replace(hw.body, el("div", {class: "grid2"},
      chart || el("p", {class: "muted", text: "No system reaches this speed."}),
      pairs.length ? dumbbells(pairs) : el("p", {class: "muted", text: `No chip has a stock result and one with our kernels that reach ${S.mt} tokens per second per user: choose 50.`})),
      el("p", {class: "note", text: "MLPerf's speed per user is the average over the run; the benchmark runs of the rest of this section use the P90, so the two give different numbers for one chip. " +
        "KRAI's own results are provisional until their peer review ends."}),
      R.summary((mine && best ? `At ${S.mt} tokens per second per user, the best other submission (${best.label.split(" · ")[0]}) gives ${fmt.n(best.value / mine.value)} times the output per GPU of KRAI's best system. ` : "") +
        pairs.map((r) => `${r.label}: +${fmt.n(100 * (r.b / r.a - 1))} %`).join(". ") + (pairs.length ? "." : "")));
  }

  // --- a provider's own published day, as a reference
  const ref = R.section("market-reference", "The reference case: DeepSeek, March 2025",
    "DeepSeek's own overview of its inference system: one day of V3 and R1 traffic on H800s. Its margin is a theoretical one, with every token billed at R1's prices.");
  function drawReference() {
    const d = market.reference, gpuh = d.nodes_avg * 8 * 24, tile = (l, v, n) => el("div", {class: "tile"}, el("div", {class: "tlabel", text: l}), el("div", {class: "tvalue", text: v}), el("div", {class: "tnote", text: n}));
    const rev = d.input_cache_hit_tokens / 1e6 * d.prices_r1.cached_input + (d.input_tokens - d.input_cache_hit_tokens) / 1e6 * d.prices_r1.input + d.output_tokens / 1e6 * d.prices_r1.output;
    const flash = X.model("deepseek-v4.1-flash"), now = (chip) => (flash ? X.pair(flash.model, chip, "owned") : null), u = S.mu / 100;
    const line = (chip) => { const p = now(chip); return p ? `  owned ${X.gpuName(chip)}: revenue ${X.usd(p.rev * u)} per GPU-hour ÷ cost ${X.usd(p.cost)} = ${fmt.n(p.rev * u / p.cost, 1)}×` : null; };
    D.replace(ref.body, el("div", {class: "tiles"},
      tile("H800 GPUs, daily average", fmt.n(d.nodes_avg * 8), `${fmt.n(d.nodes_avg, 2)} nodes; the peak was ${d.nodes_peak}`),
      tile("Cost per day", X.usd(d.cost_day), `at ${X.usd(d.usd_gpu_h)} per GPU-hour`),
      tile("Tokens per day", `${fmt.n(d.input_tokens / 1e9)}B in · ${fmt.n(d.output_tokens / 1e9)}B out`, `${fmt.n(100 * d.input_cache_hit_tokens / d.input_tokens, 1)} % of the input hit the cache on disk`),
      tile("Revenue per GPU-hour", X.usd(rev / gpuh), "at R1's prices, the fleet's average, idle hours included"),
      tile("Margin over cost", fmt.n(100 * (d.revenue_day_theoretical / d.cost_day - 1)) + " %", "revenue ÷ cost − 1, as DeepSeek reports it"),
      tile("Output per GPU, day average", fmt.n(d.output_tokens / gpuh / 3600) + " tok/s", `${d.output_speed_tok_s} tokens/s for each user`)),
      el("pre", {class: "math"}, [`2025: revenue ${X.usd(d.revenue_day_theoretical)} ÷ cost ${X.usd(d.cost_day)} = ${fmt.n(d.revenue_day_theoretical / d.cost_day, 2)}×`,
        `Today, DeepSeek V4.1 Flash at ${X.PRICES[S.mp]}, ${S.mu} % load, each user at ${S.mt} tokens/s or more:`, line("h200"), line("gb300")].filter(Boolean).join("\n")),
      el("p", {class: "note", text: `DeepSeek's figure already carries its fleet's real load: nodes scale down at night, and the day averaged ${fmt.n(d.nodes_avg, 2)} of ${d.nodes_peak} peak nodes. ` +
        `Its real revenue was lower: ${d.caveats.join("; ")}. Today's multiples are benchmark ceilings with your load applied; they leave out everything else a provider pays: staff, networking, storage, and gateway and payment fees.`}));
  }

  // --- the registry's own runs of the models on this market
  const ours = R.section("market-ours", "Our runs on this market",
    "The registry's runs of models that are in the table above, at what econ measured: chat-length prompts with no cache hits, within a p99 latency target. " +
    "The benchmark runs of this section are agentic and mostly cached input, so their revenues do not compare with these; the cost of the GPU does.");
  const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-|-$/g, "");
  function drawOurs() {
    const known = new Map(market.models.map((m) => [m.model, m]));
    const rows = R.records.filter((r) => known.has(slug(r.model.name))).map((r) => {
      const p = M.at(r, "loosest"), gpu = market.gpus.find((g) => slug(r.hardware.gpu).endsWith(g.chip)), w = p && p.worth && p.worth.common;
      const cost = gpu ? K.cost(gpu, S.mb) : null, rev = w ? w.revenue : null;
      return {_r: r, _slot: R.slot(r), created: r.created, model: known.get(slug(r.model.name)).name, run: `${R.config(r)} · ${R.engine(r)}`, where: R.where(r), hw: R.hw(r),
              target: p ? p.tpot_limit : null, rate: p ? p.rate_rps : null, out: p ? p.output_tok_s / p.gpus : null, inp: p ? p.input_tok_s / p.gpus : null,
              tpot: p ? p.p99_tpot_ms : null, rev, cost, breakeven: has(rev) && has(cost) && rev > 0 ? cost / rev : null};
    }).sort((a, b) => (a.created < b.created ? 1 : -1));
    const open = (_, row) => { const b = el("button", {type: "button", class: "linkish", text: "open"}); b.addEventListener("click", () => { S.run = row._r.id; R.goto("runs", "run"); }); return b; };
    D.replace(ours.body, rows.length ? D.table([
      {key: "created", label: "Measured", cell: (v) => R.dateText(v)}, {key: "model", label: "Model"}, {key: "run", label: "Configuration"}, {key: "hw", label: "GPU × N"},
      {key: "where", label: "Cluster · node"}, {key: "target", label: "Target, TPOT p99", num: true, cell: (v) => (has(v) ? `≤ ${fmt.n(v)} ms` : "none met")},
      {key: "rate", label: "Requests/s", num: true, cell: (v) => fmt.n(v, 2)}, {key: "out", label: "Output tok/s per GPU", num: true, cell: (v) => fmt.n(v)},
      {key: "inp", label: "Input tok/s per GPU", num: true, cell: (v) => fmt.n(v)}, {key: "tpot", label: "TPOT p99", num: true, cell: (v) => fmt.ms(v, 1)},
      {key: "rev", label: "Revenue per GPU-hour", num: true, cell: (v) => X.usd(v), title: "At full load, at the most common price of the run's own price list"},
      {key: "cost", label: `GPU-hour, ${X.basis().label.toLowerCase()}`, num: true, cell: (v) => X.usd(v), title: "This market's cost of that GPU, as chosen above"},
      {key: "breakeven", label: "Pays it from", num: true, cell: (v) => X.load(v), title: "The load from which the run's revenue covers that cost"},
      {key: "open", label: "", cell: open}], rows, {caption: `${R.count(rows.length, "run")} of the registry, each at its loosest met latency target`})
      : el("p", {class: "muted", text: "The registry has no run of a model in this market yet."}));
  }

  // --- how the numbers are made
  const method = R.section("market-method", "How the numbers are made", null);
  function drawMethod() {
    const all = Object.values(market.prices).flat(), off = all.filter((e) => e[4] > 0), est = market.models.filter((m) => m.cost_source === "proxy");
    const od = market.gpus.filter((g) => has(g.ondemand_usd_h)).map((g) => `${X.gpuName(g.chip)} ${X.usd(g.ondemand_usd_h)} (${g.ondemand_offers})`).join(", ");
    const items = [
      `Prices: every OpenRouter endpoint of a model with an input price and an output price above zero, as listed on the snapshot's day. They are effective prices: ${off.length} of the ${fmt.n(all.length)} endpoints carry a promotion, of up to ${fmt.n(Math.max(0, ...off.map((e) => e[4])))} %. An endpoint that lists no cached-input price bills cached tokens at its input price. The most common price is the input and output pair most endpoints list; the median is that of all the endpoints' revenues.`,
      "Throughput: published runs of a public agentic benchmark: multi-turn traces with about 130 to 150 thousand tokens of context per request, 90 to 98 % of the input served from the prefix cache, and 100 to 160 input tokens per output token. For each GPU, the recipe (engine, precision, parallelism) with the most tokens per second per GPU among those that keep the speed, which is 1 ÷ the P90 time per output token. Between two runs of one recipe the value is on the straight line. Per GPU counts every GPU of the system. Recipes on an engine that has not served production tokens are left out.",
      "Revenue per GPU-hour = 3,600 × [input tokens/s × ((1 − h) × input price + h × cached price) + output tokens/s × output price] ÷ 10⁶, with h the share of the input that hit the cache. It is the revenue at full load; the load you choose multiplies it.",
      `Cost per GPU-hour: owned and 3-year rent are a published model of the total cost of ownership, for owning at hyperscaler volume and for renting on a 3-year commit. On demand is the median of public list prices read on the snapshot's day: ${od} (offers counted in brackets). Break-even load = cost ÷ revenue at full load; profit = revenue × load − cost.`,
      "Load is the share of the benchmark's capacity that is sold on average: idle hours, daily dips and what is lost at scale all lower it. No licence fee is charged: every model here has open weights.",
      "Tokens sold: “the benchmark's own mix” prices exactly the tokens the run served. Real traffic on OpenRouter carries less input per output token, so “OpenRouter's input per output” keeps the run's output per GPU and sells only the model's own ratio: pessimistic, since a lighter input load would leave the GPU room for more output. “Output only” is a floor.",
      "Not counted: staff, networking, storage, power above the cost model, gateway and payment fees, and accuracy (an FP4 endpoint may serve a less accurate model than an FP8 one).",
      est.length ? "Estimates: " + est.map((m) => `${m.name} uses the runs of ${m.proxy_of}`).join("; ") + ". They are marked “estimated”." : null,
      "Where and when each table was read is in the repository's README, with its sources."];
    D.replace(method.body, el("ul", {class: "plain method"}, items.filter(Boolean).map((t) => el("li", {text: t}))));
  }

  X.root.append(hw.root, ref.root, ours.root, method.root);
  X.blocks.push({draw() { drawHardware(); drawReference(); drawOurs(); drawMethod(); }});
})(typeof window !== "undefined" ? window : globalThis);
