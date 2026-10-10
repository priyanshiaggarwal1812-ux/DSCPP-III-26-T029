(function () {
  if (!TX.layout.init()) return;
  const M = TX.market, F = TX.fmt, $ = TX.$;

  function draw() {
    const b = M.book;
    const bid = b && b.bids[0] ? b.bids[0][0] : null, ask = b && b.asks[0] ? b.asks[0][0] : null;
    const sum = (a) => a.slice(0, 10).reduce((t, l) => t + l[1], 0);
    const bv = b ? sum(b.bids) : 0, av = b ? sum(b.asks) : 0;
    const imb = bv + av > 0 ? ((bv - av) / (bv + av)) * 100 : 0;
    const stats = [['Best bid', bid ? F.price(bid) : '-'], ['Best ask', ask ? F.price(ask) : '-'],
                   ['Spread', bid && ask ? F.price(ask - bid) : '-'], ['Imbalance (top 10)', (imb >= 0 ? '+' : '') + imb.toFixed(1) + '%']];
    $('#dstats').innerHTML = stats.map((s) => `<div class="card"><h3>${s[0]}</h3><div class="big">${s[1]}</div></div>`).join('');
    // extra stats: trades per minute (from the last 50 trades kept by the store), mid price, total resting volume
    const now = Date.now() / 1000, tr = M.trades || [];
    const inMin = tr.filter((t) => t.ts >= now - 60).length;
    const capped = tr.length >= 50 && tr[tr.length - 1].ts >= now - 60; // all 50 kept trades are inside the minute
    const mid = bid && ask ? (bid + ask) / 2 : null;
    const spreadBps = mid ? ((ask - bid) / mid) * 1e4 : null;
    const all = (a) => a.reduce((t, l) => t + l[1], 0);
    const stats2 = [['Trades / min', inMin + (capped ? '+' : '')], ['Mid price', mid ? F.price(mid) : '-'],
                    ['Spread (bps)', spreadBps != null ? spreadBps.toFixed(1) : '-'],
                    ['Resting volume', b ? F.qty(all(b.bids)) + ' / ' + F.qty(all(b.asks)) : '-']];
    $('#dstats2').innerHTML = stats2.map((s) => `<div class="card"><h3>${s[0]}</h3><div class="big">${s[1]}</div></div>`).join('');

    // price levels with quantity and cumulative volume (top 10 per side)
    const level = (levels, cls) => {
      let cum = 0; const top = levels.slice(0, 10), max = top.reduce((t, l) => t + l[1], 0) || 1;
      const rows = top.map((l) => { cum += l[1]; return `<div class="lrow"><i class="${cls}" style="width:${(cum / max) * 100}%"></i><span class="${cls === 'buy' ? 't-buy' : 't-sell'}">${F.price(l[0])}</span><span>${F.qty(l[1])}</span><span class="muted">${F.qty(cum)}</span></div>`; });
      return '<div class="lrow muted"><span>Price</span><span>Qty</span><span>Cumulative</span></div>' + (rows.join('') || '<div class="empty">Empty</div>');
    };
    $('#lvbids').innerHTML = b ? level(b.bids, 'buy') : '';
    $('#lvasks').innerHTML = b ? level(b.asks, 'sell') : '';
    TX.charts.depth($('#depth'), b);
  }
  M.subscribe(draw);
  draw();
})();
