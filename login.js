(function () {
  if (TX.auth.isLoggedIn()) { location.href = 'dashboard.html'; return; }
  const $ = TX.$;
  let mode = new URLSearchParams(location.search).get('mode') === 'register' ? 'register' : 'login';

  function setMode(m) {
    mode = m;
    $('#tabLogin').className = 'btn' + (m === 'login' ? '' : ' ghost');
    $('#tabReg').className = 'btn' + (m === 'register' ? '' : ' ghost');
    $('#go').textContent = m === 'login' ? 'LOG IN' : 'CREATE ACCOUNT';
    $('#hint').style.display = m === 'register' ? 'block' : 'none';
    $('#err').textContent = '';
  }

  async function submit() {
    const u = $('#user').value.trim(), p = $('#pass').value;
    const e = mode === 'register' ? TX.validate.username(u) || TX.validate.password(p) : (u && p ? null : 'Enter username and password');
    if (e) { $('#err').textContent = e; return; }
    $('#go').disabled = true; $('#err').textContent = '';
    try {
      const r = await (mode === 'login' ? TX.login(u, p) : TX.register(u, p));
      TX.auth.set(r.token, r.username || u, r.account_id);
      location.href = 'dashboard.html';
    } catch (x) {
      $('#err').textContent = x.message;
    } finally {
      $('#go').disabled = false;
    }
  }

  $('#tabLogin').onclick = () => setMode('login');
  $('#tabReg').onclick = () => setMode('register');
  $('#go').onclick = submit;
  $('#pass').onkeydown = (e) => { if (e.key === 'Enter') submit(); };
  setMode(mode);
})();
