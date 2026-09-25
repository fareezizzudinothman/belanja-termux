'use strict';

(async () => {
  const user = await UI.initShell('/profile.html');
  const $ = UI.$;

  $('#p-email').textContent = user.email;
  $('#p-name').value = user.name;
  $('#p-member-since').textContent = new Date(user.createdAt).toLocaleDateString('en-MY', { year: 'numeric', month: 'long' });

  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      await Belanja.request('/auth/me', {
        method: 'PUT',
        body: Object.fromEntries(new FormData(e.target).entries()),
      });
      UI.toast('Name updated', 'success');
    } catch (err) {
      $('#p-error').textContent = Belanja.fieldError(err);
    } finally {
      btn.disabled = false;
    }
  });

  $('#p-logout').addEventListener('click', async () => {
    try { await Belanja.request('/auth/logout', { method: 'POST' }); } catch { /* offline */ }
    Belanja.clearAuthFlag();
    location.href = '/login.html';
  });
})();