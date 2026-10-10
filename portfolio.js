(function () {
  if (!TX.layout.init()) return;
  const F = TX.fmt, $ = TX.$;
  let data = null;
  const holdingsTable = TX.interactiveTable($('#holdings'), [
    { label: 'Symbol', sortValue: (h) => h.symbol, render: (h) => TX.esc(h.symbol) },
    { label: 'Qty', right: 1, sortValue: (h) => h.qty, render: (h) => h.qty },
    { label: 'Avg price', right: 1, sortValue: (h) => h.avg_price, render: (h) => F.price(h.avg_price) },
    { label: 'Last', right: 1, sortValue: (h) => h.last, render: (h) => F.price(h.last) },
    { label: 'P&amp;L', right: 1, sortValue: (h) => (h.last - h.avg_price) * h.qty, render: (h) => {
      const v = (h.last - h.avg_price) * h.qty;
      return `<span class="${v >= 0 ? 't-buy' : 't-sell'}">${v >= 0 ? '+' : ''}${F.money(v)}</span>`;
    } },
  ], 'No holdings yet');

  function charts() {
    if (!data) return;
    TX.charts.donut($('#donut'), data.holdings.map((h) => ({ name: h.symbol, value: h.qty * h.last })));
    TX.charts.line($('#pnl'), data.pnl_series.map((s) => s[1]));
  }

  TX.getPortfolio().then((p) => {
    data = p;
    const up = p.pnl_today >= 0;
    $('#pstats').innerHTML =
      `<div class="card"><h3>Portfolio value</h3><div class="big">${F.money(p.value)}</div></div>` +
      `<div class="card"><h3>Today P&amp;L</h3><div class="big ${up ? 't-buy' : 't-sell'}">${up ? '+' : ''}${F.money(p.pnl_today)}</div></div>` +
      `<div class="card"><h3>Cash</h3><div class="big">${F.money(p.cash)}</div></div>`;
    holdingsTable.setRows(p.holdings);
    charts();
  }).catch((e) => TX.toast(e.message, 'err'));

  TX.market.subscribe(charts); // also redraws on window resize
})();
