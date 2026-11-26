/* Explore: every configuration as a curve through its met latency targets, a chosen value against the speed one user
   gets. The run-date control shows the registry as it stood on a day; the panel beside the chart lists the curves
   and how they are drawn; the same data is a sortable table, and downloads as CSV, JSON or SVG. */
(function (root) {
  "use strict";
  const D = root.Dash, R = root.Reg, M = root.RegMath;
  if (!R) return;
  const el = D.el, fmt = D.fmt, has = M.has, S = R.S, C = R.charts;
  const XAXIS = {p50: "the median request (p50)", p90: "the 90th percentile (p90)", p99: "the 99th percentile (p99)"};
  const card = R.section("explore", "Explore",
    "Each curve is one run of a configuration: its met latency targets, from the loosest to the tightest. Up is more " +
    "of the chosen value, right is faster for each user. Move over the chart to read every curve at the same speed.");
  const zoom = {};
  let fig = null, last = "";

  function shown() {  // the runs drawn: each configuration's latest on or before the chosen day, or every run until then
    const day = R.asOfDay(), scope = R.scope();
    const latest = new Set(M.asOf(scope, day).map((r) => r.id));
    return (S.every ? scope.filter((r) => !day || R.day(r) <= day) : scope.filter((r) => latest.has(r.id)))
      .map((r) => ({r, old: !latest.has(r.id)}));
  }

  function pointOf(r, p) {
    const x = M.speed(p, S.x), y = R.value(S.y, r, p);
    if (!has(x) || !has(y)) return null;
    const res = (r.results || []).find((q) => q.slo.tpot_p99_ms === p.tpot_limit) || {};
    const wy = (res.windows || []).map((w) => R.value(S.y, r, Object.assign({}, p, {
      input_tok_s: w.input_tok_s, output_tok_s: w.output_tok_s, tok_per_j: w.tok_per_j, node_power_w: w.node_power_w}))).filter(has);
    const ci = (p.pooled || {}).p99_tpot_ci_ms, x2 = R.sums(r, p), met = R.METRICS[S.y];
    return {
      x, y, p, tag: `≤ ${fmt.n(p.tpot_limit)} ms`,
      yerr: wy.length > 1 ? [Math.min(...wy), Math.max(...wy)] : null,
      xerr: S.x === "p99" && ci && has(ci[0]) && has(ci[1]) ? [1000 / ci[1], 1000 / ci[0]] : null,
      pick: () => { S.run = r.id; R.update(); R.goto("runs"); },
      rows: [[R.target(p), "the target met (p99), with TTFT ≤ " + fmt.n((p.ttft_limit || 2000) / 1000) + " s"],
             [fmt.n(x, 1), "tokens/s per user, " + S.x], [met.show(y), met.short],
             S.y !== "out" ? [fmt.n(p.output_tok_s / p.gpus), "output tokens/s per GPU"] : null,
             [fmt.n(p.rate_rps, 2), "requests/s on " + R.hw(r)],
             [fmt.ms(p.p99_tpot_ms, 1) + (ci && has(ci[1]) ? ` (${fmt.n(ci[0], 1)} to ${fmt.n(ci[1], 1)})` : ""), "TPOT p99" + (ci ? ", 95 % interval" : "")],
             [fmt.ms(p.p99_ttft_ms), "TTFT p99"],
             has(p.tok_per_j) && S.y !== "tokj" ? [fmt.n(p.tok_per_j, 2), "output tokens per joule"] : null,
             x2 && S.y !== "usd" ? [fmt.usd(x2.rev), "per GPU-hour at full load"] : null,
             wy.length > 1 ? [`${met.show(Math.min(...wy))} to ${met.show(Math.max(...wy))}`, `across its ${wy.length} windows`] : null,
             [R.dateText(r.created), "measured · click for the run"]]};
  }

  function build() {  // {series, skipped}: the curves of the view, each point a met target
    const hidden = new Set(String(S.hide || "").split(",").filter(Boolean)), list = shown();
    const names = list.map(({r}) => `${R.config(r)} · ${R.engine(r)}`);
    let skipped = 0;
    const series = list.map(({r, old}, i) => {
      const pts = R.met(r).map((p) => pointOf(r, p));
      skipped += pts.filter((p) => !p).length;
      const twice = names.filter((n) => n === names[i]).length > 1;
      return {r, id: r.id, old, off: hidden.has(r.id), slot: R.slot(r), faded: old, points: pts.filter(Boolean),
              label: names[i] + (twice ? `, ${R.dateText(r.created, false)}` : ""),
              name: `${R.runName(r)}, ${R.dateText(r.created)}`};
    });
    if (S.front) {  // only the points no other visible point beats in both speed and value
      const all = series.filter((s) => !s.off).flatMap((s) => s.points);
      const keep = M.frontier(all, !!R.METRICS[S.y].lower);
      const on = new Set(all.filter((_, i) => keep[i]));
      for (const s of series) s.points = s.points.filter((p) => on.has(p));
    }
    return {series, skipped};
  }

  // --- the choices above the chart
  function dayControl() {
    const days = R.days(), at = S.asof === "latest" ? days.length - 1 : days.indexOf(S.asof);
    const go = (i) => { S.asof = i >= days.length - 1 ? "latest" : days[Math.max(0, i)]; R.update(); };
    const prev = R.button("The run date before", "left", () => go(at - 1)), next = R.button("The run date after", "right", () => go(at + 1));
    prev.disabled = at <= 0;
    next.disabled = at >= days.length - 1;
    const options = days.map((d, i) => ({value: i === days.length - 1 ? "latest" : d,
      label: R.dateText(d) + (i === days.length - 1 ? " (latest)" : "")})).reverse();
    return D.control("Run date", prev, D.select("Run date", options, S.asof, (v) => { S.asof = v; R.update(); }), next);
  }
  function runControl(list) {
    const options = [{value: "", label: `${R.count(list.length, "run")} shown: open one`}].concat(
      list.map(({r}) => ({value: r.id, label: `${R.dateText(r.created, false)} · ${R.config(r)} · ${R.engine(r)}`})));
    return D.control("Run", D.select("Run", options, "", (v) => { if (v) { S.run = v; R.update(); R.goto("runs"); } }));
  }
  function changelog() {
    const box = el("details", {class: "changelog"}, el("summary", {text: "Changelog of econ's versions"}));
    for (const c of R.site.changelog || []) {
      const used = R.records.filter((r) => r.econ.version === c.version).length;
      box.append(el("p", {}, el("strong", {text: `econ ${c.version}`}), ` (${c.date}): ${c.text} `,
        used ? el("span", {class: "muted", text: `${R.count(used, "run")} here measured with it.`}) : null));
    }
    return box;
  }
  function downloads(data) {
    const rows = tableRows(data), stem = `econ-results_${S.y}_${S.asof}`;
    const header = ["run", "id", "measured", "target_tpot_p99_ms", `speed_per_user_${S.x}_tok_s`, S.y, "output_tok_s_per_gpu",
                    "rate_rps", "p99_tpot_ms", "p99_ttft_ms", "tok_per_j"];
    const flat = rows.map((x) => [x.name, x.id, x.created, x.limit, x.speed, x.value, x.out, x.rate, x.tpot, x.ttft, x.tokj]);
    return el("div", {class: "btnrow", role: "group", "aria-label": "Download this view"},
      el("span", {class: "clabel", text: "Download"}),
      R.button("CSV", null, () => R.download(stem + ".csv", "text/csv", R.csv([header].concat(flat)))),
      R.button("JSON", null, () => R.download(stem + ".json", "application/json",
        JSON.stringify({view: {model: S.model, x: S.x, y: S.y, as_of: S.asof, price: S.price, rent: S.rent, utilisation: S.u / 100,
                               cached_share: S.cached / 100}, rows: flat.map((f) => Object.fromEntries(header.map((h, i) => [h, f[i]])))}, null, 1))),
      R.button("SVG", null, () => { const svg = fig && fig.host.querySelector("svg"); if (svg) R.download(stem + ".svg", "image/svg+xml", C.svgText(svg)); }));
  }

  // --- the panel beside the chart: the curves, quick filters and how they are drawn
  function panel(data) {
    const all = data.series, setHide = (ids) => { S.hide = ids.join(","); R.update(); };
    const list = el("ul", {class: "serieslist"}, all.map((s) => {
      const box = el("input", {type: "checkbox", checked: !s.off});
      box.addEventListener("change", () => setHide(all.filter((o) => (o === s ? !box.checked : o.off)).map((o) => o.id)));
      return el("li", {class: s.old ? "old" : null}, el("label", {}, box, C.key(s.slot, "line"),
        el("span", {}, el("span", {class: "sname", text: s.label}),
          el("span", {class: "ssub", text: `${R.hw(s.r)} · ${R.dateText(s.r.created, false)}` + (s.points.length ? "" : " · no met target here")}))));
    }));
    const quick = (title, of) => {
      const values = Array.from(new Set(all.map((s) => of(s.r))));
      return values.length > 1 ? el("div", {class: "quick"}, el("span", {class: "clabel", text: title}), values.map((v) => {
        const only = all.filter((s) => of(s.r) !== v).map((s) => s.id);
        const b = el("button", {type: "button", class: "chip", text: v, title: `Show only ${v}`,
                                "aria-pressed": String(all.every((s) => s.off === (of(s.r) !== v)))});
        b.addEventListener("click", () => setHide(b.getAttribute("aria-pressed") === "true" ? [] : only));
        return b;
      })) : null;
    };
    const reset = R.button("Show every curve", null, () => setHide([]), "text");
    reset.disabled = !all.some((s) => s.off);
    return el("aside", {class: "panel", "aria-label": "The curves and how they are drawn"},
      el("div", {class: "phead"}, el("h3", {text: "Curves"}), reset), list,
      quick("GPU", (r) => R.gpu(r)), quick("Engine", (r) => R.engine(r)), quick("Family", (r) => r.config.family),
      el("div", {class: "switches"}, R.toggle("Log scale", "log"), R.toggle("Only the frontier", "front"),
        R.toggle("Target on each point", "tl"), R.toggle("Intervals", "unc"), R.toggle("Every run, not only the latest", "every")));
  }

  function readout(data, speed) {  // every visible curve read at one speed per user, as econ's same-speed rule reads it
    const met = R.METRICS[S.y];
    if (!has(speed)) return [el("span", {class: "muted", text: "Move over the chart to read every curve at the same speed per user; click to pin the cursor. Shift + wheel zooms, drag pans, double click resets."})];
    return [el("strong", {text: `At ${fmt.n(speed, 1)} tokens/s per user: `})].concat(data.series.filter((s) => !s.off && s.points.length).map((s) => {
      const v = M.atSpeed(s.points.map((p) => [p.x, p.y]).sort((a, b) => a[0] - b[0]), speed);
      return el("span", {class: "read"}, C.key(s.slot, "dot"), el("span", {text: s.label + " "}),
        el("strong", {text: v ? (v[1] ? "" : "~") + met.show(v[0]) : "not measured there",
                      title: v ? (v[1] ? "Measured at this speed" : "On the line between its two nearest measured points") : "Outside its measured points, or between two that are too far apart"}));
    }));
  }

  function tableRows(data) {
    return data.series.filter((s) => !s.off).flatMap((s) => s.points.map((q) => ({
      _slot: s.slot, name: s.label, id: s.id, created: s.r.created, date: R.dateText(s.r.created), limit: q.p.tpot_limit,
      speed: q.x, value: q.y, out: q.p.output_tok_s / q.p.gpus, rate: q.p.rate_rps, tpot: q.p.p99_tpot_ms, ttft: q.p.p99_ttft_ms,
      tokj: q.p.tok_per_j, _pick: q.pick})));
  }
  function table(data) {
    const met = R.METRICS[S.y], open = (_, row) => { const b = el("button", {type: "button", class: "linkish", text: "open"}); b.addEventListener("click", row._pick); return b; };
    return D.table([
      {key: "name", label: "Run"}, {key: "date", label: "Measured"},
      {key: "limit", label: "Target, TPOT p99", num: true, cell: (v) => `≤ ${fmt.n(v)} ms`},
      {key: "speed", label: `Tokens/s per user (${S.x})`, num: true, cell: (v) => fmt.n(v, 1)},
      {key: "value", label: met.label, num: true, cell: met.show},
      {key: "out", label: "Output tok/s per GPU", num: true, cell: (v) => fmt.n(v)},
      {key: "rate", label: "Req/s", num: true, cell: (v) => fmt.n(v, 2)},
      {key: "tpot", label: "TPOT p99", num: true, cell: (v) => fmt.ms(v, 1)},
      {key: "ttft", label: "TTFT p99", num: true, cell: (v) => fmt.ms(v)},
      {key: "tokj", label: "Output tok/J", num: true, cell: (v) => fmt.n(v, 2)},
      {key: "open", label: "", cell: open}], tableRows(data), {sort: "value", dir: met.lower ? 1 : -1});
  }

  function summary(data) {
    const met = R.METRICS[S.y], on = data.series.filter((s) => !s.off && s.points.length), day = R.dateText(R.asOfDay() || R.days().slice(-1)[0] || "");
    if (!on.length) return `No run of ${S.model} has a met target to draw in this view.`;
    const pts = on.flatMap((s) => s.points.map((p) => ({s, p})));
    const best = pts.reduce((a, b) => ((met.lower ? b.p.y < a.p.y : b.p.y > a.p.y) ? b : a)), fast = pts.reduce((a, b) => (b.p.x > a.p.x ? b : a));
    return `As of ${day}, ${R.count(on.length, "curve")} of ${S.model}. ${best.s.label} has the ${met.lower ? "lowest" : "highest"} ` +
      `${R.lower(met.label)}, ${met.show(best.p.y)}, within ${R.target(best.p.p)} at ${fmt.n(best.p.x, 1)} tokens/s per user. ` +
      `The fastest per user is ${fast.s.label} within ${R.target(fast.p.p)}: ${fmt.n(fast.p.x, 1)} tokens/s per user, with ${met.show(fast.p.y)}.` +
      (data.skipped ? ` ${R.count(data.skipped, "met target")} of these runs cannot be drawn with these axes (their files lack the number).` : "");
  }

  function render() {
    const data = build(), met = R.METRICS[S.y], axes = `${S.model}|${S.x}|${S.y}|${S.log}`;
    if (axes !== last) { for (const k of Object.keys(zoom)) delete zoom[k]; last = axes; }
    const zoomRow = el("div", {class: "btnrow", role: "group", "aria-label": "Zoom"}, el("span", {class: "clabel", text: "Zoom"}),
      R.button("Zoom out", null, () => fig && fig.zoomBy(1.25)), R.button("Zoom in", null, () => fig && fig.zoomBy(0.8)),
      R.button("Reset", null, () => fig && fig.resetZoom()));
    zoomRow.children[1].textContent = "−";
    zoomRow.children[2].textContent = "+";
    D.replace(card.controls,
      R.pick("Across: speed per user at", "x", Object.entries(XAXIS).map(([value, label]) => ({value, label}))),
      R.pick("Up: the value", "y", Object.entries(R.METRICS).map(([value, m]) => ({value, label: m.label}))),
      dayControl(), runControl(shown()),
      D.control("View", R.segment("View", "view", [{value: "chart", label: "Chart"}, {value: "table", label: "Table"}])),
      S.view === "chart" ? zoomRow : null, downloads(data));
    const out = el("div", {class: "readout", "aria-live": "off"}, readout(data, null));
    const visible = data.series.filter((s) => !s.off);
    fig = C.frontier({
      title: `${met.label} against tokens/s per user`,
      sub: `${S.model} · ${XAXIS[S.x]} · ${met.priced || met.rented ? priceNote() : "as measured"}`,
      x: {label: `Tokens/s per user (1,000 / TPOT of ${XAXIS[S.x]})`, show: (v) => fmt.n(v, 1) + " tok/s per user"},
      y: {log: S.log > 0, lower: !!met.lower}, bars: S.unc > 0, tags: S.tl > 0, zoom, series: visible,
      onCursor: (speed) => out.replaceChildren(...readout(data, speed))});
    const main = S.view === "table" ? el("div", {class: "tview"}, table(data))
      : el("div", {}, visible.some((s) => s.points.length) ? fig : el("p", {class: "muted", text: "Nothing to draw: no visible run has a met target with these axes."}), out);
    D.replace(card.body, el("div", {class: "explore"}, el("div", {class: "exmain"}, main, R.summary(summary(data))), panel(data)),
      changelog());
  }
  function priceNote() {
    const r = R.scope()[0], price = r && R.price(r), rent = r && R.rent(r);
    const pair = price ? `${fmt.usd(price.input)} in / ${fmt.usd(price.output)} out per M tokens (${price.name})` : "no price list";
    return R.METRICS[S.y].rented ? `rent ${rent ? fmt.usd(rent) : "not set"} per GPU-hour at ${S.u} % utilisation` : pair;
  }

  R.views.push({id: "explore", title: "Explore", icon: "explore", root: card.root, render});
})(typeof window !== "undefined" ? window : globalThis);
