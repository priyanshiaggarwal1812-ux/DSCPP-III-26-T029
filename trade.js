(function () {
  if (!TX.layout.init()) return;
  const M = TX.market, F = TX.fmt, V = TX.validate, $ = TX.$;
  let side = 'BUY', otype = 'LIMIT', acct = null, busy = false, touched = false, prefSym = null, prevLast = null, prevSym = null;
  let tf = +(sessionStorage.getItem('tradex-tf') || 60), mode = sessionStorage.getItem('tradex-mode') || 'line';
  let myOrders = null, ordersKey = '', lastBig = null;

  // does one of MY open orders sit at this price level?
  const mineAt = (sd, p) => !!myOrders && myOrders.some((o) => o.symbol === M.symbol && o.side === sd && F.price(o.price) === F.price(p));

  // ---- order book ladder (click a row to copy its price into the order form) ----
  const row = (l, c, max) =>
    `<div class="lrow${mineAt(c === 'buy' ? 'BUY' : 'SELL', l[0]) ? ' mine' : ''}" data-p="${l[0]}" title="Click to use this price"><i class="${c}" style="width:${(l[1] / max) * 100}%"></i><span class="${c === 'buy' ? 't-buy' : 't-sell'}">${F.price(l[0])}</span><span>${F.qty(l[1])}</span></div>`;

  function drawLadder() {
    const b = M.book;
    if (!b) { $('#ladder').innerHTML = '<h3>Order book</h3><div class="skeleton"></div>'; return; }
    if (!b.asks.length && !b.bids.length) { $('#ladder').innerHTML = `<h3>Order book ${TX.esc(b.symbol)}</h3><div class="empty">No orders in book</div>`; return; }
    const asks = b.asks.slice(0, 8).reverse(), bids = b.bids.slice(0, 8); // best ask sits next to the spread
    const max = Math.max.apply(null, [1].concat(asks.map((l) => l[1]), bids.map((l) => l[1])));
    const spread = b.asks[0] && b.bids[0] ? b.asks[0][0] - b.bids[0][0] : 0;
    // flash the spread bar green/red when the last price moved since the previous draw
    const flash = prevSym !== b.symbol || prevLast === null || b.last === prevLast ? '' : b.last > prevLast ? ' flash-up' : ' flash-down';
    prevLast = b.last; prevSym = b.symbol;
    $('#ladder').innerHTML = `<h3>Order book ${TX.esc(b.symbol)}</h3>` + asks.map((l) => row(l, 'sell', max)).join('') +
      `<div class="spread${flash}">Spread ${F.price(spread)} | Last ${F.price(b.last)}</div>` + bids.map((l) => row(l, 'buy', max)).join('');
  }

  // ---- price header: last price and change over the visible window ----
  function drawHead() {
    $('#ptitle').textContent = M.symbol + ' price (live)' + (TX.isUserStock(M.symbol) ? ' - user-listed stock' : '');
    const p = M.prices, now = p.length ? p[p.length - 1].t : 0, d = tf ? p.filter((x) => x.t >= now - tf) : p;
    if (d.length < 2) { $('#lastbig').textContent = p.length ? F.price(p[p.length - 1].price) : '-'; $('#lastbig').className = 'big'; $('#chg').textContent = ''; return; }
    const l = d[d.length - 1].price, f = d[0].price, diff = l - f, cls = diff >= 0 ? 't-buy' : 't-sell';
    const fl = lastBig === null || l === lastBig ? '' : l > lastBig ? ' flash-up' : ' flash-down'; lastBig = l;
    $('#lastbig').textContent = F.price(l); $('#lastbig').className = 'big ' + cls + fl;
    $('#chg').textContent = (diff >= 0 ? '+' : '') + F.price(diff) + ' (' + ((diff / f) * 100).toFixed(2) + '%)'; $('#chg').className = 'mono ' + cls;
  }

  function drawFeed() {
    $('#feed').innerHTML = M.trades.length
      ? M.trades.slice(0, 20).map((t) => `<div class="frow"><span class="muted">${F.time(t.ts)}</span><span class="${t.side === 'BUY' ? 't-buy' : 't-sell'}">${F.price(t.price)}</span><span>${F.qty(t.qty)}${t.mine ? ' <b class="you">you</b>' : ''}</span></div>`).join('')
      : '<div class="empty">No trades yet</div>';
  }

  // ---- my open orders for the selected symbol (re-rendered only when the data changed) ----
  function drawOrders() {
    if (!myOrders) return;
    const rows = myOrders.filter((o) => o.symbol === M.symbol), key = M.symbol + JSON.stringify(rows);
    if (key === ordersKey) return;
    ordersKey = key;
    $('#orders').innerHTML = TX.table([
      { label: 'Side', render: (o) => `<span class="${o.side === 'BUY' ? 't-buy' : 't-sell'}">${o.side}</span>` },
      { label: 'Price', right: 1, render: (o) => F.price(o.price) },
      { label: 'Left', right: 1, render: (o) => F.qty(o.remaining) },
      { label: '', right: 1, render: (o) => `<button class="btn sell small" data-id="${o.id}">Cancel</button>` },
    ], rows, 'No open orders');
  }
  async function loadOrders() {
    try { const r = await Promise.all([TX.getOrders(), TX.getPortfolio()]); myOrders = r[0]; acct = r[1]; drawOrders(); drawAvail(); drawLadder(); }
    catch (e) { if (!myOrders) $('#orders').innerHTML = '<div class="err">' + TX.esc(e.message) + '</div>'; }
  }
  // what the trader can still use: cash not locked by open BUY orders, shares not locked by open SELL orders
  function drawAvail() {
    if (!acct || !myOrders) return;
    const locked = myOrders.filter((o) => o.side === 'BUY').reduce((t, o) => t + o.remaining * o.price, 0);
    const h = acct.holdings.find((x) => x.symbol === M.symbol), own = h ? h.qty : 0;
    const sellLocked = myOrders.filter((o) => o.side === 'SELL' && o.symbol === M.symbol).reduce((t, o) => t + o.remaining, 0);
    $('#avail').textContent = 'Available: ' + F.money(Math.max(0, acct.cash - locked)) + ' cash | ' + F.qty(Math.max(0, own - sellLocked)) + ' ' + M.symbol + ' to sell';
  }
  $('#orders').addEventListener('click', async (e) => {
    const id = e.target.dataset.id;
    if (!id) return;
    try { await TX.cancelOrder(+id); TX.toast('Order cancelled'); loadOrders(); }
    catch (x) { TX.toast(x.message, 'err'); }
  });

  // ---- chart tabs (timeframe + line/candles), remembered for the session ----
  function setTabs() {
    document.querySelectorAll('#tabs button').forEach((b) => {
      const on = b.dataset.tf !== undefined ? +b.dataset.tf === tf : b.dataset.m === mode;
      b.className = 'btn small' + (b.classList.contains('sp') ? ' sp' : '') + (on ? '' : ' ghost');
    });
  }
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tf !== undefined) { tf = +b.dataset.tf; sessionStorage.setItem('tradex-tf', tf); }
    if (b.dataset.m) { mode = b.dataset.m; sessionStorage.setItem('tradex-mode', mode); }
    setTabs(); draw();
  });

  function draw() {
    drawLadder(); drawHead(); drawFeed(); drawOrders();
    TX.charts.price($('#price'), M.prices, { tf, mode });
    TX.charts.bars($('#vol'), M.trades.slice(0, 30).reverse().map((t) => ({ v: t.qty, color: t.side === 'BUY' ? '#22c55e' : '#ef4444' })));
    TX.charts.depth($('#depth'), M.book);
    $('#submit').textContent = btnText();
    $('#priceLabel').textContent = otype === 'MARKET' ? 'Price - best available' : 'Price (USD)' + (M.book ? ' - last ' + F.price(M.book.last) : '');
    drawAvail();
    updateLimitHint();
    // new symbol: prefill the price once from the first book we receive
    if (M.book && prefSym !== M.symbol) { prefSym = M.symbol; touched = false; $('#price_in').value = F.price(M.book.last); estimate(); }
  }

  // ---- order form (rendered once in trade.html, so it is never replaced) ----
  function setSide(s) {
    side = s;
    $('#sideBuy').className = 'btn ' + (s === 'BUY' ? 'buy' : 'ghost');
    $('#sideSell').className = 'btn ' + (s === 'SELL' ? 'sell' : 'ghost');
    $('#submit').className = 'btn ' + (s === 'BUY' ? 'buy' : 'sell');
    $('#submit').textContent = btnText(); estimate();
  }
  const btnText = () => side + ' ' + M.symbol + (otype === 'MARKET' ? ' at market' : '');
  function setType(t) {
    otype = t;
    $('#typeLimit').className = 'btn small' + (t === 'LIMIT' ? '' : ' ghost');
    $('#typeMarket').className = 'btn small' + (t === 'MARKET' ? '' : ' ghost');
    $('#price_in').disabled = t === 'MARKET';
    $('#submit').textContent = btnText(); estimate(); updateLimitHint();
  }
  // market order estimate: walk the visible levels on the opposite side
  function marketCost(q) {
    if (!M.book) return null;
    let left = q, c = 0;
    for (const l of side === 'BUY' ? M.book.asks : M.book.bids) { const t = Math.min(left, l[1]); c += t * l[0]; left -= t; if (!left) break; }
    return left ? null : c;
  }
  function estimate() {
    const p = parseFloat($('#price_in').value), q = parseInt($('#qty_in').value, 10), mkt = otype === 'MARKET';
    const c = mkt ? (q > 0 ? marketCost(q) : null) : p > 0 && q > 0 ? p * q : null;
    $('#total').textContent = c ? (mkt ? '~' : '') + F.money(c) : '-';
    $('#oerr').textContent = (!mkt && $('#price_in').value && V.price(p)) || ($('#qty_in').value && V.qty(q)) || '';
    updateLimitHint();
  }
  function updateLimitHint() {
    const hint = $('#limitHint');
    if (otype !== 'LIMIT') { hint.textContent = ''; return; }
    const book = M.book, price = parseFloat($('#price_in').value);
    const opposite = book && (side === 'BUY' ? book.asks[0] : book.bids[0]);
    if (!opposite) {
      hint.textContent = side === 'BUY' ? 'A BUY limit may fill immediately at or above the best ask; lower prices are more likely to rest.' :
        'A SELL limit may fill immediately at or below the best bid; higher prices are more likely to rest.';
      return;
    }
    const crosses = Number.isFinite(price) && (side === 'BUY' ? price >= opposite[0] : price <= opposite[0]);
    hint.textContent = crosses
      ? `This limit can fill immediately (best ${side === 'BUY' ? 'ask' : 'bid'}: ${F.price(opposite[0])}).`
      : side === 'BUY'
        ? `To rest as an open order, set below the best ask (${F.price(opposite[0])}); prices at or above it can fill now.`
        : `To rest as an open order, set above the best bid (${F.price(opposite[0])}); prices at or below it can fill now.`;
  }
  function showOrderResult(result, qty, isMarket) {
    const box = $('#orderResult');
    box.replaceChildren();
    const filled = Math.max(0, Number(result.filled) || 0);
    const remaining = Math.max(0, qty - filled);
    const status = String(result.status || 'accepted').replaceAll('_', ' ').toLowerCase();
    const stillOpen = !isMarket && remaining > 0;
    const message = document.createElement('div');
    message.textContent = `Order #${result.order_id}: ${status}; ${F.qty(filled)} of ${F.qty(qty)} filled` +
      (stillOpen ? `, ${F.qty(remaining)} still open.` : remaining ? `, ${F.qty(remaining)} unfilled and cancelled.` : '.');
    box.appendChild(message);
    const links = document.createElement('div');
    if (stillOpen) {
      const openLink = document.createElement('a');
      openLink.href = 'orders.html';
      openLink.textContent = 'View open orders';
      links.appendChild(openLink);
    }
    if (filled > 0 || remaining > 0) {
      const historyLink = document.createElement('a');
      historyLink.href = 'history.html';
      historyLink.textContent = 'View history';
      links.appendChild(historyLink);
    }
    if (links.childElementCount) box.appendChild(links);
    box.hidden = false;
  }
  async function submit() {
    if (busy) return;
    const p = parseFloat($('#price_in').value), q = parseInt($('#qty_in').value, 10);
    const mkt = otype === 'MARKET', e = (mkt ? null : V.price(p)) || V.qty(q);
    if (e) return TX.toast(e, 'err');
    const est = mkt ? marketCost(q) : p * q;
    if (!window.confirm('Review order\n\n' + side + ' ' + M.symbol + ' (' + otype + ')\n' + (mkt ? 'Price: best available' : 'Price: ' + F.price(p)) +
      '\nQuantity: ' + F.qty(q) + '\nEstimated total: ' + (est ? (mkt ? '~' : '') + F.money(est) : '-'))) return;
    busy = true; $('#submit').disabled = true;
    $('#orderResult').hidden = true;
    try {
      const order = mkt ? { symbol: M.symbol, side, orderType: 'MARKET', quantity: q } : { symbol: M.symbol, side, orderType: 'LIMIT', price: p, quantity: q };
      const r = await TX.placeOrder(order);
      showOrderResult(r, q, mkt);
      TX.toast('Order #' + r.order_id + ' ' + r.status + ': ' + F.qty(r.filled || 0) + ' of ' + F.qty(q) + ' filled' + (mkt && r.filled < q ? ' (rest cancelled)' : ''));
      $('#qty_in').value = ''; estimate(); loadOrders();
    } catch (x) {
      const box = $('#orderResult');
      box.textContent = 'Order not placed: ' + x.message;
      box.hidden = false;
      TX.toast(x.message, 'err');
    } finally {
      busy = false; $('#submit').disabled = false;
    }
  }
  $('#typeLimit').onclick = () => setType('LIMIT');
  $('#typeMarket').onclick = () => setType('MARKET');
  $('#sideBuy').onclick = () => setSide('BUY');
  $('#sideSell').onclick = () => setSide('SELL');
  $('#price_in').oninput = () => { touched = true; estimate(); };
  $('#qty_in').oninput = estimate;
  $('#qty_in').onkeydown = (e) => { if (e.key === 'Enter') submit(); };
  $('#submit').onclick = submit;
  // pointerdown (not click) so the choice is not lost when the ladder re-renders mid-click
  $('#ladder').addEventListener('pointerdown', (e) => {
    const r = e.target.closest('.lrow');
    if (r) { $('#price_in').value = r.dataset.p; touched = true; estimate(); }
  });

  TX.charts.depthTip($('#depth'), $('#tip'));
  TX.charts.priceTip($('#price'), $('#ptip'));
  M.onFill(() => loadOrders()); // an order was (partly) filled: refresh the list (layout.js shows the toast)
  setTabs(); setSide('BUY'); setType('LIMIT');
  loadOrders(); setInterval(loadOrders, 3000);
  M.subscribe(draw);
  draw();
})();
