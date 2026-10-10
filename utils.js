(function () {
  TX.$ = (s, r) => (r || document).querySelector(s);
  TX.NAMES = { AAPL: 'Apple Inc.', MSFT: 'Microsoft Corp.', TSLA: 'Tesla Inc.', GOOG: 'Alphabet Inc.', AMZN: 'Amazon.com Inc.', NVDA: 'NVIDIA Corp.' };
  TX.nameOf = (s) => { const x = (TX.STOCKS || []).find((y) => y.symbol === s); return x && x.name && x.name !== s ? x.name : (TX.NAMES[s] || ''); };
  TX.chartRange = {
    get() {
      const value = localStorage.getItem('tradex-chart-range');
      return ['60', '300', 'all'].includes(value) ? value : 'all';
    },
    set(value) {
      if (!['60', '300', 'all'].includes(value)) throw new Error('Invalid chart range');
      localStorage.setItem('tradex-chart-range', value);
    },
    filter(points) {
      const range = this.get();
      if (range === 'all') return points;
      const cutoff = Math.floor(Date.now() / 1000) - Number(range);
      return points.filter((point) => point.t >= cutoff);
    },
  };
  // Tradable stocks = 6 company stocks + stocks listed by users. Cached per session, refreshed by layout.js from GET /stocks.
  TX.COMPANY = ['AAPL', 'MSFT', 'TSLA', 'GOOG', 'AMZN', 'NVDA'];
  TX.setStocks = (list) => {
    TX.STOCKS = list; TX.SYMBOLS = list.map((s) => s.symbol);
    try { sessionStorage.setItem('tradex-stocks', JSON.stringify(list)); } catch (e) { /* storage full */ }
  };
  TX.isUserStock = (sym) => !!(TX.STOCKS || []).find((s) => s.symbol === sym && s.user);
  let cached = null;
  try { cached = JSON.parse(sessionStorage.getItem('tradex-stocks')); } catch (e) { cached = null; }
  TX.setStocks(Array.isArray(cached) && cached.length ? cached : TX.COMPANY.map((s) => ({ symbol: s, name: s, owner: null, user: false })));

  // Escape backend text before putting it into innerHTML
  TX.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  TX.fmt = {
    price: (n) => Number(n).toFixed(2),
    qty: (n) => Number(n).toLocaleString('en-US'),
    money: (n) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' }),
    signed: (n) => (n >= 0 ? '+' : '-') + Math.abs(Number(n)).toFixed(2),
    pct: (n) => (n >= 0 ? '+' : '-') + Math.abs(Number(n)).toFixed(2) + '%',
    us: (n) => (Number(n) < 1000 ? Number(n).toFixed(2) + ' \u00b5s' : (Number(n) / 1000).toFixed(2) + ' ms'),
    mb: (b) => (Number(b) / 1048576).toFixed(1) + ' MB',
    time: (ts) => new Date(ts * 1000).toLocaleTimeString('en-GB'),       // ts = unix seconds
    dateTime: (ts) => new Date(ts * 1000).toLocaleString('en-GB'),
  };

  // Each validator returns an error message, or null when the value is valid
  TX.validate = {
    username: (u) => (/^[a-zA-Z0-9_]{3,20}$/.test(u) ? null : 'Username: 3-20 letters, numbers or _'),
    password: (p) => (p.length >= 8 && /\d/.test(p) && /[a-zA-Z]/.test(p) ? null : 'Password: min 8 characters, letters and digits'),
    price: (p) => (isFinite(p) && p > 0 && p < 1e6 ? null : 'Price must be greater than 0'),
    ticker: (t) => (/^[A-Z]{3,5}$/.test(t) ? null : 'Ticker: 3-5 capital letters'),
    stockName: (n) => (n.length >= 2 && n.length <= 40 ? null : 'Name: 2-40 characters'),
    supply: (n) => (Number.isInteger(n) && n >= 100 && n <= 1e6 ? null : 'Total shares: whole number, 100 to 1,000,000'),
    qty: (q) => (Number.isInteger(q) && q > 0 && q <= 1e6 ? null : 'Quantity must be a whole number'),
  };

  TX.toast = (msg, kind) => {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    const d = document.createElement('div');
    d.className = 'toast ' + (kind || 'ok');
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 3000);
  };

  // cols: [{label, right?, render(row) -> html string}]. Escape user data inside render() with TX.esc().
  TX.table = (cols, rows, empty) => {
    const head = cols.map((c) => `<th class="${c.right ? 'r' : ''}${c.label ? ' sortable' : ''}">${c.label}</th>`).join('');
    const body = rows.length
      ? rows.map((r) => '<tr>' + cols.map((c) => `<td class="${c.right ? 'r' : ''}">${c.render(r)}</td>`).join('') + '</tr>').join('')
      : `<tr><td colspan="${cols.length}" class="empty">${empty || 'No data'}</td></tr>`;
    return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  };
  TX.interactiveTable = (container, cols, empty) => {
    let rows = [], query = '', sortIndex = -1, sortDirection = 1;
    container.innerHTML = '<div class="table-tools"><input type="search" data-table-search placeholder="Search rows..." aria-label="Search table">' +
      '<span class="muted" data-table-count></span></div><div data-table-content></div>';
    const content = container.querySelector('[data-table-content]');
    const count = container.querySelector('[data-table-count]');

    function visibleRows() {
      const result = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query));
      if (sortIndex >= 0) {
        const getValue = cols[sortIndex].sortValue;
        result.sort((a, b) => {
          const left = getValue ? getValue(a) : '';
          const right = getValue ? getValue(b) : '';
          if (typeof left === 'number' && typeof right === 'number') return (left - right) * sortDirection;
          return String(left).localeCompare(String(right), undefined, { numeric: true }) * sortDirection;
        });
      }
      return result;
    }

    function render() {
      const shown = visibleRows();
      const sortable = cols.map((col, index) => ({
        ...col,
        label: col.sortValue
          ? `<button class="table-sort" data-sort="${index}">${col.label}${sortIndex === index ? (sortDirection === 1 ? ' ↑' : ' ↓') : ''}</button>`
          : col.label,
      }));
      content.innerHTML = TX.table(sortable, shown, empty);
      count.textContent = shown.length + ' of ' + rows.length;
    }

    container.querySelector('[data-table-search]').addEventListener('input', (event) => {
      query = event.target.value.trim().toLowerCase();
      render();
    });
    container.addEventListener('click', (event) => {
      const button = event.target.closest('[data-sort]');
      if (!button || !container.contains(button)) return;
      const index = Number(button.dataset.sort);
      if (!cols[index].sortValue) return;
      if (sortIndex === index) sortDirection *= -1;
      else { sortIndex = index; sortDirection = 1; }
      render();
    });

    return {
      setRows(nextRows) { rows = nextRows.slice(); render(); },
      getVisibleRows: visibleRows,
    };
  };
})();

// click a column header to sort that table (numbers sort as numbers, text as text)
document.addEventListener('click', (e) => {
  const th = e.target.closest('th.sortable');
  if (!th || th.querySelector('.table-sort')) return;
  const table = th.closest('table'), body = table.tBodies[0], i = th.cellIndex;
  const dir = th.classList.contains('asc') ? -1 : 1;
  table.querySelectorAll('th').forEach((x) => x.classList.remove('asc', 'desc'));
  th.classList.add(dir === 1 ? 'asc' : 'desc');
  const val = (r) => { const t = r.cells[i].textContent.replace(/[$,#+]/g, '').trim(), n = parseFloat(t); return isNaN(n) || /[a-z]/i.test(t.replace(/e/i, '')) ? t.toLowerCase() : n; };
  const rows = Array.from(body.rows).filter((r) => !r.cells[0].classList.contains('empty'));
  rows.sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * dir; }).forEach((r) => body.appendChild(r));
});
