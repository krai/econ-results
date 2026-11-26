/* Runs side by side: the runs ticked in the table of Runs (two to four, of any model), each number against one of
   them. A number that has a better direction shows its difference with an arrow, a sign and a colour; what was served
   and where is in bold where it is not the baseline's. The runs ticked, the one they are set against and the latency
   target are kept in the URL, the runs by the last eight characters of their ids. */
(function (root) {
  "use strict";
  const D = root.Dash, R = root.Reg, M = root.RegMath;
  if (!R) return;
  const el = D.el, fmt = D.fmt, has = M.has, MAX = 4;
  Object.assign(R.defaults, {cmp: "", cb: "", ct: "loosest"});
  const S = D.readState(R.defaults);
  const short = (r) => r.id.slice(-8);
  const ticked = () => S.cmp.split(",").map((k) => R.records.find((r) => short(r) === k)).filter(Boolean);
  const C = R.compare = {box: el("div", {class: "compare", id: "compare"})};
  C.has = (r) => ticked().includes(r);
  C.toggle = function (r) {  // a fifth run ticked takes the place of the first
    const runs = ticked();
    S.cmp = (runs.includes(r) ? runs.filter((x) => x !== r) : runs.concat(r).slice(-MAX)).map(short).join(",");
    R.update();
  };

  // A number of a run: [label, value(point, sums), how it is written, whether lower is better, what it assumes]
  const NUMBERS = [
    ["Requests/s", (p) => p.rate_rps, (v) => fmt.n(v, 2), false],
    ["Output tokens/s per GPU", (p) => p.output_tok_s / p.gpus, (v) => fmt.n(v), false],
    ["Input tokens/s per GPU", (p) => p.input_tok_s / p.gpus, (v) => fmt.n(v), false],
    ["Tokens/s per user (p50)", (p) => M.speed(p, "p50"), (v) => fmt.n(v, 1), false],
    ["TPOT p99", (p) => p.p99_tpot_ms, (v) => fmt.ms(v, 1), true],
    ["TTFT p99", (p) => p.p99_ttft_ms, (v) => fmt.ms(v), true],
    ["Output tokens per joule", (p) => p.tok_per_j, (v) => fmt.n(v, 2), false],
    ["Revenue per GPU-hour", (p, x) => (x ? x.rev : null), fmt.usd, false, "At full load, at the prices chosen under Assumptions"],
    ["Rent per million output tokens", (p, x) => (x ? x.perM : null), R.usd3, true, "At the rent and the utilisation chosen under Assumptions"]];
  const WORDS = [["Measured", (r) => R.dateText(r.created)], ["Model", (r) => r.model.name], ["Precision", R.precision], ["Engine", R.engine],
                 ["Configuration", R.config], ["GPU × N", R.hw], ["Cluster · node", R.where]];

  function change(f, lower) {  // against the baseline: an arrow, a sign and a colour, never the colour alone
    if (!has(f)) return null;
    const flat = Math.abs(f) < 0.0005, good = lower ? f < 0 : f > 0;
    return el("span", {class: "delta " + (flat ? "flat" : good ? "up" : "down"), title: "Against the baseline"},
      el("span", {"aria-hidden": "true", text: flat ? "→ " : f > 0 ? "▲ " : "▼ "}), R.signed(f));
  }
  const act = (text, k, onClick) => { const b = el("button", {type: "button", class: "linkish", text, "data-k": k}); b.addEventListener("click", onClick); return b; };

  C.draw = function () {
    const runs = ticked(), link = R.button("Copy the link to this comparison", "link", () => R.copy(R.linkTo("compare"), link));
    const title = el("h3", {}, "Side by side", link);
    if (runs.length < 2) {
      D.replace(C.box, runs.length ? title : null, el("p", {class: "muted", text: runs.length ? "One run ticked: tick another to set the two side by side."
        : "Tick two to four runs in the table to set them side by side."}));
      return;
    }
    const limit = R.limits.includes(Number(S.ct)) ? Number(S.ct) : "loosest";
    const base = runs.find((r) => short(r) === S.cb) || runs.slice().sort((a, b) => (a.created < b.created ? -1 : 1))[0];
    const cols = runs.map((r) => { const p = M.at(r, limit); return {r, p, x: p ? R.sums(r, p) : null}; }), b = cols.find((c) => c.r === base);
    const head = el("tr", {}, el("td", {}), cols.map((c) => el("th", {scope: "col"},
      el("span", {class: "rname"}, D.swatch(R.slot(c.r)), R.runName(c.r)),
      el("span", {class: "acts"}, c === b ? D.tag("baseline", "solid", "Every other run is set against this one") : act("set the others against it", "cb:" + short(c.r), () => { S.cb = short(c.r); R.update(); }),
        act("open", "cmpopen:" + short(c.r), () => { S.run = c.r.id; R.update(); document.getElementById("run").scrollIntoView({block: "start"}); }),
        act("remove", "cmpdrop:" + short(c.r), () => C.toggle(c.r))))));
    const said = (f) => (c) => el("td", {class: f(c) !== f(b) ? "differs" : null, text: f(c)});
    const words = WORDS.map(([label, f]) => el("tr", {}, el("th", {scope: "row", text: label}), cols.map(said((c) => f(c.r)))));
    const target = el("tr", {}, el("th", {scope: "row", text: "Latency target"}), cols.map(said((c) => (c.p ? R.target(c.p) : "not met"))));
    const numbers = NUMBERS.map(([label, f, show, lower, title]) => el("tr", {}, el("th", {scope: "row", text: label, title}), cols.map((c) => {
      const v = c.p ? f(c.p, c.x) : null, v0 = b.p ? f(b.p, b.x) : null;
      return el("td", {class: "num"}, el("span", {text: has(v) ? show(v) : "-"}), c === b ? null : change(M.change(v, v0), lower));
    })));
    const at = limit === "loosest" ? "each run's loosest met target" : `TPOT ≤ ${fmt.n(limit)} ms`, name = (r) => `${R.runName(r)} of ${R.dateText(r.created)}`;
    const say = cols.filter((c) => c !== b && c.p && b.p).map((c) => `${name(c.r)} gives ${R.signed(M.change(c.p.output_tok_s / c.p.gpus, b.p.output_tok_s / b.p.gpus))} ` +
      `output tokens/s per GPU and ${R.signed(M.change(c.p.p99_tpot_ms, b.p.p99_tpot_ms))} TPOT p99`);
    D.replace(C.box, title,
      el("div", {class: "choices"}, D.control("Latency target", R.segment("Latency target", "ct",
        [{value: "loosest", label: "Loosest met"}].concat(R.limits.map((l) => ({value: String(l), label: `TPOT ≤ ${fmt.n(l)} ms`})))))),
      el("div", {class: "tablewrap"}, el("table", {class: "cmp"}, el("caption", {text: `${R.count(runs.length, "run")} at ${at}; differences are against the baseline`}),
        el("thead", {}, head), el("tbody", {}, words, target, numbers))),
      say.length ? R.summary(`Against ${name(base)}, at ${at}: ${say.join("; ")}.`) : null);
  };
})(typeof window !== "undefined" ? window : globalThis);
