(function () {
  // Mock backend = a small price-time-priority matching engine written in JS.
  // Bot orders and the user's own orders live in the SAME book, so individual
  // BUY/SELL orders really rest, match, fill, and change cash/holdings/history.
  // Account state is kept in sessionStorage so it survives page changes.
  const now = () => Math.floor(Date.now() / 1000);
  const r2 = (n) => Math.round(n * 100) / 100;
  const START = { AAPL: 151, MSFT: 412, TSLA: 248, GOOG: 171, AMZN: 185, NVDA: 120 };
  const KEY = 'tradex-mock';
  const money = (n) => (TX.fmt ? TX.fmt.money(n) : '$' + n.toFixed(2));

  function seed() {
    const hold = { AAPL: { qty: 300, avg: 149.8 }, TSLA: { qty: 50, avg: 240.1 }, MSFT: { qty: 20, avg: 415 } };
    const eq = 50000 + 300 * 151 + 50 * 248 + 20 * 412;
    return {
      cash: 50000, holdings: hold, last: {}, nextId: 2000, tradeId: 100, seq: 10, startEquity: eq,
      orders: [
        { id: 1042, owner: 'me', symbol: 'AAPL', side: 'BUY', price: 150.5, qty: 100, remaining: 60, seq: 1 },
        { id: 1051, owner: 'me', symbol: 'AAPL', side: 'SELL', price: 153.5, qty: 200, remaining: 200, seq: 2 },
        { id: 1063, owner: 'me', symbol: 'TSLA', side: 'BUY', price: 247.5, qty: 30, remaining: 30, seq: 3 },
        { id: 1074, owner: 'me', symbol: 'MSFT', side: 'SELL', price: 415.5, qty: 10, remaining: 10, seq: 4 },
        { id: 1085, owner: 'me', symbol: 'MSFT', side: 'BUY', price: 410.5, qty: 10, remaining: 10, seq: 5 },
        { id: 1096, owner: 'me', symbol: 'TSLA', side: 'SELL', price: 250.5, qty: 20, remaining: 20, seq: 6 },
        { id: 1107, owner: 'me', symbol: 'GOOG', side: 'BUY', price: 149.5, qty: 50, remaining: 50, seq: 7 },
      ],
      trades: [{ id: 99, order_id: 1042, ts: now() - 600, symbol: 'AAPL', price: 150.5, qty: 40, side: 'BUY' }], log: [],
      series: Array.from({ length: 30 }, (_, i) => [now() - (30 - i) * 3600, r2(eq - (29 - i) * 35 + (i < 29 ? Math.sin(i) * 150 : 0))]),
    };
  }
  let S;
  try { S = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { S = null; }
  S = S || seed();
  S.stocks = S.stocks || []; // user-created stocks: {symbol,name,owner,supply,price}
  const stockOf = (sym) => S.stocks.find((x) => x.symbol === sym);
  const known = (sym) => !!START[sym] || !!stockOf(sym);
  const base = (sym) => START[sym] || (stockOf(sym) ? stockOf(sym).price : 0);
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full */ } };

  // ---- order book: bids high->low, asks low->high, FIFO (seq) inside a price ----
  const books = {};
  const mine = (o) => o.owner === 'me';
  const byTime = (a, b) => a.seq - b.seq;
  function addResting(b, o) {
    const side = o.side === 'BUY' ? b.bids : b.asks;
    side.push(o);
    side.sort(o.side === 'BUY' ? (x, y) => y.price - x.price || byTime(x, y) : (x, y) => x.price - y.price || byTime(x, y));
  }
  function levels(arr) {
    const out = [];
    for (const o of arr) {
      const l = out[out.length - 1];
      if (l && l[0] === o.price) l[1] += o.remaining;
      else { if (out.length === 12) break; out.push([o.price, o.remaining]); }
    }
    return out;
  }
  const view = (b) => ({ symbol: b.symbol, bids: levels(b.bids), asks: levels(b.asks), last: b.last });

  // a trade at the resting order's price; updates account when one side is the user
  function settle(o, price, q) {
    const h = S.holdings[o.symbol] || (S.holdings[o.symbol] = { qty: 0, avg: 0 });
    if (o.side === 'BUY') { S.cash = r2(S.cash - price * q); h.avg = (h.avg * h.qty + price * q) / (h.qty + q); h.qty += q; }
    else { S.cash = r2(S.cash + price * q); h.qty -= q; if (h.qty <= 0) delete S.holdings[o.symbol]; }
    S.trades.unshift({ id: S.tradeId++, order_id: o.id, ts: now(), symbol: o.symbol, price, qty: q, side: o.side });
    if (S.trades.length > 200) S.trades.length = 200;
  }

  // match an incoming order (price null = market) against the opposite side; returns events in `out`
  function execute(b, o, out) {
    const opp = o.side === 'BUY' ? b.asks : b.bids;
    while (o.remaining > 0 && opp.length) {
      const r = opp[0];
      if (o.price != null && (o.side === 'BUY' ? r.price > o.price : r.price < o.price)) break;
      const q = Math.min(o.remaining, r.remaining);
      o.remaining -= q; r.remaining -= q; b.last = r.price;
      out.push({ type: 'trade', symbol: b.symbol, price: r.price, qty: q, side: o.side, ts: now(), mine: mine(o) || mine(r) });
      if (mine(o)) settle(o, r.price, q);
      if (mine(r)) {
        settle(r, r.price, q);
        updateOrderActivity(r.id, r.remaining);
        out.push({ type: 'fill', order_id: r.id, remaining: r.remaining });
        if (r.remaining === 0) S.orders.splice(S.orders.indexOf(r), 1);
      }
      if (r.remaining === 0) opp.shift();
    }
  }

  // bots cancel and re-quote 12 levels each side around the mid price
  function quote(b, out) {
    b.bids = b.bids.filter(mine); b.asks = b.asks.filter(mine);
    // company stocks: 12 deep levels, 0.50 apart. User stocks: 5 thin levels, 0.5% apart (simulated community traders)
    const step = b.user ? Math.max(0.01, r2(b.mid * 0.005)) : 0.5, n = b.user ? 5 : 12;
    for (let i = 0; i < n; i++) {
      [['BUY', b.mid - step / 2 - i * step], ['SELL', b.mid + step / 2 + i * step]].forEach((s) => {
        const q = b.user ? Math.round(10 + Math.random() * 50) : Math.round(100 + Math.random() * 500);
        const o = { owner: 'bot', symbol: b.symbol, side: s[0], price: r2(s[1]), qty: q, remaining: q, seq: ++S.seq };
        execute(b, o, out);
        if (o.remaining > 0) addResting(b, o);
      });
    }
  }
  function book(sym, mid, out) {
    let b = books[sym];
    if (!b) {
      b = books[sym] = { symbol: sym, bids: [], asks: [], mid: mid || S.last[sym] || base(sym) || 100, last: 0, user: !START[sym] };
      b.last = r2(b.mid);
      S.orders.filter((o) => o.symbol === sym).forEach((o) => addResting(b, o)); // my open orders go back in the book
      quote(b, out || []);
    } else if (mid) { b.mid = mid; }
    return b;
  }

  // dry run: how much would this order trade, at what cost, and does it touch my own order?
  function simulate(b, side, price, qty) {
    const opp = side === 'BUY' ? b.asks : b.bids;
    let left = qty, cost = 0, hitsMine = false;
    for (const r of opp) {
      if (!left || (price != null && (side === 'BUY' ? r.price > price : r.price < price))) break;
      const t = Math.min(left, r.remaining);
      cost += t * r.price; left -= t; if (mine(r)) hitsMine = true;
    }
    return { cost, filled: qty - left, hitsMine };
  }

  S.log = S.log || [];
  const loggedOrderIds = new Set(S.log.map((entry) => entry.id).filter((id) => id != null));
  let addedOrderActivity = false;
  S.orders.forEach((o) => {
    if (loggedOrderIds.has(o.id)) return;
    const filled = o.qty - o.remaining;
    S.log.unshift({
      ts: now(), id: o.id, symbol: o.symbol, side: o.side, type: 'LIMIT', price: o.price, qty: o.qty,
      status: filled ? 'PARTIALLY_FILLED' : 'OPEN', note: filled + ' filled',
    });
    loggedOrderIds.add(o.id);
    addedOrderActivity = true;
  });
  if (addedOrderActivity) {
    if (S.log.length > 200) S.log.length = 200;
    save();
  }
  const logEv = (o) => { S.log.unshift(Object.assign({ ts: now() }, o)); if (S.log.length > 200) S.log.length = 200; };
  function updateOrderActivity(orderId, remaining) {
    const entry = S.log.find((item) => item.id === orderId);
    if (!entry) return;
    const filled = entry.qty - remaining;
    entry.ts = now();
    entry.status = remaining ? 'PARTIALLY_FILLED' : 'FILLED';
    entry.note = filled + ' filled';
  }
  function placeOrder(body) {
    try { return placeOrderInner(body); }
    catch (e) {
      logEv({ id: null, symbol: body.symbol || '-', side: body.side || '-', type: (body.orderType || body.type) === 'MARKET' ? 'MARKET' : 'LIMIT', price: body.price || null, qty: (body.quantity != null ? body.quantity : body.qty) || 0, status: 'REJECTED', note: e.message });
      save(); throw e;
    }
  }
  function placeOrderInner(body) {
    const sym = body.symbol, side = body.side, type = (body.orderType || body.type) === 'MARKET' ? 'MARKET' : 'LIMIT', qty = body.quantity != null ? body.quantity : body.qty;
    if (!known(sym)) throw new Error('Unknown symbol');
    if (side !== 'BUY' && side !== 'SELL') throw new Error('Side must be BUY or SELL');
    if (!Number.isInteger(qty) || qty <= 0) throw new Error('Quantity must be a whole number');
    const price = type === 'LIMIT' ? r2(body.price) : null;
    if (type === 'LIMIT' && !(price > 0)) throw new Error('Price must be greater than 0');

    const b = book(sym), sim = simulate(b, side, price, qty), open = S.orders.filter((o) => o.symbol === sym);
    if (type === 'MARKET' && sim.filled === 0) throw new Error(side === 'BUY' ? 'No sellers in the book' : 'No buyers in the book');
    if (side === 'BUY') {
      const reserved = S.orders.filter((o) => o.side === 'BUY').reduce((t, o) => t + o.remaining * o.price, 0);
      const need = type === 'LIMIT' ? price * qty : sim.cost, free = S.cash - reserved;
      if (need > free + 1e-9) throw new Error('Insufficient funds: need ' + money(need) + ', available ' + money(Math.max(0, free)));
    } else {
      const owned = S.holdings[sym] ? S.holdings[sym].qty : 0;
      const free = owned - open.filter((o) => o.side === 'SELL').reduce((t, o) => t + o.remaining, 0);
      if (qty > free) throw new Error('Not enough shares: you can sell ' + Math.max(0, free) + ' ' + sym);
    }

    if (sim.hitsMine) throw new Error('This would trade against your own open order. Cancel it or change the price.');

    const o = { id: S.nextId++, owner: 'me', symbol: sym, side, price, qty, remaining: qty, seq: ++S.seq };
    const out = [];
    execute(b, o, out);
    const filled = qty - o.remaining;
    let status = o.remaining === 0 ? 'FILLED' : filled ? 'PARTIALLY_FILLED' : 'OPEN';
    if (o.remaining > 0 && type === 'LIMIT') { addResting(b, o); S.orders.push(o); } // rest in the book (price-time priority)
    else if (o.remaining > 0) status = 'PARTIALLY_FILLED'; // market order: unfilled part is cancelled
    out.push(Object.assign({ type: 'book' }, view(b)));
    S.last[sym] = b.last; save();
    out.forEach((e) => TX.market && TX.market.inject(e));
    logEv({ id: o.id, symbol: sym, side, type, price, qty, status, note: filled + ' filled' + (type === 'MARKET' && o.remaining > 0 ? ', rest cancelled' : '') }); save();
    return { order_id: o.id, status, filled };
  }

  function cancelOrder(id) {
    const o = S.orders.find((x) => x.id === id);
    if (!o) throw new Error('Order not found');
    S.orders.splice(S.orders.indexOf(o), 1);
    logEv({ id: o.id, symbol: o.symbol, side: o.side, type: 'LIMIT', price: o.price, qty: o.qty, status: 'CANCELLED', note: o.remaining + ' unfilled' });
    const b = books[o.symbol];
    if (b) { b.bids = b.bids.filter((x) => x !== o); b.asks = b.asks.filter((x) => x !== o); if (TX.market) TX.market.inject(Object.assign({ type: 'book' }, view(b))); }
    save();
    return { ok: true };
  }

  function portfolio() {
    const last = (s) => (books[s] ? books[s].last : S.last[s] || base(s) || 0);
    const holdings = Object.keys(S.holdings).map((s) => ({ symbol: s, qty: S.holdings[s].qty, avg_price: r2(S.holdings[s].avg), last: last(s) }));
    const value = r2(S.cash + holdings.reduce((t, h) => t + h.qty * h.last, 0));
    const t = now();
    if (t - S.series[S.series.length - 1][0] > 10) { S.series.push([t, value]); if (S.series.length > 200) S.series.shift(); save(); }
    return { cash: S.cash, value, pnl_today: r2(value - S.startEquity), holdings, pnl_series: S.series };
  }

  const stockList = () => Object.keys(START).map((x) => ({ symbol: x, name: NAMES[x] || x, owner: null, user: false, price: S.last[x] || START[x] }))
    .concat(S.stocks.map((x) => ({ symbol: x.symbol, name: x.name, owner: x.owner, user: true, price: S.last[x.symbol] || x.price })));

  // A user lists their own stock: they own all `supply` shares and can then SELL them to other traders.
  function createStock(body) {
    const sym = String(body.symbol || '').toUpperCase(), name = String(body.name || '').trim(), supply = body.supply, price = r2(body.price);
    const me = (TX.auth && TX.auth.get() && TX.auth.get().username) || 'you';
    if (!/^[A-Z]{3,5}$/.test(sym)) throw new Error('Ticker must be 3-5 letters');
    if (known(sym)) throw new Error('Ticker ' + sym + ' is already taken');
    if (name.length < 2 || name.length > 40) throw new Error('Name must be 2-40 characters');
    if (!Number.isInteger(supply) || supply < 100 || supply > 1000000) throw new Error('Total shares must be a whole number from 100 to 1,000,000');
    if (!(price > 0 && price < 1e6)) throw new Error('Starting price must be greater than 0');
    if (S.stocks.filter((x) => x.owner === me).length >= 3) throw new Error('You can list at most 3 stocks');
    S.stocks.push({ symbol: sym, name, owner: me, supply, price });
    S.holdings[sym] = { qty: supply, avg: price }; // the founder starts with every share
    S.last[sym] = price; save();
    return { symbol: sym, name, owner: me, user: true, price };
  }

  // Fake live feed: bots move the price and re-quote; the user's resting orders fill when the market reaches them.
  TX.startMockFeed = (symbol, emit, from) => {
    const first = [], b = book(symbol, from, first);
    emit(Object.assign({ type: 'snapshot' }, view(b)));
    first.forEach(emit);
    let n = 0;
    const id = setInterval(() => {
      n++;
      const ev = [];
      b.mid = Math.max(b.user ? 0.01 : 10, b.mid + (Math.random() - 0.5) * (b.user ? b.mid * 0.004 : 0.6));
      quote(b, ev);
      // background flow: busy for company stocks, an occasional small trade for user stocks so the feed/chart is never empty
      if (!b.user || n % 8 === 0) ev.push({ type: 'trade', symbol, price: r2(b.mid), qty: b.user ? Math.round(1 + Math.random() * 15) : Math.round(10 + Math.random() * 300), side: Math.random() > 0.5 ? 'BUY' : 'SELL', ts: now() });
      const filled = ev.some((e) => e.type === 'fill');
      if (n % 2 === 0 || filled) ev.push(Object.assign({ type: 'book' }, view(b)));
      ev.forEach(emit);
      if (filled || n % 10 === 0) { S.last[symbol] = b.last; save(); }
    }, 300);
    return () => clearInterval(id);
  };

  const NAMES = { AAPL: 'Apple Inc.', MSFT: 'Microsoft Corp.', TSLA: 'Tesla Inc.', GOOG: 'Alphabet Inc.', AMZN: 'Amazon.com Inc.', NVDA: 'NVIDIA Corp.' };
  const receipt = (t) => ({ receipt_id: t.id, receipt_number: 'RC-' + String(t.id).padStart(6, '0'), trade_id: t.id, order_id: t.order_id, ts: t.ts, symbol: t.symbol, side: t.side, price: t.price, qty: t.qty, total: r2(t.price * t.qty) });
  function quotes() {
    return stockList().map((s) => { const last = books[s.symbol] ? books[s.symbol].last : S.last[s.symbol] || s.price, open = base(s.symbol) || last;
      return { symbol: s.symbol, name: s.name, last, change_pct: r2((last / open - 1) * 100), volume: 40000 + ((s.symbol.charCodeAt(0) * 977) % 60000) }; });
  }
  function candles(sym) { // 60 one-minute candles ending at the current price (simulated history)
    let p = books[sym] ? books[sym].last : S.last[sym] || base(sym) || 100; const out = [];
    for (let i = 0; i < 60; i++) { const c = p, o = r2(c * (1 + (Math.random() - 0.5) * 0.004));
      out.unshift({ t: now() - i * 60, o, h: r2(Math.max(o, c) * 1.001), l: r2(Math.min(o, c) * 0.999), c, v: Math.round(1000 + Math.random() * 5000) }); p = o; }
    return out;
  }

  // Fake REST backend, used when TX.USE_MOCK = true
  TX.mock = async (method, path, body) => {
    await new Promise((r) => setTimeout(r, 120));
    const [route, qs] = path.split('?');
    const q = new URLSearchParams(qs || '');
    if (route === '/login' || route === '/register') {
      if (!body || !body.username) throw new Error('Invalid username or password');
      return { token: 'mock-token', username: body.username, account_id: 'ACC-MOCK01' };
    }
    if (route === '/password') return { ok: true };
    if (route === '/stocks' && method === 'POST') return createStock(body || {});
    if (route === '/stocks') return stockList();
    if (route.startsWith('/book/')) { const b = book(route.slice(6)); return view(b); }
    if (route === '/order' && method === 'POST') return placeOrder(body || {});
    if (route.startsWith('/order/') && method === 'DELETE') return cancelOrder(+route.slice(7));
    if (route === '/orders')
      return S.orders.map((o) => ({ id: o.id, symbol: o.symbol, side: o.side, price: o.price, qty: o.qty, remaining: o.remaining })).sort((a, c) => a.id - c.id);
    if (route === '/portfolio') return portfolio();
    if (route === '/orderlog') return S.log;
    if (route === '/metrics') return mockMetrics();
    if (route === '/trades')
      return S.trades.filter((t) => (!q.get('symbol') || t.symbol === q.get('symbol')) && (!q.get('side') || t.side === q.get('side')));
    if (route === '/quotes') return quotes();
    if (route.startsWith('/candles/')) return candles(route.slice(9));
    if (route === '/receipts') return S.trades.map(receipt);
    if (route.startsWith('/receipts/')) { const t = S.trades.find((x) => x.id === +route.slice(10)); if (!t) throw new Error('Receipt not found'); return receipt(t); }
    throw new Error('Mock: unknown route ' + route);
  };
  // Simulated engine counters (the real numbers come from the C++ engine). Uptime survives page changes.
  let mm = { rate: 46000, lat: 2.4 };
  function mockMetrics() {
    let t0 = +sessionStorage.getItem('tradex-metrics-start');
    if (!t0) { t0 = Date.now(); try { sessionStorage.setItem('tradex-metrics-start', t0); } catch (e) { /* ignore */ } }
    const up = (Date.now() - t0) / 1000;
    mm.rate = Math.max(30000, Math.min(60000, mm.rate + (Math.random() - 0.5) * 3000));
    mm.lat = Math.max(1, Math.min(6, mm.lat + (Math.random() - 0.5) * 0.3));
        const total = Math.floor(50000 + up * 46000), lat = mm.lat * 0.5;
    return { uptime_s: up, orders_total: total, trades_total: Math.floor(total * 0.37), orders_per_sec: mm.rate,
             avg_match_us: lat, p50_match_us: lat * 0.8, p95_match_us: lat * 2.6, p99_match_us: lat * 4.2, max_match_us: lat * 600,
             ram_bytes: Math.min(300, 28 + (total / 50000) * 4.2) * 1048576, open_orders: 1800 + Math.floor(Math.random() * 400),
             bench_ram_us: lat, bench_db_us: 900 + Math.random() * 200 };
  }
  TX.mockReset = () => { try { sessionStorage.removeItem('tradex-metrics-start'); sessionStorage.removeItem('tradex-rtt'); sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ } };
})();
