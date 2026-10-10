(function () {
  // Round-trip time (ms) of my own POST /order calls, kept for the Performance page (last 60, survives page changes)
  TX.perf = { rtt: [] };
  try { TX.perf.rtt = JSON.parse(sessionStorage.getItem('tradex-rtt')) || []; } catch (e) { TX.perf.rtt = []; }
  const recordRtt = (ms) => {
    TX.perf.rtt.push({ t: Math.floor(Date.now() / 1000), ms: +ms.toFixed(2) });
    if (TX.perf.rtt.length > 60) TX.perf.rtt.shift();
    try { sessionStorage.setItem('tradex-rtt', JSON.stringify(TX.perf.rtt)); } catch (e) { /* storage full */ }
  };

  // The ONLY place that talks to the backend. Throws Error(message) on failure.
  TX.api = async (method, path, body) => {
    if (TX.USE_MOCK) return TX.mock(method, path, body);
    const token = TX.auth.token;
    const res = await fetch(TX.API_BASE + path, {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) TX.auth.logout();
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
    return data;
  };

  TX.login = (username, password) => TX.api('POST', '/login', { username, password });
  TX.register = (username, password) => TX.api('POST', '/register', { username, password });
  TX.changePassword = (old_password, new_password) => TX.api('POST', '/password', { old_password, new_password });
  TX.placeOrder = async (o) => {                                   // {symbol, side, price, qty}
    const t0 = performance.now();
    try { return await TX.api('POST', '/order', o); } finally { recordRtt(performance.now() - t0); }
  };
  TX.cancelOrder = (id) => TX.api('DELETE', '/order/' + id);
  TX.getOrders = () => TX.api('GET', '/orders');
  TX.getBook = (symbol) => TX.api('GET', '/book/' + symbol);
  TX.getTrades = (p) => {
    const q = new URLSearchParams();
    if (p && p.symbol) q.set('symbol', p.symbol);
    if (p && p.side) q.set('side', p.side);
    return TX.api('GET', '/trades?' + q.toString());
  };
  TX.getStocks = () => TX.api('GET', '/stocks');
  TX.createStock = (s) => TX.api('POST', '/stocks', s);     // {symbol,name,supply,price}
  TX.getOrderLog = () => TX.api('GET', '/orderlog');           // NEW: [{ts,id,symbol,side,type,price,qty,status,note}]
  TX.getMetrics = () => TX.api('GET', '/metrics');            // NEW: engine speed counters (see AGENT_CONTEXT 5d)
  TX.getPortfolio = () => TX.api('GET', '/portfolio');

  // ---- final-merge additions: tolerant response mapping + /quotes /candles /receipts ----
  const nq = (o) => Object.assign({}, o, { qty: o.qty != null ? o.qty : o.quantity, remaining: o.remaining != null ? o.remaining : o.remaining_quantity,
    type: o.type || o.order_type, status: o.status === 'PARTIAL' ? 'PARTIALLY_FILLED' : o.status });
  const gO = TX.getOrders, gT = TX.getTrades, gL = TX.getOrderLog, gS = TX.getStocks;
  TX.getOrders = async () => (await gO()).map(nq);
  TX.getTrades = async (p) => (await gT(p)).map(nq);
  TX.getOrderLog = async () => (await gL()).map(nq);
  // /stocks (user-listed stocks) is optional; fall back to /quotes for the symbol list
  TX.getStocks = async () => { try { return await gS(); } catch (e) { return (await TX.api('GET', '/quotes')).map((x) => ({ symbol: x.symbol, name: x.name, owner: null, user: false, price: x.last })); } };
  TX.getQuotes = () => TX.api('GET', '/quotes');                                   // [{symbol,name,last,change_pct,volume}]
  TX.getCandles = (symbol, tf) => TX.api('GET', '/candles/' + symbol + '?tf=' + (tf || '1m')); // [{t,o,h,l,c,v}] oldest first
  TX.getReceipts = async () => (await TX.api('GET', '/receipts')).map(nq);         // [{receipt_id,receipt_number,trade_id,ts,symbol,side,price,qty,total}]
})();
