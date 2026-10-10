(function () {
  if (!TX.layout.init()) return;
  const $ = TX.$, user = TX.auth.get();
  $('#uname').textContent = user.username || '';
  $('#accid').textContent = 'Account ID: ' + (user.accountId || '-');
  const profileKey = 'tradex-profile-' + (user.accountId || user.username);
  try {
    const details = JSON.parse(localStorage.getItem(profileKey) || '{}');
    $('#pname').value = details.name || '';
    $('#pemail').value = details.email || '';
    $('#pphone').value = details.phone || '';
  } catch (e) {
    TX.toast('Could not load saved contact details', 'err');
  }

  $('#saveProfile').onclick = () => {
    const email = $('#pemail');
    if (!email.checkValidity()) {
      email.reportValidity();
      return;
    }
    try {
      localStorage.setItem(profileKey, JSON.stringify({
        name: $('#pname').value.trim(),
        email: email.value.trim(),
        phone: $('#pphone').value.trim(),
      }));
      TX.toast('Contact details saved on this browser');
    } catch (e) {
      TX.toast('Could not save contact details', 'err');
    }
  };

  $('#upd').onclick = async () => {
    const e = TX.validate.password($('#newp').value);
    if (e) return TX.toast(e, 'err');
    $('#upd').disabled = true;
    try {
      await TX.changePassword($('#oldp').value, $('#newp').value);
      TX.toast('Password updated');
      $('#oldp').value = ''; $('#newp').value = '';
    } catch (x) {
      TX.toast(x.message, 'err');
    } finally {
      $('#upd').disabled = false;
    }
  };
  $('#logout2').onclick = () => TX.auth.logout();
})();
