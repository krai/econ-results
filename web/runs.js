/* Runs: every run in scope as a row, and one of them in full: what was served and how, each target with its numbers,
   every probe of its search, the node's check, stability and accuracy, what the measurement does not cover, its
   files, and the record itself to download. Runs come from more than one node and cluster, so each row says where
   it ran; an internal registry also shows the run's provenance. A box finds runs by any word of their row, and the
   runs ticked are set side by side between the table and the run opened (web/compare.js). */
(function (root) {
  "use strict";
  const D = root.Dash, R = root.Reg, M = root.RegMath;
  if (!R) return;
  const el = D.el, fmt = D.fmt, has = M.has, S = R.S;
  const card = R.section("runs", "Runs", "Every run in scope, the latest first. A row opens the run below the table.");
  const listing = el("div", {}), detail = el("div", {class: "rundetail", id: "run"});
  card.body.append(listing, R.compare.box, detail);
  // What the box finds a run by: every word typed must be in its date, model, hardware, place, engine or configuration
  const words = (r) => [R.dateText(r.created), R.day(r), r.model.name, r.model.id, R.hw(r), R.where(r), R.engine(r), R.config(r), r.config.label, r.id].join(" ").toLowerCase();
  const found = (scope) => { const q = S.rq.toLowerCase().split(/\s+/).filter(Boolean); return scope.filter((r) => q.every((w) => words(r).includes(w))); };

  const verdict = (v) => (v ? D.tag(v, v === "PASS" ? "pass" : "warn") : el("span", {class: "muted", text: "-"}));
  const kv = (pairs) => el("dl", {class: "kv"}, pairs.filter((p) => p && has(p[1]) && p[1] !== "").map(([k, v]) => [el("dt", {text: k}), el("dd", {}, v)]));
  const block = (title, ...kids) => (kids.some(Boolean) ? el("div", {class: "setup"}, el("h3", {text: title}), kids) : null);
  const list = (items) => (items && items.length ? el("ul", {class: "plain"}, items.map((t) => el("li", {text: t}))) : null);
  const ci = (v, pair, d) => (has(v) ? fmt.ms(v, d) + (pair && has(pair[0]) ? ` (${fmt.n(pair[0], d)} to ${has(pair[1]) ? fmt.n(pair[1], d) : "no upper bound"})` : "") : "-");

  function table(runs, of) {
    const rows = runs.slice().reverse().map((r) => {
      const p = M.at(r, "loosest"), x = p ? R.sums(r, p) : null, check = (r.health || {}).check, acc = (r.health || {}).accuracy;
      return {_slot: R.slot(r), _r: r, pick: R.compare.has(r) ? 0 : 1, date: R.dateText(r.created), created: r.created, model: r.model.name, hw: R.hw(r), where: R.where(r),
              engine: R.engine(r), config: R.config(r),
              rates: r.points.map((q) => `${fmt.n(q.tpot_limit)} ms: ${q.met ? fmt.n(q.rate_rps, 2) : "missed"}`).join(" · "),
              out: p ? p.output_tok_s / p.gpus : null, tpot: p ? p.p99_tpot_ms : null, tokj: p ? p.tok_per_j : null, usd: x ? x.rev : null,
              check: check ? check.verdict : null, acc: acc ? acc.accuracy : null};
    });
    const open = (_, row) => {
      const b = el("button", {type: "button", class: "linkish", text: row._r.id === S.run ? "shown below" : "open", "data-k": "open:" + row._r.id});
      b.addEventListener("click", () => { S.run = row._r.id; R.update(); document.getElementById("run").scrollIntoView({block: "start"}); });
      return b;
    };
    const tick = (_, row) => {
      const c = el("input", {type: "checkbox", checked: R.compare.has(row._r), "aria-label": `Compare the run of ${row.date}: ${row.config}, ${row.engine}, ${row.where}`, "data-k": "cmp:" + row._r.id});
      c.addEventListener("change", () => R.compare.toggle(row._r));
      return c;
    };
    return D.table([{key: "pick", label: "Compare", cell: tick, title: "Tick two to four runs to set them side by side under the table"},
      {key: "created", label: "Measured", cell: (_, row) => row.date}, {key: "model", label: "Model"}, {key: "hw", label: "GPU × N"},
      {key: "where", label: "Cluster · node"},
      {key: "engine", label: "Engine"}, {key: "config", label: "Configuration"},
      {key: "rates", label: "Req/s by target (TPOT p99)"},
      {key: "out", label: "Output tok/s per GPU", num: true, cell: (v) => fmt.n(v), title: "At the loosest met target"},
      {key: "tpot", label: "TPOT p99", num: true, cell: (v) => fmt.ms(v, 1)}, {key: "tokj", label: "Output tok/J", num: true, cell: (v) => fmt.n(v, 2)},
      {key: "usd", label: "USD per GPU-hour", num: true, cell: fmt.usd, title: "Revenue at full load, at the prices chosen under Assumptions"},
      {key: "check", label: "Check", cell: verdict}, {key: "acc", label: "Accuracy", num: true, cell: (v) => (has(v) ? fmt.n(100 * v, 1) + " %" : "-")},
      {key: "open", label: "", cell: open}], rows, {caption: (rows.length < of ? `${rows.length} of the ` : "") + `${R.count(of, "run")} of ${S.model}`});
  }

  function targets(r) {
    const rows = r.points.map((p, i) => {
      const x = p.met ? R.sums(r, p) : null, pooled = p.pooled || {};
      return {target: p.tpot_limit, met: p.met, note: p.note, rate: p.rate_rps, out: p.met ? p.output_tok_s / p.gpus : null, inn: p.met ? p.input_tok_s / p.gpus : null,
              speed: p.met ? M.speed(p, "p50") : null, tpot: p.p99_tpot_ms, tpotci: pooled.p99_tpot_ci_ms, ttft: p.p99_ttft_ms, ttftci: pooled.p99_ttft_ci_ms,
              margin: pooled.margin, requests: pooled.requests || p.requests_served, spread: (p.spread_pct || {}).output_tok_s, tokj: p.tok_per_j,
              tokens: p.met ? `${fmt.n(p.mean_input_tokens)} · ${fmt.n(p.mean_output_tokens)}` : null, usd: x ? x.rev : null, be: x ? x.be : null,
              windows: ((r.results[i] || {}).windows || []).length || p.repeats};
    });
    return D.table([
      {key: "target", label: "Target, TPOT p99", num: true, cell: (v) => `≤ ${fmt.n(v)} ms`},
      {key: "met", label: "Result", cell: (v, row) => (v ? D.tag("met", "pass") : D.tag("missed", "warn", row.note))},
      {key: "rate", label: "Req/s", num: true, cell: (v) => fmt.n(v, 2)}, {key: "out", label: "Output tok/s per GPU", num: true, cell: (v) => fmt.n(v)},
      {key: "inn", label: "Input tok/s per GPU", num: true, cell: (v) => fmt.n(v)},
      {key: "speed", label: "Tokens/s per user (p50)", num: true, cell: (v) => fmt.n(v, 1)},
      {key: "tpot", label: "TPOT p99 (95 % interval)", num: true, cell: (v, row) => ci(v, row.tpotci, 1)},
      {key: "ttft", label: "TTFT p99 (95 % interval)", num: true, cell: (v, row) => ci(v, row.ttftci, 0)},
      {key: "margin", label: "Margin", cell: (v) => (v ? D.tag(v, v === "clear" ? "pass" : "dotted", "clear: both upper bounds are within the target") : "-")},
      {key: "requests", label: "Requests", num: true, cell: (v) => fmt.n(v)}, {key: "windows", label: "Windows", num: true, cell: (v) => fmt.n(v)},
      {key: "spread", label: "Spread between windows", num: true, cell: (v) => (has(v) ? fmt.n(v, 1) + " %" : "-"), title: "Of the output tokens per second"},
      {key: "tokens", label: "Tokens per request, in · out", num: true}, {key: "tokj", label: "Output tok/J", num: true, cell: (v) => fmt.n(v, 2)},
      {key: "usd", label: "USD per GPU-hour", num: true, cell: fmt.usd}, {key: "be", label: "Break-even", num: true, cell: fmt.pct}], rows,
      {caption: "Each latency target of the run; a p99 is within 2 s for the time to first token as well"});
  }

  function curve(r) {  // every probe and window of the search, and the confirmed rates with their intervals
    const pts = (r.curve || {}).points || [], limits = r.points.map((p) => p.tpot_limit).filter(has);
    if (!pts.length) return null;
    return D.xyChart({title: "Latency against throughput: every probe of the search", sub: "TPOT p99 in ms against output tokens/s per GPU; filled: a confirmed rate, ringed: a confirmation window, faint: a search probe",
      x: {label: "Output tokens/s per GPU"}, y: {cap: 2 * Math.max(...limits)},
      series: [{name: R.config(r), slot: R.slot(r), points: pts.map((q) => ({x: q.x, y: q.failed ? null : q.y,
        kind: q.kind === "confirmed" ? "solid" : q.kind === "window" ? "hollow" : "faint", err: q.kind === "confirmed" ? q.y_ci : null,
        label: q.kind === "confirmed" ? R.slo(q.target).replace(/^.*TPOT/, "TPOT") : null,
        rows: [[fmt.ms(q.y, 1), "TPOT p99"], [fmt.ms(q.ttft), "TTFT p99"], [fmt.n(q.x), "output tokens/s per GPU"], [fmt.n(q.rate, 2), "requests/s sent"],
               [q.kind || "probe", q.failed ? `${fmt.n(q.failed)} requests failed` : "kind"]]}))}],
      refs: limits.map((l) => ({axis: "y", value: l, label: `TPOT ≤ ${fmt.n(l)} ms`, faint: true}))});
  }

  function about(r) {
    const e = r.engine, c = r.config, h = r.hardware, m = r.method, w = r.workload, hc = (r.health || {}).check, acc = (r.health || {}).accuracy, st = r.stability, pv = r.provenance;
    const flags = c.flags ? el("code", {text: c.flags.join(" ")}) : null;
    return el("div", {class: "setups"},
      block("What was served", kv([["Model", `${r.model.id}` + (r.model.max_model_len ? `, context limit ${fmt.n(r.model.max_model_len)} tokens` : "")],
        ["Precision", R.precision(r)], ["Engine", R.engine(r) + (e.build ? ` (${e.build})` : "")], ["Image", e.image], ["Digest", e.digest ? el("code", {text: e.digest}) : null],
        ["Inside the image", e.inside ? Object.entries(e.inside).map(([k, v]) => `${k} ${v}`).join(" · ") : null],
        ["Configuration", `${R.config(r)} (${c.label})` + (c.dp ? `, DP ${c.dp}` : "")], ["Flags", flags], ["Environment", c.env ? c.env.join(" ") : null], ["Patch", c.patch],
        ["Priced as", r.model.priced_as]])),
      block("Where", kv([["Hardware", `${h.gpus} × ${h.gpu}` + (h.gpus_on_node ? ` of the node's ${h.gpus_on_node}` : "")], ["Cluster", h.cluster], ["Node", h.node],
        ["Driver", h.driver],
        ["Power limit", has(h.power_limit_w) ? `${fmt.n(h.power_limit_w)} W per board` : null], ["Memory", has(h.memory_mib) ? `${fmt.n(h.memory_mib / 1024, 1)} GiB per board` : null],
        ["Power counted", r.power && r.power.scope ? r.power.scope + (r.power.gpus_seen ? ` (${r.power.gpus_seen} boards seen)` : "") : "the serving GPU boards"]]),
        r.power ? list(r.power.notes) : null),
      block("How it was measured", kv([["Requests", `${w.lengths || "-"}; ${w.prompts || "-"}; ${w.arrival || "Poisson"} arrivals`],
        ["Search", has(m.start_rps) ? `from ${fmt.n(m.start_rps, 2)} req/s ×${fmt.n(m.growth, 1)}, ${m.bisect_steps} bisections, ${fmt.n(m.search_window)} s probes` : null],
        ["Confirmation", has(m.window) ? `${m.repeats} windows of ${fmt.n(m.window)} s, at least ${fmt.n(m.min_requests)} requests, after ${fmt.n(m.warmup)} s of warm-up` : null],
        ["econ", `measured with ${r.econ.version}` + (r.econ.commit ? ` (${r.econ.commit.slice(0, 10)})` : "") + `; exported with ${r.econ.exporter.version} from its ${r.econ.exporter.source}` +
          (r.econ.exporter.source === "report.json" ? " (the measurement's own file is not in the registry yet, so its windows are not listed)" : "")]])),
      block("The node's check", hc ? kv([["Verdict", [verdict(hc.verdict), ` ${R.count(hc.gpus || 0, "GPU")} checked; ` + Object.entries(hc.status).map(([k, n]) => `${n} ${k}`).join(", ")]],
        ["System", hc.system ? [hc.system.os, hc.system.cpu, hc.system.cores ? `${hc.system.cores} cores` : null, has(hc.system.ram_gib) ? `${fmt.n(hc.system.ram_gib)} GiB` : null].filter(Boolean).join(" · ") : null]]) : null,
        hc ? list(hc.rows.filter((x) => x.status !== "INFO").map((x) => `${x.status}: ${x.check}, ${x.result}`)) : el("p", {class: "muted", text: "No check with this run."})),
      block("Stability during the run", st ? kv([["Verdict", [verdict(st.verdict), has(st.samples) ? ` ${fmt.n(st.samples)} samples` + (has(st.seconds) ? ` over ${fmt.n(st.seconds / 60)} min` : "") : ""]],
        ["From", st.from ? `${st.from} (the run predates econ's own record of it)` : null]]) : el("p", {class: "muted", text: "Not recorded for this run."}),
        st ? list(st.rows.filter((x) => x.status === "WARN" || x.status === "FAIL").map((x) => `${x.status}: ${x.check}, ${x.result}`)) : null),
      block("Accuracy", acc ? kv([["Score", `${fmt.n(100 * acc.accuracy, 1)} % on ${acc.benchmark}: ${acc.correct} of ${acc.items}` + (acc.ci95 ? ` (95 % interval ${fmt.n(100 * acc.ci95[0], 1)} to ${fmt.n(100 * acc.ci95[1], 1)} %)` : "")],
        ["How", `${acc.shots}-shot, seed ${acc.seed}` + (acc.failed ? `, ${acc.failed} requests failed` : "")]]) : el("p", {class: "muted", text: "Not scored with this run."})),
      block("What to look at", list((r.findings || []).map((f) => `${f.level}: ${f.text}`))),
      block("Not covered", list(r.not_covered)),
      block("Files", el("ul", {class: "plain files"}, r.files.map((f) => el("li", {}, `${f.name} (${f.role}, ${fmt.n(f.bytes)} bytes) `, el("code", {text: "sha256 " + f.sha256.slice(0, 16) + "…", title: f.sha256}))))),
      pv ? block("Provenance (internal)", kv([["Host", pv.host], ["Job", pv.job], ["Data folder", pv.data_dir ? el("code", {text: pv.data_dir}) : null], ["Started", pv.started],
        ["gentic commit", pv.gentic_commit], ["Command", pv.command ? el("code", {text: pv.command}) : null]])) : null);
  }

  function drawDetail(r) {
    const p = M.at(r, "loosest"), x = p ? R.sums(r, p) : null, hc = (r.health || {}).check;
    const tile = (label, value, note) => el("div", {class: "tile"}, el("div", {class: "tlabel", text: label}), el("div", {class: "tvalue", text: value}), note ? el("div", {class: "tnote", text: note}) : null);
    const save = R.button("Download the record (JSON)", "down", () => R.download(r.id + ".json", "application/json", JSON.stringify(r, null, 1) + "\n"), "text");
    const link = R.button("Copy the link to this run", "link", () => R.copy(R.linkTo("runs"), link));
    D.replace(detail,
      el("div", {class: "runhead"}, el("h3", {}, D.swatch(R.slot(r)), R.runName(r)), el("div", {class: "btnrow"}, link, save)),
      el("p", {class: "meta"}, `${r.model.id} · measured ${R.dateText(r.created)} on ${R.where(r)} · `, el("code", {text: r.id}), " ",
        D.tag(`econ ${r.econ.version}`), D.tag(r.visibility, r.visibility === "internal" ? "solid" : ""), hc ? D.tag(`check ${hc.verdict}`, hc.verdict === "PASS" ? "pass" : "warn") : null),
      p ? el("div", {class: "tiles"}, tile("Requests/s", fmt.n(p.rate_rps, 2), `within ${R.target(p)}`), tile("Output tok/s per GPU", fmt.n(p.output_tok_s / p.gpus), `${fmt.n(p.output_tok_s)} on ${R.hw(r)}`),
        tile("Tokens/s per user", fmt.n(M.speed(p, "p50"), 1), "the median request"), tile("TPOT p99", fmt.ms(p.p99_tpot_ms, 1), `limit ${fmt.n(p.tpot_limit)} ms`),
        tile("Output tok/J", fmt.n(p.tok_per_j, 2), has(p.node_power_w) ? `${fmt.n(p.node_power_w / p.gpus)} W per board` : "no power read"),
        tile("Revenue per GPU-hour", x ? fmt.usd(x.rev) : "-", x && has(x.be) ? `pays the rent from ${fmt.pct(x.be)}` : "at full load"))
        : D.notice("info", "This run met none of its targets: " + r.points.map((q) => `${R.target(q)}: ${q.note || "missed"}`).join("; ") + "."),
      targets(r), curve(r), about(r));
  }

  function drawChoices() {
    const box = el("input", {type: "search", class: "search", placeholder: "A date, node, engine, configuration…", "aria-label": "Find runs", value: S.rq, "data-k": "rq"});
    box.addEventListener("input", () => { S.rq = box.value; R.update("typing"); });
    D.replace(card.controls, D.control("Find runs", box));
  }
  function render(reason) {
    const scope = R.scope(), runs = found(scope);
    D.replace(listing, !scope.length ? el("p", {class: "muted", text: "No runs in scope."})
      : runs.length ? table(runs, scope.length) : el("p", {class: "muted", text: `None of the ${R.count(scope.length, "run")} of ${S.model} matches.`}));
    if (reason === "typing") return;  // the box is being typed in: it and the run opened stay as they are
    drawChoices();
    R.compare.draw();
    const run = scope.find((r) => r.id === S.run) || R.records.find((r) => r.id === S.run) || scope[scope.length - 1];
    if (run) drawDetail(run); else D.replace(detail);
  }
  R.views.push({id: "runs", title: "Runs", icon: "runs", root: card.root, also: ["compare"], render});
})(typeof window !== "undefined" ? window : globalThis);
