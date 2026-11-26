/* The page put together: KRAI's header with the self-check and the theme, the scope every section shares (model,
   precision, engine), the sections named in the side bar, and the foot. When it opens it recomputes every number
   econ priced in every record and says how many agree. Served locked (web/lock.js), the browser keeps the page's key:
   About says so and forgets it. */
(function (root) {
  "use strict";
  const D = root.Dash, R = root.Reg;
  if (!R) return;
  const el = D.el, S = R.S, site = R.site;
  const app = document.getElementById("app"), nav = document.getElementById("nav"), side = document.getElementById("brandside");

  // --- the theme: dark unless the viewer chose light; the choice is kept in this browser
  const KEY = "econ-results-theme", html = document.documentElement;
  const themeButton = R.button("Switch between the dark and the light theme", "theme", () => {
    html.dataset.theme = html.dataset.theme === "light" ? "dark" : "light";
    try { root.localStorage.setItem(KEY, html.dataset.theme); } catch (e) { /* the choice lasts this visit */ }
    R.update();  // a downloaded SVG and the treemap's ink follow the theme
  });

  // --- the self-check, once: econ's numbers of every record, recomputed here
  const check = R.selfCheck(), ok = !check.bad.length;
  const badge = el("button", {type: "button", class: "badge " + (ok ? "good" : "bad"),
                              title: "Every number econ priced in every record, recomputed by this page when it opened"},
    R.icon(ok ? "check" : "cross"),
    el("span", {text: !R.records.length ? "Self-check: no runs yet" : ok ? `Self-check: ${D.fmt.n(check.checked)} values agree`
      : `Self-check: ${check.bad.length} of ${D.fmt.n(check.checked)} differ`}));
  badge.addEventListener("click", () => R.goto("about"));
  side.append(badge, themeButton);

  // --- the scope: one row above everything it scopes
  const scope = el("nav", {class: "filters", "aria-label": "The model, precision and engine every section shows"});
  function drawScope() {
    const pool = R.records.filter((r) => r.model.id === S.model), uniq = (f) => Array.from(new Set(pool.map(f)));
    const all = (label, values) => [{value: "all", label}].concat(values.map((v) => ({value: v, label: v})));
    const first = R.scope()[0], price = first && R.price(first), rent = first && R.rent(first);
    const jump = el("button", {type: "button", class: "linkish", text: "change"});
    jump.addEventListener("click", () => R.goto("assumptions"));
    D.replace(scope,
      R.pick("Model", "model", R.models.map((m) => ({value: m, label: `${m} (${R.count(R.records.filter((r) => r.model.id === m).length, "run")})`}))),
      R.pick("Precision", "prec", all("Any precision", uniq(R.precision))),
      R.pick("Engine", "eng", all("Any engine", uniq(R.engine))),
      el("div", {class: "control assumed"}, el("span", {class: "clabel", text: "Priced with"}),
        el("div", {class: "crow"}, el("span", {class: "val", text: (price ? `${D.fmt.usd(price.input)} / ${D.fmt.usd(price.output)} per M` : "no price list") +
          ` · rent ${rent ? D.fmt.usd(rent) : "not set"} · ${S.u} % utilisation`}), jump)));
  }

  // --- the key a locked page left in this browser (web/lock.js keeps it under the same name)
  const LOCK = "econ-results-key";
  function keyKept() {
    try { return Boolean(root.localStorage.getItem(LOCK) || root.sessionStorage.getItem(LOCK)); } catch (e) { return false; }
  }
  const forget = R.button("Forget the key on this browser", null, () => {
    try { root.localStorage.removeItem(LOCK); root.sessionStorage.removeItem(LOCK); } catch (e) { /* nothing is kept */ }
    root.location.reload();  // served locked, the page now asks for its link again
  }, "text");

  // --- the sections, and the side bar that names them
  const about = R.section("about", "About this page", null);
  function drawAbout() {
    const v = site.vendored || {}, by = {};
    for (const r of R.records) by[r.econ.version] = (by[r.econ.version] || 0) + 1;
    const key = keyKept() ? ["This browser", ["It keeps the key of this page, so the address alone opens it here. ", forget]] : null;
    D.replace(about.body,
      D.notice(ok ? "good" : "critical", ok
        ? `This page's arithmetic gives econ's numbers: ${D.fmt.n(check.checked)} values of ${R.count(R.records.length, "record")} checked when the page opened.`
        : `This page's arithmetic differs from econ's in ${check.bad.length} of ${D.fmt.n(check.checked)} values.`, check.bad),
      el("dl", {class: "kv"}, [
        ["What it is", "The registry of econ's runs. econ measures what a serving configuration can sell within a latency target (the 99th percentile of the time to first token and of the time per output token) with the power of the GPU boards, and prices it at what providers charge for the model."],
        ["What is measured and what is arithmetic", "Throughput, latency, power and accuracy are measured, and never change here. Revenue, margins and costs are arithmetic on them with the choices under Assumptions."],
        ["Records", `${R.count(R.records.length, "run")} in the econ-run/1 format (${site.audience}); measured with econ ` +
          Object.entries(by).map(([ver, n]) => `${ver} (${n})`).join(", ") + ". Each run's record downloads from its detail under Runs."],
        ["The page", `One file that works offline: nothing is fetched. Its shell and arithmetic are econ's own, copied from econ ${v.econ || "?"} at commit ${(v.commit || "?").slice(0, 10)}; the sections are the registry's.`],
        ["Built", site.built || "-"], key,
      ].filter(Boolean).map(([k, t]) => [el("dt", {text: k}), el("dd", {}, t)])));
  }
  R.views.push({id: "about", title: "About", icon: "about", root: about.root, render: drawAbout});
  const empty = !R.records.length;  // a registry with no runs yet: the page says so, and keeps only what it can say
  if (empty) R.views.splice(0, R.views.length - 1);

  const links = new Map();
  for (const v of R.views.filter((x) => x.nav !== false)) {
    const b = el("button", {type: "button", class: "navlink", "data-k": "nav:" + v.id}, R.icon(v.icon), el("span", {text: v.title}));
    b.addEventListener("click", () => R.goto(v.id));
    links.set(v.id, b);
    nav.append(b);
  }
  nav.append(el("p", {class: "navmeta"}, el("span", {class: "tag " + (site.audience === "public" ? "" : "solid"), text: site.audience}),
    el("span", {text: ` ${R.count(R.records.length, "run")}`})));
  R.goto = function (id) {
    const target = document.getElementById(id);
    if (!target) return;
    S.at = id;
    D.writeState();
    const still = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({behavior: still ? "auto" : "smooth", block: "start"});
    mark(id);
  };
  function mark(id) {
    const known = links.has(id) ? id : "explore";
    for (const [k, b] of links) b.setAttribute("aria-current", String(k === known));
  }

  D.replace(app, empty ? D.notice("info", `No ${site.audience === "public" ? "public " : ""}runs in this registry yet. Each run appears here when its record is added.`) : scope,
    R.views.map((v) => v.root),
    el("footer", {}, el("span", {text: "© KRAI · econ results. Revenue assumes list prices and the measured rate whenever the node is in use; a real fleet sells less. "}),
      el("a", {href: "https://krai.ai", rel: "noopener", text: "krai.ai"})));

  // The control that had the focus before a redraw gets it back after: every control names itself in data-k
  const update = R.update;
  R.update = function (reason) {
    const k = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
    update(reason);
    if (!empty) drawScope();
    if (k && reason !== "typing") {
      const again = document.querySelector(`[data-k="${String(k).replace(/"/g, '\\"')}"]`);
      if (again) again.focus({preventScroll: true});
    }
  };

  // The section in view is the one the side bar marks
  if ("IntersectionObserver" in root) {
    const io = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) mark(top.target.id);
    }, {rootMargin: "-20% 0px -65% 0px"});
    for (const v of R.views) if (v.nav !== false) io.observe(v.root);
  }

  R.update();
  if (S.at && S.at !== "explore") setTimeout(() => { const t = document.getElementById(S.at); if (t) t.scrollIntoView({block: "start"}); mark(S.at); }, 0);
  else mark("explore");
})(typeof window !== "undefined" ? window : globalThis);
