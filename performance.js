(function () {
  if (!TX.layout.init()) return;
  const F = TX.fmt, $ = TX.$, MAX = 120, ops = [], p99 = [], ram = [];
  const card = (k, v, sub) => `<div class="card"><h3>${k}</h3><div class="big">${v}</div>${sub ? `<div class="muted" style="font-size:11px">${sub}</div>` : ''}</div>`;
  const dur = (s) => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + 'h ' : '') + m + 'm ' + (s % 60) + 's'; };
  const bar = (l, v, mx, c) => `<div class="cmp"><span>${l}</span><b class="${c}" style="width:${Math.max(2, (v / mx) * 45)}%"></b><span>${F.us(v)}</span></div>`;

  function draw(m) {
    const open = m.open_orders != null ? m.open_orders : m.resting_orders;
    $('#pstats').innerHTML = [card('Orders / second', F.qty(Math.round(m.orders_per_sec)), 'matching throughput'), card('p50 latency', F.us(m.p50_match_us), 'typical order'),
      card('p95 latency', F.us(m.p95_match_us), '95% of orders are faster'), card('p99 latency', F.us(m.p99_match_us), '99% of orders are faster')].join('');
    $('#pstats2').innerHTML = [card('Average latency', F.us(m.avg_match_us), 'can hide slow outliers'), card('Max latency', F.us(m.max_match_us), 'slowest single order'),
      card('RAM used', F.mb(m.ram_bytes), 'resident memory of the engine'), card('Open orders', F.qty(open), 'resting in all books')].join('');
    $('#pstats3').innerHTML = [card('Orders processed', F.qty(m.orders_total), 'since engine start'), card('Trades executed', F.qty(m.trades_total)),
      card('Fill ratio', m.orders_total ? ((m.trades_total / m.orders_total) * 100).toFixed(1) + '%' : '-', 'trades per order'), card('Engine uptime', dur(m.uptime_s))].join('');
    const b = $('#bench');
    if (m.bench_ram_us != null && m.bench_db_us != null) {
      const mx = Math.max(m.bench_ram_us, m.bench_db_us);
      b.style.display = 'block';
      b.innerHTML = '<h3>Why RAM? Matching in memory vs a database write on every trade</h3>' + bar('In RAM (this engine)', m.bench_ram_us, mx, '') + bar('With a DB write per trade', m.bench_db_us, mx, 'db') +
        '<div class="muted" style="font-size:11px">Time per order from the engine benchmark.</div>';
    } else b.style.display = 'none';
  }
  function charts() {
    TX.charts.line($('#opsChart'), ops.map((v) => v / 1000), { unit: 'k/s', name: 'Orders' });
    TX.charts.line($('#latChart'), p99, { color: '#f59e0b', unit: ' \u00b5s', name: 'p99' });
    TX.charts.line($('#ramChart'), ram, { color: '#8b5cf6', unit: ' MB', name: 'RAM' });
    TX.charts.line($('#rttChart'), TX.perf.rtt.map((r) => r.ms), { color: '#3b82f6', unit: ' ms', name: 'Round trip' });
  }
  async function tick() {
    try {
      const m = await TX.getMetrics();
      ops.push(m.orders_per_sec); p99.push(m.p99_match_us); ram.push(m.ram_bytes / 1048576);
      if (ops.length > MAX) { ops.shift(); p99.shift(); ram.shift(); }
      $('#note').style.display = 'none';
      draw(m);
    } catch (e) {
      $('#pstats').innerHTML = ''; $('#pstats2').innerHTML = ''; $('#pstats3').innerHTML = '';
      $('#note').style.display = 'block';
      $('#note').innerHTML = 'Engine metrics are not available: ' + TX.esc(e.message) + '. The backend needs <span class="mono">GET /metrics</span> (see AGENT_CONTEXT.md, section 10).';
    }
    charts();
  }
  $('#src').textContent = TX.USE_MOCK ? 'MOCK DATA (simulated numbers, not from the C++ engine)' : 'live from the C++ engine';
  window.addEventListener('resize', charts);
  tick(); setInterval(tick, 1000);
})();
