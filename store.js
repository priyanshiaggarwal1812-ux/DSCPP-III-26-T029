(function () {
  // ---- session (kept in sessionStorage so it survives page changes) ----
  TX.auth = {
    get() { try { return JSON.parse(sessionStorage.getItem('tradex-auth')) || null; } catch (e) { return null; } },
    get token() { const a = this.get(); return a ? a.token : null; },
    isLoggedIn() { return !!this.token; },
    set(token, username, accountId) { sessionStorage.setItem('tradex-auth', JSON.stringify({ token, username, accountId })); },
    logout() { sessionStorage.removeItem('tradex-auth'); if (TX.mockReset) TX.mockReset(); location.href = 'login.html'; },
  };

  // ---- live market state + stream ----
  TX.market = {
    symbol: sessionStorage.getItem('tradex-symbol') || 'AAPL',
    book: null,      // {symbol,bids,asks,last}
    trades: [],      // newest first, max 50
    prices: [],      // [{t,price}] oldest first, max 300, one point per second
    status: 'OFFLINE', // LIVE | RECONNECTING | OFFLINE
    listeners: [], fills: [], buf: [], timer: null, stopFn: null,

    onFill(fn) { this.fills.push(fn); },          // called with {type:'fill', order_id, remaining}
    inject(e) { this.buf.push(e); },              // lets the mock backend push an event into the stream
    // keep the price history across page changes (per symbol, last 30 minutes)
    restore() {
      try {
        const a = JSON.parse(sessionStorage.getItem('tradex-prices-' + this.symbol)) || [], cut = Math.floor(Date.now() / 1000) - 1800;
        this.prices = a.filter((p) => p.t >= cut).slice(-300);
      } catch (e) { this.prices = []; }
      try { this.trades = (JSON.parse(sessionStorage.getItem('tradex-trades-' + this.symbol)) || []).slice(0, 50); } catch (e) { this.trades = []; }
    },
    persist() { try { sessionStorage.setItem('tradex-prices-' + this.symbol, JSON.stringify(this.prices)); sessionStorage.setItem('tradex-trades-' + this.symbol, JSON.stringify(this.trades)); } catch (e) { /* storage full */ } },

    subscribe(fn) { this.listeners.push(fn); },
    emit() { this.listeners.forEach((f) => f(this)); },
    setStatus(s) { this.status = s; this.emit(); },

    setSymbol(s) {
      this.symbol = s;
      sessionStorage.setItem('tradex-symbol', s);
      this.book = null; this.trades = []; this.prices = [];
      this.stop(); this.start(); this.emit();
    },

    apply(events) {
      let traded = false;
      for (const e of events) {
        if ((e.type === 'snapshot' || e.type === 'book') && e.symbol === this.symbol) {
          this.book = { symbol: e.symbol, bids: e.bids, asks: e.asks, last: e.last };
        } else if (e.type === 'trade' && e.symbol === this.symbol) {
          this.trades.unshift(e);
          if (this.trades.length > 50) this.trades.length = 50;
          const last = this.prices[this.prices.length - 1];
          if (last && last.t === e.ts) last.price = e.price;
          else { this.prices.push({ t: e.ts, price: e.price }); if (this.prices.length > 300) this.prices.shift(); }
          if (this.book) this.book.last = e.price;
          traded = true;
        } else if (e.type === 'fill') {
          this.fills.forEach((f) => f(e));
        }
      }
      if (traded) this.persist();
      this.emit();
    },

    start() {
      if (!TX.auth.isLoggedIn()) return;
      const symbol = this.symbol;
      if (!this.prices.length) this.restore();
      // still empty (first visit): seed the chart from GET /candles so history survives page changes
      if (!this.prices.length) TX.getCandles(symbol, '1m').then((c) => { if (this.symbol === symbol && !this.prices.length && Array.isArray(c)) { this.prices = c.slice(-300).map((k) => ({ t: k.t, price: k.c })); this.emit(); } }).catch(() => { /* optional endpoint */ });
      const push = (e) => this.buf.push(e);
      // batch: flush buffered events every 250 ms so a flood of bot trades cannot freeze the browser
      this.timer = setInterval(() => {
        if (this.buf.length) { const b = this.buf; this.buf = []; this.apply(b); }
      }, 250);
      if (TX.USE_MOCK) {
        this.setStatus('LIVE');
        const from = this.prices.length ? this.prices[this.prices.length - 1].price : undefined; // continue from the saved price
        this.stopFn = TX.startMockFeed(symbol, push, from);
      } else {
        const es = new EventSource(TX.API_BASE + '/stream?symbol=' + symbol + '&token=' + TX.auth.token);
        es.onopen = () => this.setStatus('LIVE');
        es.onerror = () => this.setStatus(es.readyState === 2 ? 'OFFLINE' : 'RECONNECTING'); // EventSource retries by itself
        es.onmessage = (m) => { try { push(JSON.parse(m.data)); } catch (e) { /* ignore bad event */ } };
        this.stopFn = () => es.close();
      }
    },

    stop() {
      clearInterval(this.timer);
      if (this.stopFn) this.stopFn();
      this.stopFn = null; this.buf = [];
    },
  };
  // ---- watch: quote for every symbol, built only from GET /book/:symbol ----
  // open/high/low are session values (first price seen, kept in sessionStorage across pages).
  TX.watch = {
    q: {}, listeners: [], timer: null,
    subscribe(fn) { this.listeners.push(fn); },
    load() { try { this.q = JSON.parse(sessionStorage.getItem('tradex-quotes')) || {}; } catch (e) { this.q = {}; } },
    async poll() {
      await Promise.all(TX.SYMBOLS.map(async (sym) => {
        try {
          const b = await TX.getBook(sym);
          const bid = b.bids[0], ask = b.asks[0], x = this.q[sym] || { open: b.last, high: b.last, low: b.last, hist: [] };
          x.last = b.last; x.high = Math.max(x.high, b.last); x.low = Math.min(x.low, b.last);
          x.bid = bid ? bid[0] : null; x.bidQty = bid ? bid[1] : 0; x.ask = ask ? ask[0] : null; x.askQty = ask ? ask[1] : 0;
          x.hist.push(b.last); if (x.hist.length > 40) x.hist.shift();
          this.q[sym] = x;
        } catch (e) { /* keep the previous quote */ }
      }));
      try { (await TX.getQuotes()).forEach((q) => { const x = this.q[q.symbol]; if (x && q.change_pct != null) x.open = q.last / (1 + q.change_pct / 100); }); } catch (e) { /* /quotes is optional */ }
      try { sessionStorage.setItem('tradex-quotes', JSON.stringify(this.q)); } catch (e) { /* ignore */ }
      this.listeners.forEach((f) => f(this.q));
    },
    start() { if (this.timer) return; this.load(); this.poll(); this.timer = setInterval(() => this.poll(), 2000); },
  };
})();
