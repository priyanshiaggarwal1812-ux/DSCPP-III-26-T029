(function () {
  if (!TX.layout.init()) return;
  const F = TX.fmt, $ = TX.$;
  $('#fSym').innerHTML += TX.SYMBOLS.map((s) => `<option>${s}</option>`).join('');
  const table = TX.interactiveTable($('#trades'), [
    { label: 'Time', sortValue: (t) => t.ts, render: (t) => F.dateTime(t.ts) },
    { label: 'Symbol', sortValue: (t) => t.symbol, render: (t) => TX.esc(t.symbol) },
    { label: 'Side', sortValue: (t) => t.side, render: (t) => `<span class="${t.side === 'BUY' ? 't-buy' : 't-sell'}">${t.side}</span>` },
    { label: 'Price', right: 1, sortValue: (t) => t.price, render: (t) => F.price(t.price) },
    { label: 'Qty', right: 1, sortValue: (t) => t.qty, render: (t) => F.qty(t.qty) },
    { label: 'Receipt', render: (t) => (t.id != null ? `<a class="link" href="receipts.html?trade=${encodeURIComponent(t.id)}">View</a>` : '') },
  ], 'No trades match');

  async function load() {
    try { table.setRows(await TX.getTrades({ symbol: $('#fSym').value, side: $('#fSide').value })); }
    catch (e) { TX.toast(e.message, 'err'); }
  }
  async function loadLog() {
    try {
      const [activityResult, tradesResult] = await Promise.allSettled([TX.getOrderLog(), TX.getTrades({})]);
      if (activityResult.status === 'rejected') throw activityResult.reason;
      const rows = activityResult.value;
      const trades = tradesResult.status === 'fulfilled' ? tradesResult.value : [];
      if (tradesResult.status === 'rejected') TX.toast('Receipt links unavailable: ' + tradesResult.reason.message, 'err');
      const receiptsByOrder = new Map();
      trades.forEach((trade) => {
        if (trade.order_id == null) return;
        receiptsByOrder.set(trade.order_id, (receiptsByOrder.get(trade.order_id) || 0) + 1);
      });
      $('#olog').innerHTML = TX.table([
        { label: 'Time', render: (o) => F.dateTime(o.ts) },
        { label: 'Order', render: (o) => (o.id ? '#' + o.id : '-') },
        { label: 'Symbol', render: (o) => TX.esc(o.symbol) },
        { label: 'Side', render: (o) => `<span class="${o.side === 'BUY' ? 't-buy' : 't-sell'}">${TX.esc(o.side)}</span>` },
        { label: 'Type', render: (o) => TX.esc(o.type) },
        { label: 'Price', right: 1, render: (o) => (o.price ? F.price(o.price) : 'market') },
        { label: 'Qty', right: 1, render: (o) => F.qty(o.qty) },
        { label: 'Status', render: (o) => `<span class="st-${TX.esc(String(o.status).split(' ')[0])}">${TX.esc(o.status)}</span>` },
        { label: 'Note', render: (o) => TX.esc(o.note || '') },
        { label: 'Receipts', render: (o) => {
          const count = receiptsByOrder.get(o.id) || 0;
          return count ? `<a class="link" href="receipts.html?order=${encodeURIComponent(o.id)}">View ${count}</a>` : '';
        } },
      ], rows, 'No order activity yet');
    } catch (e) { $('#olog').innerHTML = '<div class="empty">Order activity not available from the server</div>'; }
  }
  loadLog();
  $('#fSym').onchange = load;
  $('#fSide').onchange = load;
  load();

  function csvCell(value) {
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  $('#downloadTrades').onclick = () => {
    const rows = table.getVisibleRows();
    if (!rows.length) return TX.toast('There are no visible trades to export', 'err');
    const lines = [['Time (UTC)', 'Trade ID', 'Symbol', 'Side', 'Price (USD)', 'Quantity'].map(csvCell).join(',')];
    rows.forEach((t) => lines.push([
      new Date(t.ts * 1000).toISOString(), t.id, t.symbol, t.side, t.price, t.qty,
    ].map(csvCell).join(',')));
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = 'tradex-trades-' + new Date().toISOString().slice(0, 10) + '.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    TX.toast(rows.length + ' trades exported');
  };
})();
