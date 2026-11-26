/* Prices: what a model's endpoints charge on each day a price list was taken, and against that the rent that a
   million output tokens carries on each configuration, at the rent and the utilisation chosen under Assumptions. */
(function (root) {
  "use strict";
  const D = root.Dash, E = root.EconMath, R = root.Reg, M = root.RegMath;
  if (!R) return;
  const el = D.el, fmt = D.fmt, has = M.has, S = R.S;
  const card = R.section("prices", "Prices",
    "The model's price on each day its list was taken: every endpoint's output price, the range of the middle half, and " +
    "the most common price. The lines are the rent each million output tokens carries on a measured configuration.");

  const stats = (values) => (values.length ? {min: Math.min(...values), median: E.pct(values, 50), max: Math.max(...values),
                                              p25: E.pct(values, 25), p75: E.pct(values, 75)} : null);
  function render() {
    const models = Array.from(new Set(R.snapshots.map((s) => s.model)));
    D.replace(card.controls, R.pick("Price list of", "pm", models.map((m) => ({value: m, label: m}))));
    const snaps = R.snapshots.filter((s) => s.model === S.pm);
    if (!snaps.length) { D.replace(card.body, el("p", {class: "muted", text: "No price list in the registry yet."})); return; }
    const priced = M.asOf(R.records.filter((r) => (r.prices || {}).model === S.pm), null).map((r) => {
      const p = M.at(r, "loosest"), x = p ? R.sums(r, p) : null;
      return x && has(x.perM) ? {r, p, perM: x.perM} : null;
    }).filter(Boolean).sort((a, b) => a.perM - b.perM);
    const named = snaps.some((s) => s.by_endpoint.some((e) => e.provider));
    const chart = D.dotRows({
      title: "Output price per million tokens, by price list", sub: `${S.pm} · each dot is an endpoint; the band is the middle half; the large dot is the most common price`,
      x: {label: "USD per million output tokens"},
      rows: snaps.map((s, i) => {
        const out = s.by_endpoint.map((e) => e.output), st = stats(out);
        return {label: R.dateText(s.taken), slot: 1, band: [st.p25, st.p75],
                dots: s.by_endpoint.map((e, j) => ({x: e.output, title: e.provider || `Endpoint ${j + 1} of ${R.dateText(s.taken, false)}`,
                  rows: [[fmt.usd(e.output), "output, per M tokens"], [fmt.usd(e.input), "input"], has(e.cached_input) ? [R.usd3(e.cached_input), "cached input"] : null,
                         [e.quantization || "unknown", "quantisation"]].filter(Boolean)})),
                mark: s.common ? {x: s.common.output, label: fmt.usd(s.common.output), title: `Most common price, ${R.dateText(s.taken)}`,
                                  rows: [[`${fmt.usd(s.common.input)} / ${fmt.usd(s.common.output)}`, "input / output, per M tokens"], [String(s.common.endpoints), "endpoints charge it"]]} : null};
      }),
      refs: (priced.length > 1 ? [priced[0], priced[priced.length - 1]] : priced)  // the cheapest and the dearest configuration
        .map((x) => ({value: x.perM, label: `rent, ${R.config(x.r)}: ${R.usd3(x.perM)}`, faint: true})),
      table: {label: "the endpoints of the latest list", make: () => endpoints(snaps[snaps.length - 1], named)}});
    const rows = snaps.map((s, i) => {
      const o = stats(s.by_endpoint.map((e) => e.output)), n = stats(s.by_endpoint.map((e) => e.input)), c = stats(s.by_endpoint.map((e) => e.cached_input).filter(has));
      const before = i ? stats(snaps[i - 1].by_endpoint.map((e) => e.output)) : null;
      return {date: R.dateText(s.taken), endpoints: s.by_endpoint.length, providers: s.providers, omin: o.min, omed: o.median, omax: o.max, imed: n.median,
              pair: s.common ? `${fmt.usd(s.common.input)} / ${fmt.usd(s.common.output)}` : "-", cmed: c ? c.median : null,
              change: before ? M.change(o.median, before.median) : null};
    });
    const lists = D.table([
      {key: "date", label: "Taken"}, {key: "endpoints", label: "Endpoints", num: true}, {key: "providers", label: "Providers", num: true},
      {key: "pair", label: "Most common, in / out", num: true}, {key: "imed", label: "Input, median", num: true, cell: fmt.usd},
      {key: "omin", label: "Output, lowest", num: true, cell: R.usd3}, {key: "omed", label: "Output, median", num: true, cell: fmt.usd},
      {key: "omax", label: "Output, highest", num: true, cell: fmt.usd}, {key: "cmed", label: "Cached input, median", num: true, cell: R.usd3},
      {key: "change", label: "Median output against the list before", num: true, cell: (v) => (has(v) ? el("span", {class: "delta flat", text: R.signed(v)}) : "-")}],
      rows, {caption: "The price lists in the registry, USD per million tokens"});
    const latest = snaps[snaps.length - 1].by_endpoint.map((e) => e.output);
    const costs = D.table([
      {key: "name", label: "Configuration, at its loosest met target"}, {key: "hw", label: "Hardware"}, {key: "engine", label: "Engine"},
      {key: "rent", label: "Rent per GPU-hour", num: true, cell: fmt.usd}, {key: "perM", label: `Rent per M output tokens at ${S.u} %`, num: true, cell: R.usd3},
      {key: "above", label: "Endpoints whose output price is above it", num: true, cell: (v) => `${v} of ${latest.length}`}],
      priced.map((x) => ({_slot: R.slot(x.r), name: R.config(x.r), hw: R.hw(x.r), engine: R.engine(x.r), rent: R.rent(x.r), perM: x.perM,
                          above: latest.filter((v) => v > x.perM).length})),
      {caption: "The rent on a million output tokens, against the latest list: with no input revenue counted, an endpoint priced below it sells at a loss"});
    const first = stats(snaps[0].by_endpoint.map((e) => e.output)), last = stats(latest);
    D.replace(card.body, chart, R.summary(`${R.count(snaps.length, "price list")} of ${S.pm}, from ${R.dateText(snaps[0].taken)} to ${R.dateText(snaps[snaps.length - 1].taken)}. ` +
      `The median output price went from ${fmt.usd(first.median)} to ${fmt.usd(last.median)} per million tokens; the latest list has ${R.count(latest.length, "endpoint")} between ` +
      `${R.usd3(last.min)} and ${fmt.usd(last.max)}.` + (priced.length ? ` At the rent in use, the cheapest measured configuration puts ${R.usd3(priced[0].perM)} of rent on a million output tokens.` : "")),
      lists, priced.length ? costs : null);
  }
  function endpoints(snap, named) {
    const cols = [{key: "q", label: "Quantisation"}, {key: "input", label: "Input", num: true, cell: fmt.usd}, {key: "output", label: "Output", num: true, cell: fmt.usd},
                  {key: "cached", label: "Cached input", num: true, cell: R.usd3}];
    if (named) cols.unshift({key: "provider", label: "Provider"});
    return D.table(cols, snap.by_endpoint.map((e) => ({provider: e.provider, q: e.quantization || "unknown", input: e.input, output: e.output, cached: e.cached_input})),
      {sort: "output", dir: 1, caption: `${R.count(snap.by_endpoint.length, "endpoint")} on ${R.dateText(snap.taken)}, USD per million tokens`});
  }
  R.views.push({id: "prices", title: "Prices", icon: "prices", root: card.root, render});
})(typeof window !== "undefined" ? window : globalThis);
