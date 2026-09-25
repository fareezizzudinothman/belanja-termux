'use strict';

// Landing page: bounce to dashboard when authenticated, otherwise to login.
(async () => {
  try {
    await Belanja.request('/auth/me');
    location.href = '/dashboard.html';
  } catch {
    location.href = '/login.html';
  }
})();