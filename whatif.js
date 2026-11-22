(function () {
  if (!TX.layout.init()) return;
  const $ = TX.$, money = (n) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const pct = (n) => (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(2) + '%';
  const symbol = $('#symbol'), status = $('#status');
  symbol.innerHTML = TX.STOCKS.map((s) => `<option value="${TX.esc(s.symbol)}">${TX.esc(s.symbol)}${s.name ? ' · ' + TX.esc(s.name) : ''}</option>`).join('');
  symbol.value = TX.market.symbol;

  // ---------- simulated price history ----------
  // TradeX has no stored history, so we rebuild one. Every day's move is a pseudo-random number seeded by
  // (symbol, calendar day), so the same stock on the same date always gives the same result (repeatable, not random per click).
  // The path is a geometric random walk (drift + volatility per stock) that is scaled to END at today's live quote.
  const DAY = 86400000, ORIGIN = Date.UTC(2023, 0, 2);                        // history starts 2 Jan 2023
  const VOL = { AAPL: 0.28, MSFT: 0.26, TSLA: 0.6, GOOG: 0.3, AMZN: 0.33, NVDA: 0.55 }, DRIFT = 0.1;
  const dayIndex = (ms) => Math.floor((ms - ORIGIN) / DAY);
  const isoOf = (idx) => new Date(ORIGIN + idx * DAY).toISOString().slice(0, 10);
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rand(seed) { let t = (seed + 0x6D2B79F5) >>> 0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  function normal(seed) { const u = Math.max(rand(seed), 1e-9), v = rand(seed ^ 0x9E3779B9); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // returns array of prices, one per calendar day from ORIGIN to today, last element === currentPrice
  // Model: price(d) = trend(d) x exp(noise(d)). trend = steady yearly growth ending at today's quote.
  // noise = mean-reverting (Ornstein-Uhlenbeck) random shocks, so prices wander up and down around the trend but cannot drift
  // to absurd values (a plain random walk pinned to today's price gave -80% / +300% results over 3 years).
  function history(sym, currentPrice, lastIdx) {
    const sd = (VOL[sym] || 0.35) * 0.5, phi = Math.exp(-1 / 170), innov = sd * Math.sqrt(1 - phi * phi), h = hash(sym), dev = [0];
    for (let d = 1; d <= lastIdx; d++) {
      const dow = new Date(ORIGIN + d * DAY).getUTCDay();
      if (dow === 0 || dow === 6) { dev.push(dev[d - 1]); continue; }       // market closed: weekends keep Friday's price
      dev.push(dev[d - 1] * phi + innov * normal(h ^ Math.imul(d, 2654435761)));
    }
    return dev.map((x, d) => currentPrice * Math.exp(-DRIFT * (lastIdx - d) / 365 + x - dev[lastIdx]));
  }

  // ---------- inputs ----------
  const todayIso = new Date().toISOString().slice(0, 10), todayIdx = dayIndex(Date.parse(todayIso));
  $('#buyDate').max = todayIso; $('#buyDate').min = isoOf(0);
  const monthsAgo = (m) => { const d = new Date(todayIso); d.setUTCMonth(d.getUTCMonth() - m); return d.toISOString().slice(0, 10); };
  $('#buyDate').value = monthsAgo(12);
  document.querySelectorAll('#quick button').forEach((b) => b.addEventListener('click', () => { $('#buyDate').value = monthsAgo(+b.dataset.m); calculate(); }));

  // ---------- chart ----------
  const GREEN = '#22c55e', RED = '#ef4444', BLUE = '#3b82f6', MUTED = '#8a9bb8', GRID = '#1b2a47';
  function drawChart(canvas, dates, values, invested, hover) {
    const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    ctx.font = '11px system-ui, sans-serif';
    const n = values.length, all = values.concat([invested]);
    let min = Math.min.apply(null, all), max = Math.max.apply(null, all); const pad = (max - min) * 0.12 || 1; min -= pad; max += pad;
    const L = 8, R = 64, T = 10, B = 22, X = (i) => L + ((w - L - R) * i) / Math.max(1, n - 1), Y = (v) => T + (h - T - B) * (1 - (v - min) / (max - min));
    ctx.strokeStyle = GRID; ctx.fillStyle = MUTED; ctx.lineWidth = 1; ctx.textAlign = 'left';
    for (let k = 0; k <= 4; k++) { const v = min + ((max - min) * k) / 4, y = Y(v); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke(); ctx.fillText('$' + Math.round(v).toLocaleString('en-US'), w - R + 6, y + 4); }
    const ticks = Math.min(5, n - 1); ctx.textAlign = 'center';
    for (let k = 0; k <= ticks; k++) { const i = Math.round(((n - 1) * k) / Math.max(1, ticks)); ctx.fillText(dates[i].slice(2), Math.min(Math.max(X(i), 26), w - R - 10), h - 6); }
    const up = values[n - 1] >= invested, col = up ? GREEN : RED;
    ctx.setLineDash([5, 4]); ctx.strokeStyle = MUTED; ctx.beginPath(); ctx.moveTo(L, Y(invested)); ctx.lineTo(w - R, Y(invested)); ctx.stroke(); ctx.setLineDash([]);
    const g = ctx.createLinearGradient(0, T, 0, h - B); g.addColorStop(0, up ? 'rgba(34,197,94,.28)' : 'rgba(239,68,68,.28)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath(); values.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    ctx.lineTo(X(n - 1), h - B); ctx.lineTo(X(0), h - B); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    // buy marker + peak / trough markers
    const dot = (i, c) => { ctx.beginPath(); ctx.arc(X(i), Y(values[i]), 4, 0, 7); ctx.fillStyle = c; ctx.fill(); ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1.5; ctx.stroke(); };
    const iMax = values.indexOf(Math.max.apply(null, values)), iMin = values.indexOf(Math.min.apply(null, values));
    dot(0, BLUE); if (iMax > 0) dot(iMax, GREEN); if (iMin > 0) dot(iMin, RED);
    if (hover != null && hover >= 0 && hover < n) {
      const x = X(hover), y = Y(values[hover]); ctx.strokeStyle = MUTED; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, h - B); ctx.stroke(); dot(hover, '#fff');
      const diff = values[hover] - invested, text = `${dates[hover]}  ${money(values[hover])}  (${pct((diff / invested) * 100)})`;
      ctx.font = '12px system-ui, sans-serif'; const bw = ctx.measureText(text).width + 14, bx = Math.max(4, Math.min(x - bw / 2, w - bw - 4)), by = Math.max(4, y - 34);
      ctx.fillStyle = '#16223b'; ctx.strokeStyle = '#233252'; ctx.beginPath(); ctx.rect(bx, by, bw, 22); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e6edf7'; ctx.textAlign = 'left'; ctx.fillText(text, bx + 7, by + 15);
    }
  }
  let current = null;
  const canvas = $('#chart');
  const redraw = (hv) => { if (current) drawChart(canvas, current.dates, current.values, current.amount, hv); };
  canvas.addEventListener('mousemove', (e) => { if (!current) return; const r = canvas.getBoundingClientRect(), pw = r.width - 72; redraw(Math.round(Math.max(0, Math.min(1, (e.clientX - r.left - 8) / pw)) * (current.values.length - 1))); });
  canvas.addEventListener('mouseleave', () => redraw());
  window.addEventListener('resize', () => redraw());

  // ---------- calculate ----------
  async function calculate() {
    const amount = Number($('#investment').value), date = $('#buyDate').value, ticker = symbol.value;
    if (!date || !(amount > 0)) { status.textContent = 'Enter a purchase date and an investment amount.'; return; }
    if (date > todayIso) { status.textContent = 'Purchase date cannot be in the future.'; return; }
    if (date < isoOf(0)) { status.textContent = 'History starts on ' + isoOf(0) + '.'; return; }
    status.textContent = 'Building simulated price history…';
    try {
      const quotes = await TX.getQuotes(), q = (s) => { const x = Array.isArray(quotes) ? quotes.find((y) => y.symbol === s) : null; return x && Number(x.last); };
      const now = q(ticker); if (!(now > 0)) throw new Error('A current quote is not available for ' + ticker + '.');
      const start = dayIndex(Date.parse(date)), hist = history(ticker, now, todayIdx), buy = hist[start];
      const shares = amount / buy, slice = hist.slice(start), dates = slice.map((_, i) => isoOf(start + i)), values = slice.map((p) => p * shares);
      const value = values[values.length - 1], pnl = value - amount, ret = (pnl / amount) * 100, years = Math.max((todayIdx - start) / 365, 1 / 365);
      let peak = values[0], dd = 0, ddAt = 0; values.forEach((v, i) => { if (v > peak) peak = v; const d = (v - peak) / peak; if (d < dd) { dd = d; ddAt = i; } });
      const iMax = values.indexOf(Math.max.apply(null, values));
      $('#buyPrice').textContent = money(buy); $('#sharesTxt').textContent = shares.toFixed(4) + ' shares on ' + date;
      $('#currentValue').textContent = money(value); $('#curPrice').textContent = 'live TradeX quote ' + money(now);
      const pe = $('#pnl'); pe.textContent = (pnl >= 0 ? '+' : '−') + money(Math.abs(pnl)) + ' (' + pct(ret) + ')'; pe.className = pnl >= 0 ? 'positive' : 'negative';
      $('#cagr').textContent = years >= 0.25 ? (Math.pow(value / amount, 1 / years) - 1 >= 0 ? '+' : '−') + (Math.abs(Math.pow(value / amount, 1 / years) - 1) * 100).toFixed(1) + '% per year' : 'holding under 3 months';
      $('#maxDip').textContent = pct(dd * 100); $('#maxDip').className = dd < -0.001 ? 'negative' : ''; $('#maxDipTxt').textContent = dd < -0.001 ? 'low on ' + dates[ddAt] : 'never fell below a prior high';
      $('#peakTxt').innerHTML = '<span style="color:#3b82f6">●</span> buy &nbsp; <span style="color:#22c55e">●</span> best day ' + dates[iMax] + ' (' + money(values[iMax]) + ') &nbsp; <span style="color:#ef4444">●</span> lowest';
      $('#results').style.display = 'block';
      current = { dates, values, amount }; redraw();
      $('#cmp').innerHTML = TX.SYMBOLS.map((s) => {
        const c = q(s); if (!(c > 0)) return ''; const b = history(s, c, todayIdx)[start], v = (amount / b) * c, r = ((v - amount) / amount) * 100;
        return `<tr${s === ticker ? ' class="sel"' : ''}><td>${TX.esc(s)}</td><td>${money(b)}</td><td>${money(c)}</td><td>${money(v)}</td><td class="${r >= 0 ? 'positive' : 'negative'}">${pct(r)}</td></tr>`;
      }).join('');
      $('#details').textContent = `Prices before today are simulated, not real market data. For each stock, TradeX generates a repeatable daily price path (drift plus volatility, weekends flat) that ends at today's live quote from the matching engine. Same stock and same date always give the same buy price, and today's value moves with the live quote. Excludes brokerage, taxes, dividends and slippage.`;
      status.textContent = '';
    } catch (e) { status.textContent = e.message || 'Could not calculate the estimate.'; }
  }
  $('#calculate').addEventListener('click', calculate);
  ['investment', 'buyDate'].forEach((id) => $('#' + id).addEventListener('keydown', (e) => { if (e.key === 'Enter') calculate(); }));
  symbol.addEventListener('change', calculate);
  calculate();
})();
