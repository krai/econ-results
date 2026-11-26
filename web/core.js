/* The registry's page: its data (the records and the price lists inside them), the view kept in the URL, the choices
   every section prices with, and the small pieces the sections share. It builds on econ's shell (Dash) and arithmetic
   (EconMath) as they are, and on RegMath for what a registry adds. Every label goes in as text, never as HTML. */
(function (root) {
  "use strict";
  const D = root.Dash, E = root.EconMath, M = root.RegMath;
  if (typeof document === "undefined" || !D || !E || !M) return;
  const fmt = D.fmt, el = D.el, has = M.has;
  const site = D.data("data");
  const records = M.byDate(site.records || []);
  const R = {site, records, views: [], has};

  // --- words for a record
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const FAMILY = {recipe: "recipe", S0: "S0", S1: "S1", stock: "stock"};
  R.day = (r) => r.created.slice(0, 10);
  R.dateText = (iso, year = true) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}` + (year ? ` ${iso.slice(0, 4)}` : "");
  R.engine = (r) => (r.engine.version ? `${r.engine.name} ${r.engine.version}`
    : [r.engine.name, r.engine.build, r.engine.commit].filter(Boolean).join(" "));
  R.gpu = (r) => r.hardware.gpu.replace(/^NVIDIA /, "");
  R.hw = (r) => `${R.gpu(r)} × ${r.hardware.gpus}`;
  R.where = (r) => (r.hardware.cluster ? `${r.hardware.cluster} · ${r.hardware.node}` : r.hardware.node);  // cluster and node
  R.config = (r) => {
    const base = (FAMILY[r.config.family] || r.config.family) + (r.config.tp && r.hardware.gpus > 1 ? ` TP${r.config.tp}` : "");
    return r.config.variant ? `${base}, ${r.config.variant}` : base;
  };
  R.keyName = (r) => `${R.config(r)} · ${R.hw(r)}`;                     // a configuration, whatever it ran with
  R.runName = (r) => `${R.config(r)} · ${R.engine(r)} · ${R.hw(r)}`;    // one run of it
  R.precision = (r) => r.model.precision || "as released";
  R.target = (p) => `TPOT ≤ ${fmt.n(p.tpot_limit)} ms`;
  R.slo = (text) => String(text || "").replace("TTFT p99 <= ", "TTFT ≤ ").replace(", TPOT p99 <= ", ", TPOT ≤ ");
  R.count = (n, noun) => `${fmt.n(n)} ${noun}${n === 1 ? "" : "s"}`;
  R.lower = (text) => text.charAt(0).toLowerCase() + text.slice(1);  // inside a sentence: "output tokens/s per GPU"
  R.usd3 = (v) => (has(v) ? (v < 0 ? "-$" : "$") + fmt.n(Math.abs(v), Math.abs(v) < 10 ? 3 : 2) : "-");
  R.signed = (f, d = 1) => (has(f) ? (f > 0 ? "+" : f < 0 ? "−" : "") + fmt.n(Math.abs(100 * f), d) + " %" : "-");
  R.met = (r) => (r.points || []).filter((p) => p.met && has(p.output_tok_s)).sort((a, b) => b.tpot_limit - a.tpot_limit);
  const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

  // --- what the registry holds
  R.models = Array.from(new Set(records.map((r) => r.model.id)));
  R.keys = Array.from(new Set(records.map(M.key)));
  R.slots = D.slots(R.keys);                    // a colour per configuration, in the order they first ran
  R.slot = (r) => R.slots.get(M.key(r));
  R.gpus = Array.from(new Set(records.map((r) => r.hardware.gpu)));
  R.limits = Array.from(new Set(records.flatMap((r) => r.points.map((p) => p.tpot_limit)))).filter(has).sort((a, b) => b - a);
  const seen = new Map();
  for (const r of records) if (r.prices && r.prices.taken) seen.set(r.prices.model + "|" + r.prices.taken, r.prices);
  R.snapshots = Array.from(seen.values()).sort((a, b) => (a.taken < b.taken ? -1 : 1));
  R.latestPrices = (model) => R.snapshots.filter((s) => s.model === model).slice(-1)[0] || null;

  // --- the view, kept in the URL
  const defaults = {
    at: "explore", model: "", prec: "all", eng: "all",
    x: "p50", y: "out", asof: "latest", every: 0, log: 0, front: 0, tl: 1, unc: 1, view: "chart", hide: "",
    price: "run", pin: 0, pout: 0, rent: "a", u: 100, cached: 0, kwh: 0.1, pue: 1.3,
    lbm: "out", lbt: "loosest", per: "all", more: 0, blog: 0, hist: "", hm: "out", pm: "", run: ""};
  const rentOf = {};
  for (const g of R.gpus) {
    const first = records.find((r) => r.hardware.gpu === g && (r.rents || []).length) || {rents: []};
    rentOf[g] = {a: "ra_" + slug(g), b: "rb_" + slug(g)};
    defaults[rentOf[g].a] = first.rents[0] || 0;
    defaults[rentOf[g].b] = first.rents[1] || 0;
  }
  R.defaults = defaults;
  const S = R.S = D.readState(defaults);
  R.rentKey = (gpu, which) => rentOf[gpu][which];

  function settle() {  // a state that names things this registry has
    const by = (m) => records.filter((r) => r.model.id === m).length;
    if (!R.models.includes(S.model)) S.model = R.models.slice().sort((a, b) => by(b) - by(a))[0] || "";
    const pool = records.filter((r) => r.model.id === S.model);
    if (S.prec !== "all" && !pool.some((r) => R.precision(r) === S.prec)) S.prec = "all";
    if (S.eng !== "all" && !pool.some((r) => R.engine(r) === S.eng)) S.eng = "all";
    for (const [key, values] of Object.entries({x: ["p50", "p90", "p99"], y: Object.keys(R.METRICS), view: ["chart", "table"],
                                                price: ["run", "latest", "custom"], rent: ["a", "b"],
                                                lbm: Object.keys(R.METRICS), hm: Object.keys(R.METRICS),
                                                per: ["all", "30", "7"]})) {
      if (!values.includes(String(S[key]))) S[key] = defaults[key];
    }
    const days = R.days();
    if (S.asof !== "latest" && !days.includes(S.asof)) S.asof = "latest";
    if (S.lbt !== "loosest" && !R.limits.includes(Number(S.lbt))) S.lbt = "loosest";
    const keys = Array.from(new Set(R.scope().map(M.key)));
    if (!keys.includes(S.hist)) S.hist = keys.slice().sort((a, b) => R.scope().filter((r) => M.key(r) === b).length -
      R.scope().filter((r) => M.key(r) === a).length)[0] || "";
    if (!records.some((r) => r.id === S.run)) S.run = "";
    const priced = Array.from(new Set(R.snapshots.map((s) => s.model)));
    if (!priced.includes(S.pm)) S.pm = (pool.find((r) => r.prices) || {prices: {}}).prices.model || priced[0] || "";
    S.u = Math.min(100, Math.max(5, S.u));
    S.cached = Math.min(95, Math.max(0, S.cached));
  }

  // The runs in scope: the chosen model, precision and engine
  R.scope = () => records.filter((r) => r.model.id === S.model && (S.prec === "all" || R.precision(r) === S.prec) &&
    (S.eng === "all" || R.engine(r) === S.eng));
  R.days = () => Array.from(new Set(records.filter((r) => r.model.id === S.model).map(R.day)));
  R.asOfDay = () => (S.asof === "latest" ? null : S.asof);

  // --- the choices every section prices with
  R.METRICS = {
    out: {label: "Output tokens/s per GPU", short: "tok/s per GPU", show: (v) => fmt.n(v)},
    usd: {label: "Revenue per GPU-hour at full load", short: "USD per GPU-hour", show: (v) => fmt.usd(v), priced: true},
    tokusd: {label: "Output tokens per $1 of rent", short: "M tokens per $1", show: (v) => (has(v) ? fmt.n(v, 2) + " M" : "-"),
             rented: true},
    tokj: {label: "Output tokens per joule", short: "tokens per joule", show: (v) => fmt.n(v, 2)},
    cost: {label: "Rent per million output tokens", short: "USD per M tokens", show: (v) => R.usd3(v), lower: true, rented: true},
  };
  R.rent = (r) => { const v = S[rentOf[r.hardware.gpu][S.rent === "b" ? "b" : "a"]]; return v > 0 ? v : null; };
  R.price = function (r) {
    const own = M.market(r.prices), late = M.market(R.latestPrices(r.model.priced_as || (r.prices || {}).model));
    if (S.price === "custom") return {input: S.pin, output: S.pout, cached: (late || own || {}).cached, name: "your prices"};
    if (S.price === "latest" && late) return Object.assign(late, {name: "the latest price list"});
    return own ? Object.assign(own, {name: "the price list of its day"}) : null;
  };
  R.assume = () => ({u: S.u / 100, cached: S.cached / 100, kwh: S.kwh, pue: S.pue});
  R.sums = function (r, p) { const price = R.price(r); return price ? M.sums(p, price, R.rent(r), R.assume()) : null; };
  R.value = (key, r, p) => (p ? M.metric(key, p, R.sums(r, p)) : null);

  // Every number econ priced in every record, recomputed by the page: econ's own check of each record, and then the
  // registry's own way to a price (the snapshot's common pair, the record's rents, full load), which must land on the
  // same numbers.
  R.selfCheck = function () {
    const bad = [];
    let checked = 0;
    const expect = (what, got, want) => {
      checked++;
      if (!(got === want || (has(got) && has(want) && Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want))))) {
        bad.push(`${what}: the page has ${got}, econ ${want}`);
      }
    };
    for (const r of records) {
      const c = E.check({points: r.points, prices: r.prices});
      checked += c.checked;
      bad.push(...c.mismatches.map((m) => `${r.id}: ${m}`));
      const mk = M.market(r.prices);
      for (const p of r.points) {
        const w = p.worth;
        if (!mk || !w || !w.common) continue;
        for (const row of w.rents || []) {
          const x = M.sums(p, mk, row.rent, {u: 1, cached: 0}), at = `${r.id}, ${p.slo}, rent ${row.rent}`;
          expect(`${at}: revenue`, x.rev, w.common.revenue);
          expect(`${at}: break-even`, x.be, row.break_even_common);
          expect(`${at}: margin at full load`, x.margin, row.margin_common["1"]);
          expect(`${at}: rent per M output`, x.perM, row.cost_per_m_output["1"]);
        }
      }
    }
    return {checked, bad};
  };

  // --- pieces the sections share
  const ICONS = {
    explore: "M2 13c2-6 4-8 6-8s3 4 6-2M2 2v12h12", rankings: "M3 14V8M8 14V3M13 14v-4", history: "M8 4v4l3 2M2.5 8a5.5 5.5 0 1 0 2-4.2M2 2v3h3",
    prices: "M2 8V2h6l6 6-6 6zM5.5 5.5h.01", runs: "M2 4h12M2 8h12M2 12h12", about: "M8 7v4M8 4.5h.01M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z",
    link: "M7 9a3 3 0 0 0 4 0l2-2a3 3 0 0 0-4-4l-1 1M9 7a3 3 0 0 0-4 0L3 9a3 3 0 0 0 4 4l1-1", copy: "M5 5V3h8v8h-2M3 5h8v8H3z",
    down: "M8 2v8M5 7l3 3 3-3M3 13h10", check: "M3 8.5l3 3 7-7", cross: "M4 4l8 8M12 4l-8 8", left: "M10 3L5 8l5 5", right: "M6 3l5 5-5 5",
    theme: "M8 2a6 6 0 1 0 6 6 4.5 4.5 0 0 1-6-6z"};
  R.icon = function (name) {
    const svg = D.svgEl("svg", {class: "ic", width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": "true"});
    svg.append(D.svgEl("path", {d: ICONS[name], fill: "none", stroke: "currentColor", "stroke-width": 1.5,
                                "stroke-linecap": "round", "stroke-linejoin": "round"}));
    return svg;
  };
  R.button = function (label, icon, onClick, cls) {
    const b = el("button", {type: "button", class: "btn" + (cls ? " " + cls : ""), "aria-label": icon && !cls ? label : null,
                            title: label}, icon ? R.icon(icon) : null, cls === "text" || !icon ? el("span", {text: label}) : null);
    b.addEventListener("click", onClick);
    return b;
  };
  R.copy = function (text, button) {
    const done = () => { button.classList.add("done"); setTimeout(() => button.classList.remove("done"), 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => {});
  };
  R.linkTo = function (section) {
    const h = new URLSearchParams(root.location.hash.slice(1));
    h.set("at", section);
    return root.location.href.split("#")[0] + "#" + h.toString();
  };
  R.download = function (name, type, text) {
    const a = el("a", {href: URL.createObjectURL(new Blob([text], {type})), download: name});
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  R.csv = (rows) => rows.map((row) => row.map((v) => { const s = has(v) ? String(v) : ""; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n") + "\n";
  // A sentence under a chart that says what it shows, for a screen reader and to copy
  R.summary = function (text) {
    const b = R.button("Copy this summary", "copy", () => R.copy(text, b));
    return el("p", {class: "summary"}, el("span", {text}), b);
  };
  // A choice bound to the view: a select, a switch, or a pair of buttons
  R.pick = function (label, key, options) {
    const select = D.select(label, options, S[key], (v) => {
      S[key] = typeof defaults[key] === "number" ? Number(v) : v;
      R.update();
    });
    select.dataset.k = key;
    return D.control(label, select);
  };
  R.toggle = function (label, key) {
    const input = el("input", {type: "checkbox", role: "switch", checked: S[key] > 0, "data-k": key});
    input.addEventListener("change", () => { S[key] = input.checked ? 1 : 0; R.update(); });
    return el("label", {class: "switch"}, input, el("span", {class: "track", "aria-hidden": "true"}), el("span", {text: label}));
  };
  R.segment = function (label, key, options) {
    return el("div", {class: "segment", role: "group", "aria-label": label}, options.map((o) => {
      const b = el("button", {type: "button", "aria-pressed": String(S[key] === o.value), text: o.label, "data-k": `${key}:${o.value}`});
      b.addEventListener("click", () => { S[key] = o.value; R.update(); });
      return b;
    }));
  };
  R.delta = function (f, lowerIsBetter) {  // a change against the run before: an arrow, a sign and a colour, never the colour alone
    if (!has(f)) return el("span", {class: "delta none", text: "first run", title: "No earlier run of this configuration"});
    const good = lowerIsBetter ? f < 0 : f > 0, flat = Math.abs(f) < 0.0005;
    return el("span", {class: "delta " + (flat ? "flat" : good ? "up" : "down"),
                       title: "Against the run of this configuration before it"},
      el("span", {"aria-hidden": "true", text: flat ? "→ " : f > 0 ? "▲ " : "▼ "}), R.signed(f));
  };
  // A section of the page: a card with its heading, a button that copies its link, a row of choices and a body
  R.section = function (id, title, lead) {
    const card = D.card(id, title, lead);
    const link = R.button("Copy the link to this section", "link", () => R.copy(R.linkTo(id), link));
    card.root.querySelector("h2").append(link);
    card.controls = el("div", {class: "choices"});
    card.root.insertBefore(card.controls, card.body);
    return card;
  };

  // Draw every section again after a change of the view. reason "typing": a number or a slider is being changed, so
  // the section that holds it keeps its controls as they are.
  R.update = function (reason) {
    settle();
    D.writeState();
    for (const v of R.views) v.render(reason);
  };
  R.settle = settle;
  root.Reg = R;
})(typeof window !== "undefined" ? window : globalThis);
