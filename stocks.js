(function () {
  if (!TX.layout.init()) return;
  const F = TX.fmt, V = TX.validate, $ = TX.$;
  const me = (TX.auth.get() || {}).username;
  let busy = false;

  function render(list) {
    const cols = (user) => [
      { label: 'Ticker', render: (s) => TX.esc(s.symbol) },
      { label: 'Name', render: (s) => TX.esc(s.name) },
      user ? { label: 'Owner', render: (s) => (s.owner === me ? '<span class="t-buy">You</span>' : TX.esc(s.owner)) } : { label: '', render: () => '' },
      { label: 'Last', right: 1, render: (s) => (s.price ? F.price(s.price) : '-') },
      { label: '', right: 1, render: (s) => `<button class="btn small" data-sym="${TX.esc(s.symbol)}">Trade</button>` },
    ];
    $('#ulist').innerHTML = TX.table(cols(true), list.filter((s) => s.user), 'No user stocks yet. List the first one!');
    $('#clist').innerHTML = TX.table(cols(false).filter((c, i) => i !== 2), list.filter((s) => !s.user), 'No data');
  }
  async function load() {
    try { const l = await TX.getStocks(); TX.setStocks(l); render(l); }
    catch (e) { TX.toast(e.message, 'err'); }
  }

  async function submit() {
    if (busy) return;
    const symbol = $('#f_sym').value.trim().toUpperCase(), name = $('#f_name').value.trim();
    const supply = parseInt($('#f_supply').value, 10), price = parseFloat($('#f_price').value);
    const e = V.ticker(symbol) || V.stockName(name) || V.supply(supply) || V.price(price);
    $('#f_err').textContent = e || '';
    if (e) return;
    busy = true; $('#f_go').disabled = true;
    try {
      await TX.createStock({ symbol, name, supply, price });
      TX.toast(symbol + ' listed. You own all ' + F.qty(supply) + ' shares.');
      ['#f_sym', '#f_name', '#f_supply', '#f_price'].forEach((s) => { $(s).value = ''; });
      await load();
      // refresh the symbol dropdown in the navbar
      const sel = $('#symSel');
      if (sel) sel.innerHTML = TX.STOCKS.map((s) => `<option value="${TX.esc(s.symbol)}"${s.symbol === TX.market.symbol ? ' selected' : ''}>${TX.esc(s.symbol)}${s.user ? ' *' : ''}</option>`).join('');
    } catch (x) {
      $('#f_err').textContent = x.message;
    } finally {
      busy = false; $('#f_go').disabled = false;
    }
  }

  function goTrade(e) {
    const s = e.target.dataset.sym;
    if (s) { sessionStorage.setItem('tradex-symbol', s); location.href = 'trade.html'; }
  }
  $('#ulist').addEventListener('click', goTrade);
  $('#clist').addEventListener('click', goTrade);
  $('#f_go').onclick = submit;
  $('#f_price').onkeydown = (e) => { if (e.key === 'Enter') submit(); };
  render(TX.STOCKS); // cached list first, then the fresh one
  load();
})();
