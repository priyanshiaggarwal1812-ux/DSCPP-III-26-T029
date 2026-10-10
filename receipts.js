(function () {
  if (!TX.layout.init()) return;
  const F = TX.fmt, $ = TX.$;
  let rows = [];
  const table = TX.interactiveTable($('#rlist'), [
    { label: 'Receipt', sortValue: (r) => String(r.receipt_number || r.receipt_id), render: (r) => TX.esc(r.receipt_number || r.receipt_id) },
    { label: 'Order', render: (r) => (r.order_id != null ? '#' + TX.esc(r.order_id) : '-') },
    { label: 'Time', sortValue: (r) => r.ts, render: (r) => F.dateTime(r.ts) },
    { label: 'Symbol', sortValue: (r) => r.symbol, render: (r) => TX.esc(r.symbol) },
    { label: 'Side', sortValue: (r) => r.side, render: (r) => `<span class="${r.side === 'BUY' ? 't-buy' : 't-sell'}">${TX.esc(r.side)}</span>` },
    { label: 'Qty', right: 1, sortValue: (r) => r.qty, render: (r) => F.qty(r.qty) },
    { label: 'Price', right: 1, sortValue: (r) => r.price, render: (r) => F.price(r.price) },
    { label: 'Total', right: 1, sortValue: (r) => r.price * r.qty, render: (r) => F.money(r.price * r.qty) },
    { label: '', right: 1, render: (r) => `<button class="btn small" data-rid="${TX.esc(r.trade_id)}">View</button>` },
  ], 'No receipts yet. A receipt appears after one of your orders trades.');

  function show(r) {
    if (!r) return;
    const row = (k, v) => `<div class="rw"><span class="muted">${k}</span><span>${v}</span></div>`;
    $('#rview').style.display = 'block';
    $('#rview').innerHTML = '<div class="card rcpt"><h2>TradeX trade receipt</h2><div class="muted" style="margin-bottom:8px">Simulated trade. No real money moved.</div>' +
      row('Receipt no.', TX.esc(r.receipt_number || r.receipt_id)) + (r.order_id != null ? row('Order', '#' + TX.esc(r.order_id)) : '') +
      row('Date', F.dateTime(r.ts)) + row('Account', TX.esc((TX.auth.get() || {}).accountId || '-')) +
      row('Symbol', TX.esc(r.symbol)) + row('Side', TX.esc(r.side)) + row('Quantity', F.qty(r.qty)) + row('Price', F.money(r.price)) +
      `<div class="rw tot"><span>Total</span><span>${F.money(r.price * r.qty)}</span></div><button class="btn small noprint" id="print" style="margin-top:12px">Print</button></div>`;
    $('#print').onclick = () => window.print();
    $('#rview').scrollIntoView({ behavior: 'smooth' });
  }
  $('#rlist').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rid]');
    if (b) show(rows.find((r) => String(r.trade_id) === b.dataset.rid));
  });
  TX.getReceipts().then((r) => {
    const params = new URLSearchParams(location.search);
    const order = params.get('order');
    rows = order ? r.filter((x) => String(x.order_id) === order) : r;
    table.setRows(rows);
    const t = params.get('trade');
    if (t) show(rows.find((x) => String(x.trade_id) === t));
  }).catch((e) => { $('#rlist').innerHTML = '<div class="empty">Receipts not available: ' + TX.esc(e.message) + '</div>'; });
})();
