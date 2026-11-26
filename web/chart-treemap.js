/* A treemap in groups: each group a block of the chart, each item a tile whose area is its value. The groups are
   ordered (latency targets), so they take the steps of one hue, lighter to darker, and a tile's text takes the ink
   that reads on its step. Tiles keep a gap of the surface between them, print their name and value only where both
   fit, and answer the pointer and the keyboard. */
(function (root) {
  "use strict";
  const D = root.Dash, R = root.Reg, M = root.RegMath;
  if (!R) return;
  const C = R.charts, svgEl = D.svgEl;
  const HEAD = 20, CHAR = 6.7;

  // spec: {title, sub, show(value), groups: [{name, step: 1-4, items: [{name, sub, value, rows, pick}]}]}
  C.treemap = function (spec) {
    return C.frame(spec, (W) => {
      const H = Math.round(Math.min(400, Math.max(250, W * 0.42)));
      const groups = spec.groups.filter((g) => g.items.some((it) => it.value > 0));
      const svg = C.svg(W, H, spec.title + (spec.sub ? ". " + spec.sub : "")), marks = [];
      const outer = M.squarify(groups.map((g) => g.items.reduce((s, it) => s + Math.max(0, it.value), 0)), 0, 0, W, H);
      const fitted = (text, width) => { const n = Math.floor((width - 12) / CHAR); return n >= text.length ? text : n >= 4 ? text.slice(0, n - 1) + "…" : ""; };
      groups.forEach((g, gi) => {
        const box = outer[gi];
        if (!box) return;
        const head = box.h > 70 && box.w > 90 ? HEAD : 0, ink = `var(--o${g.step}i)`;
        if (head) svg.append(svgEl("text", {x: box.x + 4, y: box.y + 14, class: "glabel"}, fitted(`${g.name} · ${g.items.length}`, box.w)));
        const tiles = M.squarify(g.items.map((it) => it.value), box.x, box.y + head, box.w, box.h - head);
        g.items.forEach((it, i) => {
          const t = tiles[i];
          if (!t) return;
          const x = t.x + 1, y = t.y + 1, w = Math.max(0, t.w - 2), h = Math.max(0, t.h - 2);  // a 2 px gap of the surface
          svg.append(svgEl("rect", {x: x.toFixed(1), y: y.toFixed(1), width: w.toFixed(1), height: h.toFixed(1), rx: 3, class: "tile o" + g.step}));
          const name = fitted(it.name, w), value = fitted(spec.show(it.value), w);
          if (name && h >= 22) svg.append(svgEl("text", {x: x + 7, y: y + 16, class: "tname", style: `fill:${ink}`}, name));
          if (name && value && h >= 40) svg.append(svgEl("text", {x: x + 7, y: y + 32, class: "tvalue2 num", style: `fill:${ink}`}, value));
          if (name && it.sub && h >= 58 && fitted(it.sub, w)) svg.append(svgEl("text", {x: x + 7, y: y + 47, class: "tsub", style: `fill:${ink}`}, fitted(it.sub, w)));
          marks.push({x: x + w / 2, y: y + h / 2, box: [x, y, x + w, y + h], title: `${it.name} · ${g.name}`, rows: it.rows, pick: it.pick});
        });
      });
      C.marks(svg, marks);
      return svg;
    });
  };
})(typeof window !== "undefined" ? window : globalThis);
