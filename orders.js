(function () {
  if (!TX.layout.init()) return;
  const F = TX.fmt, $ = TX.$;
  let lastKey = '', rowsNow = [];

  const table = TX.interactiveTable($('#orders'), [
    { label: 'ID', sortValue: (o) => o.id, render: (o) => '#' + o.id },
    { label: 'Symbol', sortValue: (o) => o.symbol, render: (o) => TX.esc(o.symbol) },
    { label: 'Side', sortValue: (o) => o.side, render: (o) => `<span class="${o.side === 'BUY' ? 't-buy' : 't-sell'}">${o.side}</span>` },
    { label: 'Price', right: 1, sortValue: (o) => o.price, render: (o) => F.price(o.price) },
    { label: 'Qty', right: 1, sortValue: (o) => o.qty, render: (o) => F.qty(o.qty) },
    { label: 'Left', right: 1, sortValue: (o) => o.remaining, render: (o) => F.qty(o.remaining) },
    { label: '', right: 1, render: (o) => `<button class="btn sell small" data-id="${o.id}">Cancel</button>` },
  ], 'No open orders');

  async function load() {
    try {
      const rows = await TX.getOrders();
      rowsNow = rows; refreshCancelBar();
      const key = JSON.stringify(rows);
      if (key === lastKey) return; // only re-render when data changed (keeps buttons clickable)
      lastKey = key;
      table.setRows(rows);
    } catch (e) {
      TX.toast(e.message, 'err');
    }
  }

  $('#orders').addEventListener('click', async (e) => {
    const id = e.target.dataset.id;
    if (!id) return;
    try { await TX.cancelOrder(+id); TX.toast('Order cancelled'); lastKey = ''; load(); }
    catch (x) { TX.toast(x.message, 'err'); }
  });

  // ---- Cancel all: one click removes every open order (optionally for one symbol) ----
  // Uses the existing DELETE /order/:id, so the API contract is unchanged.
  function refreshCancelBar() {
    const sel = $('#cancelSym'), cur = sel.value || 'ALL';
    const syms = Array.from(new Set(rowsNow.map((o) => o.symbol))).sort();
    const opts = ['ALL'].concat(syms);
    if (sel.dataset.k !== opts.join(',')) {
      sel.dataset.k = opts.join(',');
      sel.innerHTML = opts.map((x) => `<option value="${TX.esc(x)}">${x === 'ALL' ? 'All symbols' : TX.esc(x)}</option>`).join('');
      sel.value = opts.includes(cur) ? cur : 'ALL';
    }
    const n = rowsNow.filter((o) => sel.value === 'ALL' || o.symbol === sel.value).length;
    $('#cancelAll').disabled = n === 0;
    $('#cancelAll').textContent = n ? `Cancel all (${n})` : 'Cancel all';
  }
  $('#cancelSym').addEventListener('change', refreshCancelBar);
  $('#cancelAll').addEventListener('click', async () => {
    const sym = $('#cancelSym').value;
    const ids = rowsNow.filter((o) => sym === 'ALL' || o.symbol === sym).map((o) => o.id);
    if (!ids.length) return;
    if (!confirm(`Cancel ${ids.length} open order(s)${sym === 'ALL' ? '' : ' for ' + sym}?`)) return;
    $('#cancelAll').disabled = true;
    const res = await Promise.allSettled(ids.map((id) => TX.cancelOrder(id)));
    const bad = res.filter((r) => r.status === 'rejected').length;
    TX.toast(bad ? `Cancelled ${ids.length - bad}, ${bad} failed` : `Cancelled ${ids.length} order(s)`, bad ? 'err' : 'ok');
    lastKey = ''; load();
  });

  load();
  setInterval(load, 3000); // refresh so partial fills show up
})();
