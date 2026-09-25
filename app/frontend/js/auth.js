'use strict';

// Shared login/register page logic.
(function () {
  if (Belanja.hasAuthFlag()) {
    // Optimistic redirect; server validates the real session anyway.
    location.href = '/dashboard.html';
    return;
  }

  const isLogin = !!document.getElementById('login-form');
  const form = document.getElementById(isLogin ? 'login-form' : 'register-form');
  const errorEl = document.getElementById('form-error');

  function showError(msg) {
    errorEl.textContent = msg || '';
  }

  const btn = form.querySelector('[type="submit"]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const data = Object.fromEntries(new FormData(form).entries());
    btn.disabled = true;
    btn.textContent = 'Please wait...';
    try {
      const res = await Belanja.request(isLogin ? '/auth/login' : '/auth/register', {
        method: 'POST',
        body: data,
      });
      Belanja.clearCachedMe();
      Belanja.setAuthFlag();
      location.href = '/dashboard.html';
      void res;
    } catch (err) {
      showError(Belanja.fieldError(err));
      btn.disabled = false;
      btn.textContent = isLogin ? 'Log in' : 'Create account';
    }
  });
})();