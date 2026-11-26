/* What the registry's own charts share: a figure that redraws at its width, a legend that mirrors the marks, a tooltip,
   a layer that answers the pointer and the keyboard from the nearest mark, labels that never overlap, and a chart as
   an SVG file. econ's shell draws its own charts with pieces like these, but keeps them to itself, so the registry
   has its own. */
(function (root) {
  "use strict";
  const D = root.Dash, R = root.Reg;
  if (!R) return;
  const el = D.el, svgEl = D.svgEl, C = R.charts = {};
  const HIT = 24;  // px: a mark answers the pointer this far from its centre
  C.cls = (slot) => "s" + (slot >= 1 && slot <= 8 ? slot : "x");

  let box = null;
  C.tip = function (title, slot, rows, x, y) {
    if (!box) document.body.append(box = el("div", {class: "tip", role: "tooltip"}));
    box.replaceChildren(el("div", {class: "tt"}, slot !== undefined && slot !== null ? C.key(slot, "line") : null, el("span", {text: title})),
      ...rows.filter(Boolean).map(([v, l]) => el("div", {class: "trow"}, el("span", {class: "tv", text: v}), el("span", {class: "tl", text: l}))));
    box.style.display = "block";
    const r = box.getBoundingClientRect(), gap = 14;
    box.style.left = (x + gap + r.width > root.innerWidth - 8 ? Math.max(8, x - gap - r.width) : x + gap) + "px";
    box.style.top = (y + gap + r.height > root.innerHeight - 8 ? Math.max(8, y - gap - r.height) : y + gap) + "px";
  };
  C.hideTip = () => { if (box) box.style.display = "none"; };

  // A legend key that mirrors its mark: a line with its dot, a dot alone, or a block
  C.key = function (slot, kind, cls) {
    const c = cls || C.cls(slot), k = svgEl("svg", {class: "lk", width: kind === "line" ? 18 : 10, height: 10,
                                                    viewBox: kind === "line" ? "0 0 18 10" : "0 0 10 10", "aria-hidden": "true"});
    if (kind === "block") k.append(svgEl("rect", {x: 0, y: 0, width: 10, height: 10, rx: 2, class: c}));
    else {
      if (kind === "line") k.append(svgEl("line", {x1: 1, y1: 5, x2: 17, y2: 5, class: "line " + c}));
      k.append(svgEl("circle", {cx: kind === "line" ? 9 : 5, cy: 5, r: 3.5, class: "dot " + c}));
    }
    return k;
  };
  C.legend = (items, kind) => (items.length > 1 ? el("ul", {class: "legend"},
    items.map((s) => el("li", {}, C.key(s.slot, s.kind || kind, s.cls), el("span", {text: s.name})))) : null);

  // A figure: its caption, a legend for two or more series, and a plot drawn at the figure's width and again when
  // that width changes. draw(width) returns the svg. fig.redraw() draws it again; fig.host is the plot's box.
  C.frame = function (spec, draw) {
    const host = el("div", {class: "plot"});
    const fig = el("figure", {class: "chart"},
      el("figcaption", {}, el("span", {class: "ctitle", text: spec.title}), spec.sub ? el("span", {class: "csub", text: spec.sub}) : null),
      spec.legend ? C.legend(spec.legend, spec.keys || "line") : null, host);
    let width = 0;
    fig.redraw = () => { if (width > 0) host.replaceChildren(draw(width)); };
    const ro = new ResizeObserver(() => {
      const w = Math.floor(host.clientWidth);
      if (w > 0 && w !== width) { width = w; fig.redraw(); }
    });
    ro.observe(host);
    fig.dispose = () => ro.disconnect();
    fig.host = host;
    return fig;
  };
  C.svg = (W, H, label) => svgEl("svg", {class: "viz", width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", tabindex: 0,
                                         "aria-label": label});

  // Labels go where they touch nothing placed before them: right or left of their mark, above or below; one with no
  // free place is left out (the legend, the tooltip and the table still have it). items: [{x, y, text, cls, places}];
  // places: [[dx, dy, end: true | false | null for centred]] instead of the usual six.
  const PLACES = [[9, -8, false], [9, 16, false], [-9, -8, true], [-9, 16, true], [0, -14, null], [0, 24, null]];
  C.labels = function (svg, items, W, H, taken = []) {
    for (const it of items) {
      const w = 6.6 * it.text.length + 4, h = 14;
      for (const [dx, dy, end] of it.places || PLACES) {
        const x0 = end === null ? it.x - w / 2 : end ? it.x + dx - w : it.x + dx, y0 = it.y + dy - 11;
        if (x0 < 0 || x0 + w > W || y0 < 0 || y0 + h > H) continue;
        if (taken.some((b) => x0 < b.x1 && b.x0 < x0 + w && y0 < b.y1 && b.y0 < y0 + h)) continue;
        taken.push({x0, y0, x1: x0 + w, y1: y0 + h});
        svg.append(svgEl("text", {x: it.x + dx, y: it.y + dy, class: (it.cls || "dlabel") + " halo",
                                  "text-anchor": end === null ? "middle" : end ? "end" : "start"}, it.text));
        break;
      }
    }
    return taken;
  };

  // The hover and keyboard layer of a chart whose marks are points: the nearest mark within HIT px answers the
  // pointer, the arrow keys walk the marks, Enter picks one. marks: [{x, y, title, slot, rows, pick, box: [x0, y0,
  // x1, y1]}]; a mark with a box (a bar, a tile) answers the pointer anywhere inside it.
  C.marks = function (svg, marks) {
    const ring = svgEl("circle", {class: "focusring", r: 9, visibility: "hidden"});
    svg.append(ring);
    const order = marks.map((_, i) => i).sort((a, b) => marks[a].x - marks[b].x || marks[a].y - marks[b].y);
    let cur = -1;
    const scale = () => svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    function show(i, cx, cy) {
      const m = marks[i], b = svg.getBoundingClientRect(), k = scale();
      cur = i;
      ring.setAttribute("cx", m.x);
      ring.setAttribute("cy", m.y);
      ring.setAttribute("visibility", "visible");
      C.tip(m.title, m.slot, m.rows || [], cx === undefined ? b.left + m.x * k : cx, cy === undefined ? b.top + m.y * k : cy);
    }
    function hide() { cur = -1; ring.setAttribute("visibility", "hidden"); C.hideTip(); }
    function nearest(ev) {
      const b = svg.getBoundingClientRect(), k = 1 / scale(), px = (ev.clientX - b.left) * k, py = (ev.clientY - b.top) * k;
      let best = -1, dist = HIT * k;
      marks.forEach((m, i) => {  // a mark with a box answers anywhere inside it
        const inBox = m.box && px >= m.box[0] && px <= m.box[2] && py >= m.box[1] && py <= m.box[3];
        const d = inBox ? -1 : Math.hypot(m.x - px, m.y - py);
        if (d < dist) { dist = d; best = i; }
      });
      return best;
    }
    svg.addEventListener("pointermove", (ev) => { const i = nearest(ev); if (i < 0) hide(); else show(i, ev.clientX, ev.clientY); });
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("blur", hide);
    svg.addEventListener("click", (ev) => { const i = nearest(ev); if (i >= 0 && marks[i].pick) marks[i].pick(); });
    svg.addEventListener("keydown", (ev) => {
      const step = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[ev.key];
      if (step && order.length) {
        const at = order.indexOf(cur);
        show(order[at < 0 ? (step > 0 ? 0 : order.length - 1) : (at + step + order.length) % order.length]);
        ev.preventDefault();
      } else if (ev.key === "Enter" && cur >= 0 && marks[cur].pick) marks[cur].pick();
      else if (ev.key === "Escape") hide();
    });
    return {nearest, show, hide};
  };

  // A drawn chart as an SVG file that looks the same outside the page: each element carries the styles it has here
  C.svgText = function (svg) {
    const copy = svg.cloneNode(true), from = svg.querySelectorAll("*"), to = copy.querySelectorAll("*");
    const props = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity",
                   "font-family", "font-size", "font-weight", "text-anchor", "paint-order", "visibility"];
    from.forEach((node, i) => {
      const cs = getComputedStyle(node);
      to[i].setAttribute("style", props.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";"));
      to[i].removeAttribute("class");
    });
    for (const node of copy.querySelectorAll("[visibility=hidden]")) node.remove();
    const bg = svgEl("rect", {x: 0, y: 0, width: "100%", height: "100%",
                              fill: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim()});
    copy.insertBefore(bg, copy.firstChild);
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    copy.removeAttribute("class");
    copy.removeAttribute("tabindex");
    return new XMLSerializer().serializeToString(copy);
  };
})(typeof window !== "undefined" ? window : globalThis);
