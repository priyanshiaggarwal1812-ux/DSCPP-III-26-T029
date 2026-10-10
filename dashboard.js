(function () {
  if (!TX.layout.init()) return;
  const M = TX.market, F = TX.fmt, $ = TX.$;
  let favorites = [];
  let marketFilter = 'all';

  try {
    const saved = JSON.parse(localStorage.getItem('tradex-watchlist') || '[]');
    favorites = Array.isArray(saved) ? saved.filter((s) => TX.SYMBOLS.includes(s)) : [];
  } catch (e) {
    TX.toast('Could not load your saved watchlist', 'err');
  }

  // ---- Market watch: built once, then updated in place (buttons never get replaced) ----
  const COLS = [
    ['fav', '', null], ['symbol', 'Symbol', (q, s) => s], ['last', 'Last', (q) => q.last],
    ['chg', 'Chg', (q) => q.last - q.open], ['pct', 'Chg %', (q) => (q.last / q.open - 1) * 100],
    ['bid', 'Bid', (q) => q.bid], ['ask', 'Ask', (q) => q.ask], ['spread', 'Spread', (q) => q.ask - q.bid],
    ['range', 'Day range', (q) => (q.high === q.low ? 0.5 : (q.last - q.low) / (q.high - q.low))], ['trend', 'Trend', null], ['act', '', null],
  ];
  let sortKey = 'symbol', sortDir = 1;
  const rows = {};
  $('#symtable').innerHTML = '<div style="overflow-x:auto"><table class="mkt"><thead><tr>' + COLS.map((c) =>
    `<th class="${['symbol', 'fav', 'trend', 'act'].includes(c[0]) ? '' : 'r'}">${c[2] ? `<button class="table-sort" data-key="${c[0]}">${c[1]}<span class="arr"></span></button>` : c[1]}</th>`).join('') +
    '</tr></thead><tbody id="mktBody"></tbody></table></div><div class="muted mkt-note">Change is measured from the first price seen this session. Prices refresh every 2 s.</div>';
  const body = $('#mktBody');
  TX.SYMBOLS.forEach((sym) => {
    const tr = document.createElement('tr');
    tr.className = 'mrow';
    tr.innerHTML = `<td><button class="link favorite" data-favorite="${sym}"></button></td>
      <td><b>${sym}</b><div class="muted co">${TX.esc(TX.nameOf(sym))}</div></td>
      <td class="r" data-c="last">-</td><td class="r" data-c="chg">-</td><td class="r" data-c="pct"><span class="pill">-</span></td>
      <td class="r t-buy" data-c="bid">-</td><td class="r t-sell" data-c="ask">-</td><td class="r muted" data-c="spread">-</td>
      <td class="r"><div class="rng"><span class="muted" data-c="low">-</span><div class="rbar"><i data-c="mark"></i></div><span class="muted" data-c="high">-</span></div></td>
      <td><svg class="spark" viewBox="0 0 80 22" preserveAspectRatio="none"><polyline fill="none" stroke-width="1.5" data-c="line"/></svg></td>
      <td class="r"><button class="link" data-sym="${sym}">Trade</button></td>`;
    rows[sym] = tr; body.appendChild(tr);
  });
  const cell = (sym, c) => rows[sym].querySelector(`[data-c="${c}"]`);

  function updateMarket() {
    const q = TX.watch.q;
    TX.SYMBOLS.forEach((sym) => {
      const x = q[sym], tr = rows[sym];
      if (!tr) return;
      const fav = tr.querySelector('.favorite'); fav.textContent = favorites.includes(sym) ? '★' : '☆';
      tr.style.display = marketFilter === 'watchlist' && !favorites.includes(sym) ? 'none' : '';
      if (!x) return;
      const chg = x.last - x.open, pct = (x.last / x.open - 1) * 100, up = chg >= 0, cls = up ? 'up' : 'down';
      const old = Number(cell(sym, 'last').dataset.v);
      cell(sym, 'last').textContent = F.price(x.last);
      if (old && old !== x.last) { tr.classList.remove('flash-up', 'flash-down'); void tr.offsetWidth; tr.classList.add(old < x.last ? 'flash-up' : 'flash-down'); }
      cell(sym, 'last').dataset.v = x.last;
      cell(sym, 'chg').textContent = F.signed(chg); cell(sym, 'chg').className = 'r ' + (up ? 't-buy' : 't-sell');
      const p = cell(sym, 'pct').firstChild; p.textContent = (up ? '▲ ' : '▼ ') + F.pct(pct); p.className = 'pill ' + cls;
      cell(sym, 'bid').textContent = x.bid == null ? '-' : F.price(x.bid);
      cell(sym, 'ask').textContent = x.ask == null ? '-' : F.price(x.ask);
      cell(sym, 'spread').textContent = x.bid == null || x.ask == null ? '-' : F.price(x.ask - x.bid);
      cell(sym, 'low').textContent = F.price(x.low); cell(sym, 'high').textContent = F.price(x.high);
      cell(sym, 'mark').style.left = (x.high === x.low ? 50 : ((x.last - x.low) / (x.high - x.low)) * 100) + '%';
      const h = x.hist, lo = Math.min.apply(null, h), hi = Math.max.apply(null, h);
      const line = cell(sym, 'line');
      line.setAttribute('points', h.map((v, i) => (h.length > 1 ? (i / (h.length - 1)) * 80 : 0).toFixed(1) + ',' + (hi === lo ? 11 : 21 - ((v - lo) / (hi - lo)) * 20).toFixed(1)).join(' '));
      line.setAttribute('stroke', up ? '#22c55e' : '#ef4444');
    });
    // re-order existing rows (moves DOM nodes, so buttons keep working)
    const col = COLS.find((c) => c[0] === sortKey), key = col[2];
    const val = (sym) => (q[sym] ? key(q[sym], sym) : (sortKey === 'symbol' ? sym : -Infinity));
    TX.SYMBOLS.filter((s) => rows[s]).sort((a, b) => {
      const l = val(a), r = val(b);
      return (typeof l === 'string' ? l.localeCompare(r) : l - r) * sortDir || a.localeCompare(b);
    }).forEach((sym) => body.appendChild(rows[sym]));
    document.querySelectorAll('#symtable .table-sort').forEach((b) => { b.lastChild.textContent = b.dataset.key === sortKey ? (sortDir === 1 ? ' ↑' : ' ↓') : ''; });
    $('#showAll').className = 'btn small' + (marketFilter === 'all' ? '' : ' ghost');
    $('#showWatchlist').className = 'btn small' + (marketFilter === 'watchlist' ? '' : ' ghost');
  }
  TX.watch.subscribe(updateMarket);
  TX.watch.start();
  updateMarket();
  $('#symtable').addEventListener('click', (e) => {
    const th = e.target.closest('[data-key]');
    if (th) {
      if (sortKey === th.dataset.key) sortDir *= -1; else { sortKey = th.dataset.key; sortDir = th.dataset.key === 'symbol' ? 1 : -1; }
      updateMarket(); return;
    }
    const favorite = e.target.closest('[data-favorite]');
    if (favorite) {
      const symbol = favorite.dataset.favorite;
      const nextFavorites = favorites.includes(symbol) ? favorites.filter((s) => s !== symbol) : favorites.concat(symbol);
      try { localStorage.setItem('tradex-watchlist', JSON.stringify(nextFavorites)); favorites = nextFavorites; updateMarket(); }
      catch (error) { TX.toast('Could not save your watchlist', 'err'); }
      return;
    }
    const trade = e.target.closest('[data-sym]');
    if (trade) { sessionStorage.setItem('tradex-symbol', trade.dataset.sym); location.href = 'trade.html'; }
  });
  $('#showAll').onclick = () => { marketFilter = 'all'; updateMarket(); };
  $('#showWatchlist').onclick = () => { marketFilter = 'watchlist'; updateMarket(); };

  function draw() {
    const x = TX.watch.q[M.symbol], last = M.book ? M.book.last : (x ? x.last : null);
    const chg = x && last != null ? last - x.open : 0, up = chg >= 0, c = up ? 't-buy' : 't-sell';
    const sp = M.book && M.book.asks[0] && M.book.bids[0] ? M.book.asks[0][0] - M.book.bids[0][0] : null;
    const sub = (t) => `<div class="muted stat-sub">${t}</div>`;
    const stats = [
      ['Symbol', M.symbol, sub(TX.esc(TX.nameOf(M.symbol)))],
      ['Last price', last == null ? '-' : F.price(last), x && last != null ? `<div class="stat-sub ${c}">${up ? '▲' : '▼'} ${F.signed(chg)} (${F.pct((last / x.open - 1) * 100)})</div>` : sub('-')],
      ['Day range', x ? F.price(x.low) + ' - ' + F.price(x.high) : '-', sub(sp == null ? 'Spread -' : 'Spread ' + F.price(sp))],
      ['Feed', M.status, sub(M.trades.length + ' recent trades')],
    ];
    $('#stats').innerHTML = stats.map((s) => `<div class="card"><h3>${s[0]}</h3><div class="big">${s[1]}</div>${s[2]}</div>`).join('');
    $('#ptitle').textContent = M.symbol + ' live price';
    const points = TX.chartRange.filter(M.prices);
    TX.charts.line($('#price'), points.map((p) => p.price), { labels: points.map((p) => F.time(p.t)) });
  }
  $('#chartRange').value = TX.chartRange.get();
  $('#chartRange').onchange = (event) => { TX.chartRange.set(event.target.value); draw(); };
  M.subscribe(draw);
  TX.watch.subscribe(draw);
  draw();

  // ---- System performance card (GET /metrics) ----
  $('#sysSrc').textContent = TX.USE_MOCK ? 'MOCK DATA' : 'live from the C++ engine';
  async function sys() {
    try {
      const m = await TX.getMetrics(), open = m.open_orders != null ? m.open_orders : m.resting_orders;
      $('#sys').innerHTML = [['Match latency p99', F.us(m.p99_match_us)], ['Orders / second', F.qty(Math.round(m.orders_per_sec))], ['RAM used', F.mb(m.ram_bytes)], ['Open orders', F.qty(open)]]
        .map((x) => `<div><div class="muted" style="font-size:11px">${x[0]}</div><div class="big">${x[1]}</div></div>`).join('');
    } catch (e) { $('#sys').innerHTML = '<div class="muted">Metrics not available: ' + TX.esc(e.message) + '</div>'; }
  }
  sys(); setInterval(sys, 3000);
})();
