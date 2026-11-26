/* A small dashboard shell: one filter row that scopes the page, sortable tables, SVG charts with a hover and keyboard
   layer, tags and notices, the view kept in the URL, light and dark. It knows nothing of the data it shows: a
   library's panels script builds its page with it (econ.js for econ). Plain DOM, no dependencies, nothing fetched;
   every label goes in as text, never as HTML. */
(function (root) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const SLOTS = 8;  // categorical colours --c1 ... --c8, given to entities in order; later entities are muted
  const HIT = 24;   // px: a mark answers the pointer this far from its centre

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "text") e.textContent = v;
      else if (k === "class") e.className = v;
      else e.setAttribute(k, v === true ? "" : String(v));
    }
    return append(e, kids);
  }

  function append(parent, kids) {
    for (const k of [kids].flat(Infinity)) if (k !== null && k !== undefined && k !== false) parent.append(k);
    return parent;
  }

  function svgEl(tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    return e;
  }

  const missing = (v) => v === null || v === undefined || !Number.isFinite(v);
  const fmt = {
    n: (v, d = 0) => (missing(v) ? "-" : v.toLocaleString("en-US", {minimumFractionDigits: d, maximumFractionDigits: d})),
    usd(v) {  // sub-dime prices keep a third digit
      if (missing(v)) return "-";
      const a = Math.abs(v);
      return (v < 0 ? "-$" : "$") + fmt.n(a, a < 0.1 ? 3 : 2);
    },
    pct: (u) => (missing(u) ? "-" : u > 1 ? "never" : fmt.n(100 * u) + " %"),
    ms: (v, d = 0) => (missing(v) ? "-" : fmt.n(v, d) + " ms"),
    tick(v, top) {  // axis ticks: in full under 10,000, compact from there
      if (top >= 10000) return Math.abs(v) >= 1000 ? +(v / 1000).toPrecision(6) + "K" : String(+v.toPrecision(6));
      return Number.isInteger(v) ? fmt.n(v) : String(+v.toPrecision(6));
    },
  };

  function ticks(hi, n = 5) {  // round values from 0 to at least hi
    if (!(hi > 0)) return [0, 1];
    const raw = hi / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw);
    const out = [];
    for (let i = 0; i <= Math.ceil(hi / step - 1e-9); i++) out.push(+(i * step).toPrecision(12));
    return out;
  }

  // The view lives in the URL's hash: a link (or a reload) opens the page as it was left.
  const state = {};
  function readState(defaults) {
    let hash;
    try { hash = new URLSearchParams(root.location.hash.slice(1)); } catch (e) { hash = new URLSearchParams(""); }
    for (const [k, d] of Object.entries(defaults)) {
      const raw = hash.get(k), num = Number(raw);
      state[k] = raw === null ? d : typeof d !== "number" ? raw : Number.isFinite(num) ? num : d;
    }
    return state;
  }
  function writeState() {
    const h = new URLSearchParams();
    for (const [k, v] of Object.entries(state)) h.set(k, String(v));
    try { root.history.replaceState(null, "", "#" + h.toString()); } catch (e) { /* refused on some file:// pages */ }
  }

  function data(id) { return JSON.parse(document.getElementById(id).textContent); }

  // --- the filter row's controls
  function control(label, ...inputs) {
    return el("div", {class: "control", role: "group", "aria-label": label},
      el("span", {class: "clabel", "aria-hidden": "true", text: label}), el("div", {class: "crow"}, inputs));
  }
  function select(name, options, value, onChange) {
    const option = (o) => el("option", {value: o.value, text: o.label, selected: String(o.value) === String(value)});
    const s = el("select", {"aria-label": name},
      options.map((o) => (o.group ? el("optgroup", {label: o.group}, o.options.map(option)) : option(o))));
    s.addEventListener("change", () => onChange(s.value));
    return s;
  }
  function number(name, value, opts, onChange) {
    const i = el("input", {type: "number", "aria-label": name, value: String(value), min: opts.min, max: opts.max,
                           step: opts.step || "any"});
    i.addEventListener("input", () => {
      const v = parseFloat(i.value);
      if (Number.isFinite(v) && !(v < opts.min) && !(v > opts.max)) onChange(v);
    });
    return i;
  }
  function slider(name, value, opts, onChange, show) {
    const out = el("output", {class: "val", text: show(value)});
    const i = el("input", {type: "range", "aria-label": name, min: opts.min, max: opts.max, step: opts.step,
                           value: String(value), disabled: opts.disabled});
    i.addEventListener("input", () => { const v = Number(i.value); out.textContent = show(v); onChange(v); });
    return [i, out];
  }
  function checks(name, options, values, onChange) {
    const box = el("div", {class: "checks", role: "group", "aria-label": name});
    for (const o of options) {
      const c = el("input", {type: "checkbox", value: o.value, checked: values.includes(o.value)});
      c.addEventListener("change", () => onChange(Array.from(box.querySelectorAll("input:checked"), (x) => x.value)));
      box.append(el("label", {class: "check"}, c, o.slot !== undefined ? swatch(o.slot) : null, el("span", {text: o.label})));
    }
    return box;
  }
  function themeControl() {
    const KEY = "dash-theme", html = document.documentElement;
    const apply = (v) => { if (v === "light" || v === "dark") html.dataset.theme = v; else delete html.dataset.theme; };
    let v = "auto";
    try { v = root.localStorage.getItem(KEY) || "auto"; } catch (e) { /* no storage: follow the system */ }
    apply(v);
    const options = [{value: "auto", label: "System"}, {value: "light", label: "Light"}, {value: "dark", label: "Dark"}];
    return control("Theme", select("Theme", options, v, (x) => {
      apply(x);
      try { root.localStorage.setItem(KEY, x); } catch (e) { /* the choice lasts this visit */ }
    }));
  }

  // --- colour keys, tags, notices, cards
  const cls = (slot) => "s" + (slot >= 1 && slot <= SLOTS ? slot : "x");
  function slots(names) {  // colour follows the entity, in the order it first appears, never its rank in a view
    return new Map(names.map((n, i) => [n, i < SLOTS ? i + 1 : 0]));
  }
  function swatch(slot) { return el("span", {class: "key " + cls(slot), "aria-hidden": "true"}); }
  function lineKey(slot, dotOnly) {  // a key that mirrors the mark: a line with its dot, or the dot alone
    const k = svgEl("svg", {class: "lk", width: dotOnly ? 10 : 18, height: 10, viewBox: dotOnly ? "0 0 10 10" : "0 0 18 10",
                            "aria-hidden": "true"});
    if (!dotOnly) k.append(svgEl("line", {x1: 1, y1: 5, x2: 17, y2: 5, class: "line " + cls(slot)}));
    k.append(svgEl("circle", {cx: dotOnly ? 5 : 9, cy: 5, r: dotOnly ? 4 : 3.5, class: "dot " + cls(slot)}));
    return k;
  }

  // Direct labels go where they touch no other: above right of the mark, else below right, above left or below left;
  // a label with no free place is left out (the tooltip and the table view still have it).
  function placeLabels(svg, items, W, H) {
    const taken = [];
    for (const it of items) {
      const w = 7 * it.text.length, h = 14;
      for (const [dx, dy, end] of [[10, -9, false], [10, 17, false], [-10, -9, true], [-10, 17, true]]) {
        const x0 = end ? it.x + dx - w : it.x + dx, y0 = it.y + dy - 11;
        if (x0 < 0 || x0 + w > W || y0 < 0 || y0 + h > H) continue;
        if (taken.some((b) => x0 < b.x1 && b.x0 < x0 + w && y0 < b.y1 && b.y0 < y0 + h)) continue;
        taken.push({x0, y0, x1: x0 + w, y1: y0 + h});
        svg.append(svgEl("text", {x: it.x + dx, y: it.y + dy, class: "dlabel halo num", "text-anchor": end ? "end" : "start"},
                         it.text));
        break;
      }
    }
  }
  function tag(text, style, title) { return el("span", {class: "tag" + (style ? " " + style : ""), title, text}); }
  function notice(kind, text, details) {
    return el("div", {class: "notice " + kind, role: kind === "critical" ? "alert" : "status"},
      el("span", {class: "icon", "aria-hidden": "true", text: {good: "✓", critical: "✕"}[kind] || "i"}),
      el("div", {}, el("span", {text}),
        details && details.length ? el("ul", {}, details.slice(0, 20).map((d) => el("li", {text: d}))) : null));
  }
  function card(id, title, lead) {
    const body = el("div", {class: "cbody"});
    return {body, root: el("section", {class: "card", id, "aria-labelledby": id + "-h"},
      el("h2", {id: id + "-h", text: title}), lead ? el("p", {class: "lead"}, lead) : null, body)};
  }
  function replace(container, ...nodes) {
    for (const f of container.querySelectorAll("figure.chart")) if (f.dispose) f.dispose();
    container.replaceChildren();
    return append(container, nodes);
  }

  // --- tables. columns: [{key, label, num, title, cell(value, row) -> text, node or a list of them}]; rows: objects,
  // a row's _slot puts its entity's colour key in the first cell. A click on a header sorts by that column. opts:
  // caption, sort and dir (the first order), wrap (long text cells wrap instead of widening the table).
  function table(columns, rows, opts = {}) {
    const wrap = el("div", {class: "tablewrap"});
    let key = opts.sort || null, dir = opts.dir || 1;
    const empty = (v) => v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v));
    function sorted() {
      if (!key) return rows;
      return rows.slice().sort((a, b) => {
        const x = a[key], y = b[key];
        if (empty(x) || empty(y)) return empty(x) === empty(y) ? 0 : empty(x) ? 1 : -1;  // blanks last either way
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
      });
    }
    function draw() {
      const head = el("tr", {}, columns.map((c) => {
        const b = el("button", {type: "button", text: c.label});
        b.addEventListener("click", () => {
          if (key === c.key) dir = -dir; else { key = c.key; dir = c.num ? -1 : 1; }
          draw();
        });
        return el("th", {scope: "col", class: c.num ? "num" : null, title: c.title,
                         "aria-sort": c.key === key ? (dir > 0 ? "ascending" : "descending") : null}, b);
      }));
      const body = sorted().map((r) => el("tr", {}, columns.map((c, i) => {
        const v = r[c.key];
        return el("td", {class: c.num ? "num" : null}, i === 0 && r._slot !== undefined ? swatch(r._slot) : null,
          c.cell ? c.cell(v, r) : empty(v) ? "-" : String(v));
      })));
      wrap.replaceChildren(el("table", {class: opts.wrap ? "wrap" : null}, opts.caption ? el("caption", {text: opts.caption}) : null,
        el("thead", {}, head), el("tbody", {}, body)));
    }
    draw();
    return wrap;
  }
  function tableToggle(label, make) {  // a chart's table view: the same values without hovering
    const box = el("div", {class: "tview", hidden: true});
    const b = el("button", {type: "button", class: "toggle", "aria-expanded": "false", text: "Show " + label});
    b.addEventListener("click", () => {
      const open = box.hidden;
      box.hidden = !open;
      b.setAttribute("aria-expanded", String(open));
      b.textContent = (open ? "Hide " : "Show ") + label;
      if (open) box.replaceChildren(make());
    });
    return el("div", {class: "tvwrap"}, b, box);
  }

  // --- the tooltip and the hover layer
  let tipBox = null;
  function showTip(title, slot, rows, x, y) {
    if (!tipBox) document.body.append(tipBox = el("div", {class: "tip", role: "tooltip"}));
    tipBox.replaceChildren();
    append(tipBox, [el("div", {class: "tt"}, slot !== undefined ? lineKey(slot) : null, el("span", {text: title})),
      rows.map(([v, l]) => el("div", {class: "trow"}, el("span", {class: "tv", text: v}), el("span", {class: "tl", text: l})))]);
    tipBox.style.display = "block";
    const r = tipBox.getBoundingClientRect(), gap = 14;
    let left = x + gap, top = y + gap;
    if (left + r.width > root.innerWidth - 8) left = Math.max(8, x - gap - r.width);
    if (top + r.height > root.innerHeight - 8) top = Math.max(8, y - gap - r.height);
    tipBox.style.left = left + "px";
    tipBox.style.top = top + "px";
  }
  function hideTip() { if (tipBox) tipBox.style.display = "none"; }

  // marks: [{x, y, title, slot, rows: [[value, label]]}] in the svg's units. The nearest within HIT px answers the
  // pointer; with the chart focused, the arrow keys walk the marks left to right and show the same tooltip.
  function hover(svg, marks) {
    const ring = svgEl("circle", {class: "focusring", r: 9, visibility: "hidden"});
    svg.append(ring);
    const order = marks.map((_, i) => i).sort((a, b) => marks[a].x - marks[b].x || marks[a].y - marks[b].y);
    let cur = -1;
    function show(i, cx, cy) {
      const m = marks[i], b = svg.getBoundingClientRect(), k = b.width / svg.viewBox.baseVal.width;
      cur = i;
      ring.setAttribute("cx", m.x);
      ring.setAttribute("cy", m.y);
      ring.setAttribute("visibility", "visible");
      showTip(m.title, m.slot, m.rows || [], cx === undefined ? b.left + m.x * k : cx, cy === undefined ? b.top + m.y * k : cy);
    }
    function hide() { cur = -1; ring.setAttribute("visibility", "hidden"); hideTip(); }
    function near(ev) {
      const b = svg.getBoundingClientRect(), k = svg.viewBox.baseVal.width / b.width;
      const px = (ev.clientX - b.left) * k, py = (ev.clientY - b.top) * k;
      let best = -1, dist = HIT * k;
      marks.forEach((m, i) => { const d = Math.hypot(m.x - px, m.y - py); if (d < dist) { dist = d; best = i; } });
      if (best < 0) hide(); else show(best, ev.clientX, ev.clientY);
    }
    svg.addEventListener("pointermove", near);
    svg.addEventListener("pointerdown", near);
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", (ev) => {
      const step = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[ev.key];
      if (step && order.length) {
        const at = order.indexOf(cur);
        show(order[at < 0 ? (step > 0 ? 0 : order.length - 1) : (at + step + order.length) % order.length]);
        ev.preventDefault();
      } else if (ev.key === "Escape") hide();
    });
  }

  // --- charts: a figure with its caption, a legend for two or more series, an optional table view; the plot is drawn
  // at the figure's width and again when that width changes
  function frame(spec, draw) {
    const host = el("div", {class: "plot"});
    const fig = el("figure", {class: "chart"},
      el("figcaption", {}, el("span", {class: "ctitle", text: spec.title}), spec.sub ? el("span", {class: "csub", text: spec.sub}) : null),
      spec.legend && spec.legend.length > 1 ? el("ul", {class: "legend"},
        spec.legend.map((s) => el("li", {}, lineKey(s.slot, spec.dots), el("span", {text: s.name})))) : null,
      host, spec.table ? tableToggle(spec.table.label, spec.table.make) : null);
    let width = 0;
    const ro = new ResizeObserver(() => {
      const w = Math.floor(host.clientWidth);
      if (w > 0 && w !== width) { width = w; host.replaceChildren(draw(w)); }
    });
    ro.observe(host);
    fig.dispose = () => ro.disconnect();
    return fig;
  }

  function plotSvg(W, H, label) {
    return svgEl("svg", {class: "viz", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", tabindex: 0,
                         "aria-label": label});
  }
  function xLabels(svg, xt, X, y, plotWidth, top) {  // every tick labelled while they fit, else every other one
    const every = Math.max(1, Math.ceil(56 * xt.length / plotWidth));
    xt.forEach((v, i) => {
      if (i % every === 0) svg.append(svgEl("text", {x: X(v), y, class: "tick num", "text-anchor": "middle"}, fmt.tick(v, top)));
    });
  }

  // spec: {title, sub, x: {label}, y: {cap}, series: [{name, slot, line: [[x, y]], points: [{x, y, kind, label, rows,
  // err}]}], refs: [{axis: "x" | "y", value, label, faint}], table}. Kinds: "faint", "hollow", "solid" (which may carry
  // a direct label); err: [low, high] drawn as a whisker; a point above y.cap, or with no y (failed requests), is a
  // triangle on the top line.
  function xyChart(spec) {
    return frame(Object.assign({legend: spec.series}, spec), (W) => {
      const H = Math.round(Math.min(380, Math.max(240, W * 0.6))), m = {l: 52, r: 16, t: 14, b: 44};
      const cap = spec.y && spec.y.cap ? spec.y.cap : Infinity, refs = spec.refs || [];
      const all = [];
      for (const s of spec.series) for (const p of s.points) all.push({s, p, over: missing(p.y) || p.y > cap});
      const kind = (a) => (a.over ? "over" : a.p.kind || "faint");
      let top = Math.max(0, ...all.filter((a) => !a.over).map((a) => a.p.y),
                         ...refs.filter((r) => r.axis === "y").map((r) => r.value)) * 1.08;
      if (all.some((a) => a.over) && Number.isFinite(cap)) top = Math.max(top, cap);
      const yt = ticks(top), ytop = yt[yt.length - 1];
      const xt = ticks(Math.max(0, ...all.map((a) => a.p.x), ...refs.filter((r) => r.axis === "x").map((r) => r.value)) * 1.05);
      const xtop = xt[xt.length - 1], pw = W - m.l - m.r;
      const X = (v) => m.l + pw * v / xtop, Y = (v) => m.t + (H - m.t - m.b) * (1 - Math.min(v, ytop) / ytop);
      const svg = plotSvg(W, H, spec.title);
      for (const v of yt) {
        svg.append(svgEl("line", {x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: "gl"}),
                   svgEl("text", {x: m.l - 8, y: Y(v) + 4, class: "tick num", "text-anchor": "end"}, fmt.tick(v, ytop)));
      }
      xLabels(svg, xt, X, H - m.b + 18, pw, xtop);
      svg.append(svgEl("line", {x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: "axisl"}),
                 svgEl("text", {x: m.l + pw / 2, y: H - 8, class: "tick", "text-anchor": "middle"}, spec.x.label));
      const refLabels = [];  // drawn after the marks, so a mark never hides the line's name
      for (const r of refs) {
        const c = "ref" + (r.faint ? " faint" : "");
        if (r.axis === "y") {
          svg.append(svgEl("line", {x1: m.l, x2: W - m.r, y1: Y(r.value), y2: Y(r.value), class: c}));
          refLabels.push(svgEl("text", {x: W - m.r - 4, y: Y(r.value) - 5, class: "reflabel halo", "text-anchor": "end"}, r.label));
        } else {
          svg.append(svgEl("line", {x1: X(r.value), x2: X(r.value), y1: m.t, y2: H - m.b, class: c}));
          refLabels.push(svgEl("text", {x: X(r.value) + 4, y: m.t + 10, class: "reflabel halo"}, r.label));
        }
      }
      for (const s of spec.series) {
        if (s.line && s.line.length > 1) {
          svg.append(svgEl("polyline", {class: "line " + cls(s.slot),
            points: s.line.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(" ")}));
        }
      }
      const layer = {faint: 0, hollow: 1, over: 2, solid: 3}, marks = [];
      all.sort((a, b) => layer[kind(a)] - layer[kind(b)]);  // the confirmed points last, on top
      for (const a of all) {
        const x = X(a.p.x), y = a.over ? Y(ytop) : Y(a.p.y), c = cls(a.s.slot), k = kind(a);
        if (!a.over && a.p.err) {  // its interval: a whisker, up to the top line when it has no upper bound
          const lo = Y(a.p.err[0]), hi = missing(a.p.err[1]) ? Y(ytop) : Y(a.p.err[1]);
          svg.append(svgEl("line", {x1: x, x2: x, y1: lo, y2: hi, class: "err " + c}));
          for (const yy of missing(a.p.err[1]) ? [lo] : [lo, hi]) {
            svg.append(svgEl("line", {x1: x - 4, x2: x + 4, y1: yy, y2: yy, class: "err " + c}));
          }
        }
        if (k === "over") svg.append(svgEl("path", {class: "over " + c, d: `M${x.toFixed(1)},${(y - 6).toFixed(1)}l5.5,9.5h-11z`}));
        else svg.append(svgEl("circle", {cx: x.toFixed(1), cy: y.toFixed(1), r: k === "solid" ? 6 : 4.5,
                                         class: {faint: "dot faint ", hollow: "hollow ", solid: "dot "}[k] + c}));
        marks.push({x, y, title: a.s.name, slot: a.s.slot, rows: a.p.rows, label: a.over ? null : a.p.label});
      }
      svg.append(...refLabels);
      placeLabels(svg, marks.filter((mk) => mk.label).map((mk) => ({x: mk.x, y: mk.y, text: mk.label})), W - m.r, H);
      hover(svg, marks);
      return svg;
    });
  }

  // spec: {title, sub, legend, x: {label}, rows: [{label, slot, band: [lo, hi], dots: [{x, title, rows}],
  // mark: {x, label, title, rows}}], refs: [{value, label, faint}], table}: a row of dots per entity on one x axis,
  // its band a thin range under the dots, its mark the value labelled.
  function dotRows(spec) {
    return frame(Object.assign({dots: true}, spec), (W) => {
      const rowH = 34, m = {t: 40, r: 16, b: 44};
      const lw = Math.min(Math.max(4, ...spec.rows.map((r) => r.label.length)) * 6.6 + 8, W * 0.42);
      m.l = lw + 16;
      const H = m.t + rowH * spec.rows.length + m.b, base = H - m.b, refs = spec.refs || [];
      const vals = refs.map((r) => r.value);
      for (const r of spec.rows) vals.push(...r.dots.map((d) => d.x), ...(r.band || []), ...(r.mark ? [r.mark.x] : []));
      const xt = ticks(Math.max(0, ...vals.filter(Number.isFinite)) * 1.06), xtop = xt[xt.length - 1], pw = W - m.l - m.r;
      const X = (v) => m.l + pw * Math.max(0, v) / xtop;
      const svg = plotSvg(W, H, spec.title);
      for (const v of xt) svg.append(svgEl("line", {x1: X(v), x2: X(v), y1: m.t - 6, y2: base, class: "gl"}));
      xLabels(svg, xt, X, base + 18, pw, xtop);
      svg.append(svgEl("line", {x1: m.l, x2: m.l, y1: m.t - 6, y2: base, class: "axisl"}),
                 svgEl("text", {x: m.l + pw / 2, y: H - 8, class: "tick", "text-anchor": "middle"}, spec.x.label));
      refs.slice().sort((a, b) => a.value - b.value).forEach((r, i) => {  // labels on two rows, so close ones never touch
        const x = X(r.value), y = m.t - 14 - (i % 2) * 14, end = x + 8 + 7 * r.label.length > W - m.r;
        svg.append(svgEl("line", {x1: x, x2: x, y1: y + 4, y2: base, class: "ref" + (r.faint ? " faint" : "")}),
                   svgEl("text", {x: end ? x - 4 : x + 4, y, class: "reflabel halo num", "text-anchor": end ? "end" : "start"}, r.label));
      });
      const marks = [], fit = Math.max(4, Math.floor(lw / 6.6));
      spec.rows.forEach((r, i) => {
        const cy = m.t + i * rowH + rowH / 2 - 3, c = cls(r.slot);
        const short = r.label.length > fit ? r.label.slice(0, fit - 1) + "…" : r.label;
        const t = svgEl("text", {x: m.l - 12, y: cy + 4, class: "rlabel", "text-anchor": "end"}, short);
        if (short !== r.label) t.append(svgEl("title", {}, r.label));
        svg.append(t);
        if (r.band) svg.append(svgEl("line", {x1: X(r.band[0]), x2: X(r.band[1]), y1: cy + 11, y2: cy + 11, class: "band"}));
        for (const d of r.dots) {
          svg.append(svgEl("circle", {cx: X(d.x), cy, r: 4, class: "dot faint " + c}));
          marks.push({x: X(d.x), y: cy, title: d.title, slot: r.slot, rows: d.rows});
        }
        if (r.mark) {
          const x = X(r.mark.x), end = x + 12 + 7 * r.mark.label.length > W - m.r;
          svg.append(svgEl("circle", {cx: x, cy, r: 6, class: "dot " + c}),
                     svgEl("text", {x: end ? x - 10 : x + 10, y: cy - 7, class: "dlabel halo num",
                                    "text-anchor": end ? "end" : "start"}, r.mark.label));
          marks.push({x, y: cy, title: r.mark.title, slot: r.slot, rows: r.mark.rows});
        }
      });
      hover(svg, marks);
      return svg;
    });
  }

  root.Dash = {el, svgEl, append, fmt, ticks, state, readState, writeState, data, control, select, number, slider,
               checks, themeControl, slots, swatch, tag, notice, card, replace, table, tableToggle, xyChart, dotRows};
})(window);
