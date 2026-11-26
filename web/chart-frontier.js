/* The frontier chart: one curve per run through its met targets, a value against the speed one user gets. On top of
   the marks it draws each point's intervals, names each curve on the curve and each point by its target, and follows
   the pointer with a vertical cursor that reads every curve at the same speed. It zooms (Shift + wheel, or + and -),
   pans (drag) and resets (double click, or 0). */
(function (root) {
  "use strict";
  const D = root.Dash, R = root.Reg, M = root.RegMath;
  if (!R) return;
  const C = R.charts, svgEl = D.svgEl, fmt = D.fmt, has = M.has;
  const tick = (v, top) => (top >= 10 ? fmt.tick(v, top) : String(+v.toPrecision(3)));

  // spec: {title, sub, legend, x: {label, show}, y: {log, lower}, bars, tags, zoom: {} kept by the caller,
  //        series: [{name, label, slot, faded, points: [{x, y, tag, rows, xerr: [lo, hi], yerr: [lo, hi], pick}]}],
  //        onCursor(speed or null)}
  C.frontier = function (spec) {
    const z = spec.zoom;
    let geo = null, pinned = null, drag = null;
    const fig = C.frame(spec, draw);

    function domain() {
      const pts = spec.series.flatMap((s) => s.points), err = (p, k) => (spec.bars && p[k] ? p[k].filter(has) : []);
      const xs = pts.flatMap((p) => [p.x].concat(err(p, "xerr"))), ys = pts.flatMap((p) => [p.y].concat(err(p, "yerr")));
      const xmax = Math.max(1, ...xs), ymax = Math.max(1e-9, ...ys), ymin = Math.min(ymax, ...ys.filter((v) => v > 0));
      const auto = spec.y.log ? [ymin / 1.4, ymax * 1.4] : [0, ymax * 1.12];
      return {x0: has(z.x0) ? z.x0 : 0, x1: has(z.x1) ? z.x1 : xmax * 1.08,
              y0: has(z.y0) ? (spec.y.log ? Math.max(z.y0, 1e-12) : z.y0) : auto[0], y1: has(z.y1) ? z.y1 : auto[1]};
    }

    function draw(W) {
      const H = Math.round(Math.min(480, Math.max(300, W * 0.6))), m = {l: 58, r: 18, t: 16, b: 46};
      const d = domain(), pw = W - m.l - m.r, ph = H - m.t - m.b, log = !!spec.y.log;
      const X = (v) => m.l + pw * (v - d.x0) / (d.x1 - d.x0);
      const Y = log ? (v) => m.t + ph * (1 - Math.log(Math.max(v, 1e-300) / d.y0) / Math.log(d.y1 / d.y0))
        : (v) => m.t + ph * (1 - (v - d.y0) / (d.y1 - d.y0));
      const svg = C.svg(W, H, spec.title + (spec.sub ? ". " + spec.sub : ""));
      const id = "clip" + Math.random().toString(36).slice(2), clip = svgEl("clipPath", {id});
      clip.append(svgEl("rect", {x: m.l, y: m.t - 8, width: pw, height: ph + 16}));
      svg.append(clip);
      const yt = log ? M.logTicks(d.y0, d.y1) : M.niceTicks(d.y0, d.y1, 5);
      for (const v of yt) {
        svg.append(svgEl("line", {x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: "gl"}),
                   svgEl("text", {x: m.l - 8, y: Y(v) + 4, class: "tick num", "text-anchor": "end"}, tick(v, d.y1)));
      }
      for (const v of M.niceTicks(d.x0, d.x1, Math.max(3, Math.floor(pw / 90)))) {
        svg.append(svgEl("text", {x: X(v), y: H - m.b + 18, class: "tick num", "text-anchor": "middle"}, tick(v, d.x1)));
      }
      svg.append(svgEl("line", {x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: "axisl"}),
                 svgEl("text", {x: m.l + pw / 2, y: H - 8, class: "tick", "text-anchor": "middle"}, spec.x.label));
      const g = svgEl("g", {"clip-path": `url(#${id})`});
      svg.append(g);
      for (const s of spec.series) {  // the curve: neighbours too far apart in speed get a faint line, not a curve
        const pts = s.points.slice().sort((a, b) => a.x - b.x), c = C.cls(s.slot) + (s.faded ? " old" : "");
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i], b = pts[i + 1], far = b.x > a.x * M.SPEED_SPAN;
          g.append(svgEl("line", {x1: X(a.x), y1: Y(a.y), x2: X(b.x), y2: Y(b.y), class: `line ${c}${far ? " far" : ""}`}));
        }
      }
      const marks = [];
      for (const s of spec.series) {
        const c = C.cls(s.slot);
        for (const p of s.points) {
          const x = X(p.x), y = Y(p.y);
          if (spec.bars) whiskers(g, p, x, y, X, Y, c);
          g.append(svgEl("circle", {cx: x.toFixed(1), cy: y.toFixed(1), r: s.faded ? 4.5 : 5.5, class: (s.faded ? "hollow " : "dot ") + c}));
          if (x >= m.l && x <= W - m.r && y >= m.t - 8 && y <= H - m.b + 8) marks.push({x, y, title: s.name, slot: s.slot, rows: p.rows, pick: p.pick, tag: p.tag, at: p.x});
        }
      }
      const cursor = svgEl("line", {class: "cursor", y1: m.t, y2: H - m.b, visibility: "hidden"});
      const ctext = svgEl("text", {class: "reflabel halo num", y: m.t + 11, visibility: "hidden"});
      svg.append(cursor, ctext);
      const names = spec.series.filter((s) => s.points.length).map((s) => {  // each curve's name at its best point
        const top = s.points.reduce((a, b) => ((spec.y.lower ? b.y < a.y : b.y > a.y) ? b : a));
        return {x: X(top.x), y: Y(top.y), text: s.label || s.name};
      }).filter((n) => n.x >= m.l && n.x <= W - m.r && n.y >= m.t && n.y <= H - m.b);
      const taken = C.labels(svg, names, W - 4, H - m.b, marks.map((k) => ({x0: k.x - 7, x1: k.x + 7, y0: k.y - 7, y1: k.y + 7})));
      if (spec.tags) C.labels(svg, marks.filter((k) => k.tag).map((k) => ({x: k.x, y: k.y, text: k.tag, cls: "tlabel"})), W - 4, H - m.b, taken);
      geo = {W, H, m, d, pw, ph, X, log, svg, cursor, ctext, marks, layer: C.marks(svg, marks),
             xAt: (px) => d.x0 + (px - m.l) / pw * (d.x1 - d.x0)};
      if (pinned !== null) place(pinned);
      return svg;
    }

    function whiskers(g, p, x, y, X, Y, c) {  // a point's intervals: across for its speed, upright for its value
      const bar = (x1, y1, x2, y2) => g.append(svgEl("line", {x1, y1, x2, y2, class: "err " + c}));
      if (p.yerr && has(p.yerr[0]) && has(p.yerr[1])) {
        bar(x, Y(p.yerr[0]), x, Y(p.yerr[1]));
        for (const v of p.yerr) bar(x - 4, Y(v), x + 4, Y(v));
      }
      if (p.xerr && has(p.xerr[0]) && has(p.xerr[1])) {
        bar(X(p.xerr[0]), y, X(p.xerr[1]), y);
        for (const v of p.xerr) bar(X(v), y - 4, X(v), y + 4);
      }
    }

    // --- the cursor: a vertical line at a speed per user; a click pins it there
    function place(speed) {
      const on = speed >= geo.d.x0 && speed <= geo.d.x1, x = geo.X(speed), end = x > geo.W - geo.m.r - 90;
      for (const node of [geo.cursor, geo.ctext]) node.setAttribute("visibility", on ? "visible" : "hidden");
      geo.cursor.setAttribute("x1", x);
      geo.cursor.setAttribute("x2", x);
      geo.ctext.setAttribute("x", end ? x - 5 : x + 5);
      geo.ctext.setAttribute("text-anchor", end ? "end" : "start");
      geo.ctext.textContent = spec.x.show(speed) + (pinned !== null ? " (pinned)" : "");
    }
    function leave() {
      if (!geo || pinned !== null) return;
      for (const node of [geo.cursor, geo.ctext]) node.setAttribute("visibility", "hidden");
      if (spec.onCursor) spec.onCursor(null);
    }
    const local = (ev) => { const b = geo.svg.getBoundingClientRect(), k = geo.W / b.width; return [(ev.clientX - b.left) * k, (ev.clientY - b.top) * k]; };
    const inside = (px, py) => px >= geo.m.l && px <= geo.W - geo.m.r && py >= geo.m.t && py <= geo.H - geo.m.b;

    // --- zoom and pan: the caller's zoom object holds the window, so a redraw of the page keeps it
    function zoomAt(px, py, f) {
      const d = geo.d, cx = geo.xAt(px), ty = 1 - (py - geo.m.t) / geo.ph;
      z.x0 = Math.max(0, cx - (cx - d.x0) * f);
      z.x1 = cx + (d.x1 - cx) * f;
      if (geo.log) {
        const span = Math.log(d.y1 / d.y0), cy = Math.log(d.y0) + ty * span;
        z.y0 = Math.exp(cy - ty * span * f);
        z.y1 = Math.exp(cy + (1 - ty) * span * f);
      } else {
        const cy = d.y0 + ty * (d.y1 - d.y0);
        z.y0 = Math.max(0, cy - (cy - d.y0) * f);
        z.y1 = cy + (d.y1 - cy) * f;
      }
      fig.redraw();
    }
    fig.zoomBy = (f) => { if (geo) zoomAt(geo.m.l + geo.pw / 2, geo.m.t + geo.ph / 2, f); };
    fig.resetZoom = () => { for (const k of ["x0", "x1", "y0", "y1"]) delete z[k]; fig.redraw(); };

    const host = fig.host;
    host.addEventListener("pointermove", (ev) => {
      if (!geo) return;
      const [px, py] = local(ev);
      if (drag) {
        const dx = (px - drag.px) / geo.pw, dy = (py - drag.py) / geo.ph, d = drag.d;
        if (Math.abs(px - drag.px) + Math.abs(py - drag.py) < 5 && !drag.moved) return;
        drag.moved = true;
        const sx = Math.min(dx * (d.x1 - d.x0), d.x0);  // never left of zero
        z.x0 = d.x0 - sx;
        z.x1 = d.x1 - sx;
        if (geo.log) { const k = Math.pow(d.y1 / d.y0, dy); z.y0 = d.y0 * k; z.y1 = d.y1 * k; }
        else { const sy = Math.max(dy * (d.y1 - d.y0), -d.y0); z.y0 = d.y0 + sy; z.y1 = d.y1 + sy; }
        C.hideTip();
        fig.redraw();
      } else if (pinned === null) {
        if (!inside(px, py)) { leave(); return; }
        const on = geo.layer.nearest(ev), speed = on >= 0 ? geo.marks[on].at : geo.xAt(px);  // on a point: exactly its speed
        place(speed);
        if (spec.onCursor) spec.onCursor(speed);
      }
    });
    host.addEventListener("pointerleave", () => { drag = null; leave(); });
    host.addEventListener("pointerdown", (ev) => {
      if (!geo || ev.button !== 0) return;
      const [px, py] = local(ev);
      if (inside(px, py)) drag = {px, py, d: Object.assign({}, geo.d), moved: false};
    });
    host.addEventListener("pointerup", (ev) => {
      if (!drag || !geo) return;
      const moved = drag.moved;
      drag = null;
      if (moved || geo.layer.nearest(ev) >= 0) return;  // a pan, or a click on a point (the point answers it)
      const [px, py] = local(ev);
      if (!inside(px, py)) return;
      pinned = pinned === null ? geo.xAt(px) : null;
      place(pinned === null ? geo.xAt(px) : pinned);
      if (spec.onCursor) spec.onCursor(pinned === null ? geo.xAt(px) : pinned);
    });
    host.addEventListener("wheel", (ev) => {
      if (!geo || !(ev.shiftKey || ev.ctrlKey)) return;
      ev.preventDefault();
      const [px, py] = local(ev);
      zoomAt(px, py, (ev.deltaY || ev.deltaX) < 0 ? 0.8 : 1.25);
    }, {passive: false});
    host.addEventListener("dblclick", () => fig.resetZoom());
    host.addEventListener("keydown", (ev) => {
      if (ev.key === "+" || ev.key === "=") fig.zoomBy(0.8);
      else if (ev.key === "-") fig.zoomBy(1.25);
      else if (ev.key === "0") fig.resetZoom();
    });
    return fig;
  };
})(typeof window !== "undefined" ? window : globalThis);
