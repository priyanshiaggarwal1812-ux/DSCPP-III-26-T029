(function () {
  const GREEN = '#22c55e', RED = '#ef4444', MUTED = '#8a9bb8', GRID = '#1b2a47';

  // size the canvas for sharp rendering on high-DPI screens and clear it
  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '10px sans-serif';
    return { ctx, w, h };
  }
  function message(ctx, text) { ctx.fillStyle = MUTED; ctx.fillText(text, 10, 20); }

  function drawLine(canvas, values, opt, hoverIndex) {
      const { ctx, w, h } = setup(canvas), color = (opt && opt.color) || GREEN;
      if (values.length < 2) return message(ctx, 'Waiting for data...');
      let min = Math.min.apply(null, values), max = Math.max.apply(null, values);
      if (min === max) { min -= 1; max += 1; }
      const pad = (max - min) * 0.1; min -= pad; max += pad;
      const L = 6, R = 46, T = 8, B = 8, n = values.length;
      const X = (i) => L + ((w - L - R) * i) / (n - 1), Y = (v) => T + (h - T - B) * (1 - (v - min) / (max - min));
      ctx.lineWidth = 1; ctx.strokeStyle = GRID; ctx.fillStyle = MUTED;
      for (let k = 0; k <= 4; k++) {
        const v = min + ((max - min) * k) / 4, y = Y(v);
        ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke();
        ctx.fillText(v.toFixed(2), w - R + 4, y + 3);
      }
      ctx.beginPath();
      values.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
      ctx.lineTo(X(n - 1), h - B); ctx.lineTo(L, h - B); ctx.closePath();
      ctx.globalAlpha = 0.15; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(n - 1), Y(values[n - 1]), 3, 0, 7); ctx.fill();
      if (hoverIndex !== undefined && hoverIndex >= 0 && hoverIndex < n) {
        const x = X(hoverIndex), y = Y(values[hoverIndex]);
        ctx.strokeStyle = MUTED; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, h - B); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill();
        const label = opt && opt.labels && opt.labels[hoverIndex] ? opt.labels[hoverIndex] : ((opt && opt.name) || 'Price');
        const text = label + '  ' + (opt && opt.unit !== undefined ? '' : '$') + Number(values[hoverIndex]).toFixed(2) + ((opt && opt.unit) || '');
        const boxWidth = Math.min(ctx.measureText(text).width + 12, w - 8);
        const boxX = Math.max(4, Math.min(x + 8, w - boxWidth - 4));
        const boxY = Math.max(4, y - 30);
        ctx.fillStyle = '#111a2e'; ctx.fillRect(boxX, boxY, boxWidth, 22);
        ctx.strokeStyle = GRID; ctx.strokeRect(boxX, boxY, boxWidth, 22);
        ctx.fillStyle = '#e6edf7'; ctx.fillText(text, boxX + 6, boxY + 14);
      }
  }

  TX.charts = {
    // values: array of numbers, drawn as an area line with hover details. opt: {color, labels, unit, name}
    line(canvas, values, opt) {
      const options = opt || {};
      drawLine(canvas, values, options);
      canvas.onmousemove = (event) => {
        if (values.length < 2) return;
        const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, plotWidth = rect.width - 52;
        drawLine(canvas, values, options, Math.round(Math.max(0, Math.min(1, (x - 6) / plotWidth)) * (values.length - 1)));
      };
      canvas.onmouseleave = () => drawLine(canvas, values, options);
    },

    // prices: [{t, price}] oldest first. opt: {tf: window in seconds (0 = all), mode: 'line' | 'candle'}
    price(canvas, prices, opt) {
      const { ctx, w, h } = setup(canvas), tf = (opt && opt.tf) || 0, candle = !!(opt && opt.mode === 'candle');
      const now = prices.length ? prices[prices.length - 1].t : 0;
      const d = tf ? prices.filter((p) => p.t >= now - tf) : prices;
      if (d.length < 2) { canvas._price = null; return message(ctx, 'Waiting for data...'); }
      let pts = d.map((p) => ({ o: p.price, h: p.price, l: p.price, c: p.price }));
      if (candle) { // group the one-per-second points into about 40 candles
        const bs = Math.max(1, Math.ceil((d[d.length - 1].t - d[0].t + 1) / 40)), groups = {}, order = [];
        d.forEach((p) => {
          const k = Math.floor(p.t / bs), g = groups[k];
          if (!g) { groups[k] = { o: p.price, h: p.price, l: p.price, c: p.price }; order.push(k); }
          else { g.h = Math.max(g.h, p.price); g.l = Math.min(g.l, p.price); g.c = p.price; }
        });
        pts = order.map((k) => groups[k]);
      }
      const hi0 = Math.max.apply(null, pts.map((c) => c.h)), lo0 = Math.min.apply(null, pts.map((c) => c.l)), pad = (hi0 - lo0) * 0.1 || 0.5;
      const hi = hi0 + pad, lo = lo0 - pad, R = 46, T = 8, B = 16, cw = (w - R) / pts.length;
      const X = (i) => (i + 0.5) * cw, Y = (v) => T + (h - T - B) * (1 - (v - lo) / (hi - lo));
      canvas._price = { X, pts, d: candle ? null : d };
      ctx.lineWidth = 1; ctx.strokeStyle = GRID; ctx.fillStyle = MUTED;
      for (let k = 0; k <= 4; k++) {
        const v = lo + ((hi - lo) * k) / 4, y = Y(v);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w - R, y); ctx.stroke();
        ctx.fillText(v.toFixed(2), w - R + 4, y + 3);
      }
      const t1 = TX.fmt.time(d[d.length - 1].t);
      ctx.fillText(TX.fmt.time(d[0].t), 0, h - 3); ctx.fillText(t1, w - R - ctx.measureText(t1).width, h - 3);
      const last = pts[pts.length - 1].c, ly = Y(last);
      ctx.setLineDash([3, 3]); ctx.strokeStyle = MUTED; ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(w - R, ly); ctx.stroke(); ctx.setLineDash([]);
      if (candle) {
        pts.forEach((c, i) => {
          const col = c.c >= c.o ? GREEN : RED, cx = X(i);
          ctx.strokeStyle = ctx.fillStyle = col;
          ctx.beginPath(); ctx.moveTo(cx, Y(c.h)); ctx.lineTo(cx, Y(c.l)); ctx.stroke();
          ctx.fillRect(cx - cw * 0.35, Y(Math.max(c.o, c.c)), cw * 0.7, Math.max(1, Math.abs(Y(c.o) - Y(c.c))));
        });
      } else {
        const col = last >= pts[0].c ? GREEN : RED;
        ctx.beginPath(); pts.forEach((c, i) => (i ? ctx.lineTo(X(i), Y(c.c)) : ctx.moveTo(X(i), Y(c.c))));
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
        ctx.lineTo(X(pts.length - 1), h - B); ctx.lineTo(X(0), h - B); ctx.closePath();
        ctx.globalAlpha = 0.15; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = MUTED; ctx.fillText(last.toFixed(2), w - R + 4, ly - 4);
    },

    // items: [{v, color}] drawn as vertical bars (volume)
    bars(canvas, items) {
      const { ctx, w, h } = setup(canvas);
      if (!items.length) return message(ctx, 'No trades yet');
      const max = Math.max.apply(null, items.map((i) => i.v)), bw = w / items.length;
      items.forEach((it, i) => {
        ctx.fillStyle = it.color;
        const bh = (it.v / max) * (h - 4);
        ctx.fillRect(i * bw + 1, h - bh, Math.max(1, bw - 2), bh);
      });
    },

    // book: {bids:[[p,q]], asks:[[p,q]]}. Cumulative step-area depth chart (bids green, asks red).
    depth(canvas, book) {
      const { ctx, w, h } = setup(canvas);
      canvas._depth = null;
      if (!book || !book.bids.length || !book.asks.length) return message(ctx, 'Waiting for data...');
      const bids = book.bids.slice().sort((a, b) => a[0] - b[0]), asks = book.asks.slice().sort((a, b) => a[0] - b[0]);
      const bc = []; let c = 0;
      for (let i = bids.length - 1; i >= 0; i--) { c += bids[i][1]; bc[i] = c; }
      c = 0; const ac = asks.map((l) => (c += l[1]));
      const pmin = bids[0][0], pmax = asks[asks.length - 1][0], vmax = Math.max(bc[0], ac[ac.length - 1]);
      const L = 6, R = 6, T = 8, B = 18, base = h - B;
      const X = (p) => L + ((w - L - R) * (p - pmin)) / (pmax - pmin), Y = (v) => T + (base - T) * (1 - v / vmax);
      const draw = (pts, color) => {
        ctx.beginPath(); ctx.moveTo(X(pts[0][0]), pts[0][2] ? base : Y(pts[0][1]));
        pts.forEach((p, i) => {
          if (i === 0 && p[2]) ctx.lineTo(X(p[0]), Y(p[1]));
          if (i > 0) { ctx.lineTo(X(p[0]), Y(pts[i - 1][1])); ctx.lineTo(X(p[0]), Y(p[1])); }
        });
        const last = pts[pts.length - 1];
        ctx.lineTo(X(last[0]), base);
        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.lineTo(X(pts[0][0]), base); ctx.closePath();
        ctx.globalAlpha = 0.18; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
      };
      draw(bids.map((l, i) => [l[0], bc[i], 0]), GREEN);   // ends at the best bid
      draw(asks.map((l, i) => [l[0], ac[i], 1]), RED);     // starts at the best ask
      // remember the points so depthTip() can show details on hover
      canvas._depth = { X, pts: bids.map((l, i) => ({ p: l[0], c: bc[i], s: 'Bid' })).concat(asks.map((l, i) => ({ p: l[0], c: ac[i], s: 'Ask' }))) };
      ctx.fillStyle = MUTED;
      ctx.fillText(pmin.toFixed(2), L, h - 4);
      ctx.fillText(pmax.toFixed(2), w - R - 30, h - 4);
      ctx.fillText(((bids[bids.length - 1][0] + asks[0][0]) / 2).toFixed(2), w / 2 - 14, h - 4);
    },

    // hover tooltip for the price chart (time + price for the line, O/H/L/C for candles)
    priceTip(canvas, tip) {
      canvas.addEventListener('pointermove', (e) => {
        const s = canvas._price;
        if (!s) { tip.style.display = 'none'; return; }
        const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, f = TX.fmt.price;
        const i = Math.max(0, Math.min(s.pts.length - 1, Math.round((px * s.pts.length) / (r.width - 46) - 0.5))), c = s.pts[i];
        tip.textContent = s.d ? TX.fmt.time(s.d[i].t) + ' | ' + f(c.c) : 'O ' + f(c.o) + '  H ' + f(c.h) + '  L ' + f(c.l) + '  C ' + f(c.c);
        tip.style.display = 'block';
        tip.style.left = Math.max(0, Math.min(px + 10, r.width - 230)) + 'px';
      });
      canvas.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
    },

    // hover tooltip for the depth chart. tip = absolutely positioned element inside a position:relative wrapper
    depthTip(canvas, tip) {
      const show = (e) => {
        const d = canvas._depth;
        if (!d) { tip.style.display = 'none'; return; }
        const r = canvas.getBoundingClientRect(), px = e.clientX - r.left;
        let best = d.pts[0];
        d.pts.forEach((q) => { if (Math.abs(d.X(q.p) - px) < Math.abs(d.X(best.p) - px)) best = q; });
        tip.textContent = best.s + ' ' + TX.fmt.price(best.p) + ' | cumulative ' + TX.fmt.qty(best.c);
        tip.style.display = 'block';
        tip.style.left = Math.max(0, Math.min(px + 10, r.width - 200)) + 'px';
      };
      canvas.addEventListener('pointermove', show);
      canvas.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
    },

    // items: [{name, value}] drawn as a donut with a legend
    donut(canvas, items) {
      const { ctx, w, h } = setup(canvas);
      const colors = ['#3b82f6', GREEN, '#f59e0b', '#8b5cf6', RED, '#14b8a6'];
      const total = items.reduce((a, i) => a + i.value, 0);
      if (!total) return message(ctx, 'No holdings');
      const r = Math.min(w, h) / 2 - 6, cx = r + 6, cy = h / 2;
      let a0 = -Math.PI / 2;
      ctx.lineWidth = r * 0.4;
      items.forEach((it, i) => {
        const a1 = a0 + (it.value / total) * Math.PI * 2;
        ctx.strokeStyle = colors[i % colors.length];
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.8, a0, a1); ctx.stroke();
        ctx.fillStyle = colors[i % colors.length]; ctx.fillRect(cx + r + 20, 14 + i * 16, 8, 8);
        ctx.fillStyle = '#e6edf7'; ctx.fillText(it.name + '  ' + ((it.value / total) * 100).toFixed(0) + '%', cx + r + 34, 22 + i * 16);
        a0 = a1;
      });
    },
  };
})();
