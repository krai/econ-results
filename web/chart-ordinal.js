/* A chart over ordered categories (run dates): thin bars side by side, or lines through the categories. One y axis,
   linear from zero or logarithmic. Every mark answers the pointer and the keyboard; a bar answers anywhere on it. */
(function (root) {
  "use strict";
  const D = root.Dash, R = root.Reg, M = root.RegMath;
  if (!R) return;
  const C = R.charts, svgEl = D.svgEl, fmt = D.fmt, has = M.has;
  const tick = (v, top) => (top >= 10 ? fmt.tick(v, top) : String(+v.toPrecision(3)));

  // spec: {title, sub, legend, keys, mode: "bars" | "lines", log, show(value), categories: [{label, sub}],
  //        series: [{name, slot, cls, values: [number or null], rows: [tooltip rows], picks: [function]}]}
  C.ordinal = function (spec) {
    return C.frame(spec, (W) => {
      const two = spec.categories.some((c) => c.sub), m = {l: 56, r: 16, t: 18, b: two ? 52 : 36};
      const H = Math.round(Math.min(360, Math.max(230, W * 0.42))), pw = W - m.l - m.r, ph = H - m.t - m.b;
      const all = spec.series.flatMap((s) => s.values.filter(has)), top = Math.max(1e-9, ...all);
      const low = spec.log ? Math.min(top, ...all.filter((v) => v > 0)) / 1.6 : 0, high = top * (spec.log ? 1.4 : 1.12);
      const Y = spec.log ? (v) => m.t + ph * (1 - Math.log(Math.max(v, low) / low) / Math.log(high / low))
        : (v) => m.t + ph * (1 - v / high);
      const n = spec.categories.length, band = pw / Math.max(1, n), centre = (i) => m.l + band * (i + 0.5);
      const svg = C.svg(W, H, spec.title + (spec.sub ? ". " + spec.sub : ""));
      for (const v of spec.log ? M.logTicks(low, high) : M.niceTicks(0, high, 4)) {
        svg.append(svgEl("line", {x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: "gl"}),
                   svgEl("text", {x: m.l - 8, y: Y(v) + 4, class: "tick num", "text-anchor": "end"}, tick(v, high)));
      }
      svg.append(svgEl("line", {x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: "axisl"}));
      const fit = Math.max(3, Math.floor(band / 6.4));
      spec.categories.forEach((c, i) => {
        const cut = (t) => (t.length > fit ? t.slice(0, fit - 1) + "…" : t);
        svg.append(svgEl("text", {x: centre(i), y: H - m.b + 17, class: "rlabel", "text-anchor": "middle"}, cut(c.label)));
        if (c.sub) svg.append(svgEl("text", {x: centre(i), y: H - m.b + 33, class: "tick", "text-anchor": "middle"}, cut(c.sub)));
      });
      const marks = [], ends = [];
      if (spec.mode === "lines") {
        for (const s of spec.series) {
          const c = s.cls || C.cls(s.slot), pts = s.values.map((v, i) => (has(v) ? [centre(i), Y(v), i] : null)).filter(Boolean);
          if (pts.length > 1) svg.append(svgEl("polyline", {class: "line " + c, points: pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}));
          for (const [x, y, i] of pts) {
            svg.append(svgEl("circle", {cx: x, cy: y, r: 4.5, class: "dot " + c}));
            marks.push({x, y, title: `${s.name} · ${spec.categories[i].label}`, slot: s.slot, rows: s.rows[i], pick: s.picks && s.picks[i]});
          }
          if (pts.length) ends.push({x: pts[pts.length - 1][0], y: pts[pts.length - 1][1], text: spec.show(s.values[pts[pts.length - 1][2]])});
        }
      } else {
        spec.categories.forEach((_, i) => {  // the bars of one date, side by side around its centre, at most 24 px thick
          const here = spec.series.filter((s) => has(s.values[i])), k = here.length;
          const bw = Math.min(24, Math.max(4, (band * 0.78 - 2 * (k - 1)) / Math.max(1, k))), x0 = centre(i) - (k * bw + (k - 1) * 2) / 2;
          here.forEach((s, j) => {
            const x = x0 + j * (bw + 2), y = Y(s.values[i]), base = H - m.b, r = Math.min(4, bw / 2, Math.max(0, base - y));
            svg.append(svgEl("path", {class: "bar " + (s.cls || C.cls(s.slot)),
              d: `M${x.toFixed(1)},${base}V${(y + r).toFixed(1)}q0,${-r} ${r},${-r}h${(bw - 2 * r).toFixed(1)}q${r},0 ${r},${r}V${base}z`}));
            marks.push({x: x + bw / 2, y, box: [x - 1, y, x + bw + 1, base], title: `${s.name} · ${spec.categories[i].label}`, slot: s.slot,
                        rows: s.rows[i], pick: s.picks && s.picks[i]});
            ends.push({x: x + bw / 2, y: y - 5, text: spec.show(s.values[i]), places: [[0, 0, null]]});
          });
        });
      }
      if (ends.length <= 12) {  // a value on the marks only while they are few, and only where it touches no other
        C.labels(svg, ends, W - 2, H - m.b, spec.mode === "lines" ? marks.map((k) => ({x0: k.x - 5, x1: k.x + 5, y0: k.y - 5, y1: k.y + 5})) : []);
      }
      C.marks(svg, marks);
      return svg;
    });
  };
})(typeof window !== "undefined" ? window : globalThis);
