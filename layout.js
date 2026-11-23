(function () {
  const LINKS = [['dashboard.html', 'Dashboard'], ['trade.html', 'Trade'], ['orders.html', 'Orders'],
                 ['portfolio.html', 'Portfolio'], ['history.html', 'History'], ['depth.html', 'Market Depth'], ['performance.html', 'Performance'], ['whatif.html', 'What If'], ['receipts.html', 'Receipts']];

  // Call at the top of every protected page. Returns false (and redirects) when not logged in.
  TX.layout = {
    init() {
      if (!TX.auth.isLoggedIn()) { location.href = 'login.html'; return false; }
      const page = location.pathname.split('/').pop() || 'dashboard.html';
      const user = TX.auth.get();
      const M = TX.market, $ = TX.$;
      $('#nav').innerHTML =
        '<header class="nav"><span class="logo">TradeX</span><button class="menu-btn" id="menuBtn">Menu</button>' +
        '<nav class="links" id="links">' + LINKS.map((l) => `<a href="${l[0]}" class="${l[0] === page ? 'active' : ''}">${l[1]}</a>`).join('') + '</nav>' +
        '<div class="right"><select id="symSel"></select>' +
        '<span class="badge OFFLINE" id="badge"><i></i><span>OFFLINE</span></span>' +
        '<button class="nav-logout" id="navLogout">Logout</button>' +
        `<button class="avatar" id="avatar" aria-label="Open profile menu">${TX.esc((user.username || '?')[0].toUpperCase())}</button></div>` +
        '<div class="dropdown" id="dd"><a href="profile.html">Profile</a></div></header>';

      const fillSel = () => {
        $('#symSel').innerHTML = TX.STOCKS.map((s) => `<option value="${TX.esc(s.symbol)}"${s.symbol === M.symbol ? ' selected' : ''}>${TX.esc(s.symbol)}</option>`).join('');
      };
      fillSel();
      TX.getQuotes().then((quotes) => {
        if (Array.isArray(quotes) && quotes.length) {
          TX.setStocks(quotes.map((q) => ({ symbol: q.symbol, name: q.name, user: false, price: q.last })));
          fillSel();
        }
      }).catch(() => { /* keep cached list */ });
      $('#menuBtn').onclick = () => $('#links').classList.toggle('open');
      $('#avatar').onclick = () => $('#dd').classList.toggle('open');
      $('#navLogout').onclick = () => TX.auth.logout();
      $('#symSel').onchange = (e) => M.setSymbol(e.target.value);
      M.subscribe(() => { const b = $('#badge'); b.className = 'badge ' + M.status; b.lastChild.textContent = M.status; });
      M.onFill((e) => TX.toast('Order #' + e.order_id + (e.remaining ? ' partly filled, ' + TX.fmt.qty(e.remaining) + ' left' : ' filled')));
      window.addEventListener('resize', () => M.emit()); // redraw canvases on resize
      M.start();
      return true;
    },
  };
})();
