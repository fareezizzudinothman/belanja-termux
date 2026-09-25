'use strict';

// ---- API client --------------------------------------------------------
// The session is a JWT stored in an httpOnly cookie (set by the server on
// login/register). The non-httpOnly `belanja_authed` flag is used ONLY for
// client-side redirect UX; the server never trusts it.

const Belanja = (() => {
  const AUTH_FLAG = 'belanja_authed';
  const ME_CACHE_KEY = 'belanja_me_cache';
  // Short server-confirmed cache for GET /api/auth/me so page navigations do
  // not fire a duplicate auth round-trip. The server remains authoritative:
  // the cached payload is only used to render the shell while every data
  // endpoint re-validates the httpOnly cookie anyway.
  const ME_CACHE_TTL_MS = 60_000;

  function setAuthFlag() {
    document.cookie = `${AUTH_FLAG}=1; path=/; max-age=604800; samesite=strict`;
  }
  function clearAuthFlag() {
    document.cookie = `${AUTH_FLAG}=; path=/; max-age=0`;
  }
  function hasAuthFlag() {
    return document.cookie.split('; ').some((c) => c.startsWith(`${AUTH_FLAG}=1`));
  }

  function getCachedMe() {
    try {
      const raw = sessionStorage.getItem(ME_CACHE_KEY);
      if (!raw) return null;
      const { at, user } = JSON.parse(raw);
      if (!user || typeof at !== 'number' || Date.now() - at > ME_CACHE_TTL_MS) {
        clearCachedMe();
        return null;
      }
      return user;
    } catch {
      return null;
    }
  }
  function setCachedMe(user) {
    try {
      sessionStorage.setItem(ME_CACHE_KEY, JSON.stringify({ at: Date.now(), user }));
    } catch { /* storage unavailable: always fetch live */ }
  }
  function clearCachedMe() {
    try { sessionStorage.removeItem(ME_CACHE_KEY); } catch { /* ignore */ }
  }

  async function request(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch('/api' + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      const err = new Error('Cannot reach the server. Please check your connection.');
      err.status = 0;
      throw err;
    }

    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }

    if (res.status === 401) {
      clearAuthFlag();
      clearCachedMe();
      const onAuthPage = /(login|register)\.html/.test(location.pathname);
      if (!onAuthPage) location.href = '/login.html';
      const err = new Error(data.message || 'Please log in.');
      err.status = 401;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(data.message || 'Request failed.');
      err.status = res.status;
      err.details = data.details || [];
      throw err;
    }
    return data;
  }

  // Friendly field-error helper for forms.
  function fieldError(err) {
    if (Array.isArray(err.details) && err.details.length) {
      return err.details.map((d) => d.message).join('. ') + '.';
    }
    return err.message;
  }

  return { request, setAuthFlag, clearAuthFlag, hasAuthFlag, fieldError, clearCachedMe };
})();

// ---- Shared UI helpers -------------------------------------------------
const UI = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const moneyFmt = new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' });
  const fmtMoney = (n) => moneyFmt.format(Number(n || 0));

  const TYPE_LABELS = {
    bank: 'Bank',
    shopee_paylater: 'Shopee PayLater',
    tiktok_paylater: 'TikTok PayLater',
    credit_card: 'Credit Card',
    bill: 'Bill',
    property: 'Property',
    vehicle: 'Vehicle',
    hutang_orang: 'Hutang Orang',
    others: 'Others',
    food: 'Food',
    groceries: 'Groceries',
    parent: 'Parent',
    toll: 'Toll',
    fuel: 'Fuel',
  };

  const FIXED_TYPES = ['bank', 'shopee_paylater', 'tiktok_paylater', 'credit_card', 'bill', 'property', 'vehicle', 'hutang_orang', 'others'];
  const VARIABLE_TYPES = ['food', 'groceries', 'parent', 'toll', 'fuel', 'others'];

  const typeLabel = (t) => TYPE_LABELS[t] || t;

  // Guarded month formatters: never hand null/undefined/garbage to the Date
  // constructor, otherwise e.g. Date.UTC(0, -1, 1) renders "December 1899".
  function monthLabel(year, month) {
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return '';
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-MY', { month: 'long', year: 'numeric' });
  }
  function monthShort(year, month) {
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return '';
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-MY', { month: 'short', year: 'numeric' });
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let toastStack = null;
  function toast(message, type = '') {
    if (!toastStack) {
      toastStack = document.createElement('div');
      toastStack.id = 'toast-stack';
      document.body.appendChild(toastStack);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    toastStack.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function openModal(id) {
    const dlg = document.getElementById(id);
    if (dlg && typeof dlg.showModal === 'function') dlg.showModal();
  }
  function closeModal(id) {
    const dlg = document.getElementById(id);
    if (dlg && typeof dlg.close === 'function') dlg.close();
  }

  // Renders the app shell (topbar + nav). Returns the current user.
  async function initShell(activePath) {
    // Reuse the short-lived server-confirmed /auth/me for rapid page
    // navigations; a 401 or expiry clears it and bounces to login anyway.
    const cached = Belanja.getCachedMe();
    const user = cached || (await Belanja.request('/auth/me')).user;
    if (!cached) Belanja.setCachedMe(user);

    const header = document.createElement('header');
    header.className = 'topbar';
    header.innerHTML = `
      <div class="topbar-inner">
        <a class="brand" href="/dashboard.html"><span class="dot"></span>Belanja</a>
        <nav class="main-nav" id="main-nav">
          <a href="/dashboard.html" data-nav="/dashboard.html">Dashboard</a>
          <a href="/monthly.html" data-nav="/monthly.html">Monthly Expenses</a>
          <a href="/fixed-expenses.html" data-nav="/fixed-expenses.html">Fixed Expenses</a>
          <a href="/variable-expenses.html" data-nav="/variable-expenses.html">Variable Expenses</a>
          <a href="/installments.html" data-nav="/installments.html">Installments</a>
          <a href="/profile.html" data-nav="/profile.html">Profile</a>
        </nav>
        <div class="user-chip">
          <span class="u-name">${esc(user.name)}</span>
          <button class="btn small" id="logout-btn">Logout</button>
        </div>
        <button class="nav-toggle" id="nav-toggle" aria-label="Menu">&#9776;</button>
      </div>`;
    document.body.prepend(header);

    document.body.insertAdjacentHTML('beforeend', `
      <nav class="bottom-nav" id="bottom-nav" aria-label="Main navigation">
        <a href="/dashboard.html" data-nav="/dashboard.html"><span class="b-icon">&#8962;</span><span>Dashboard</span></a>
        <a href="/monthly.html" data-nav="/monthly.html"><span class="b-icon">&#9207;</span><span>Monthly</span></a>
        <a href="/variable-expenses.html" data-nav="/variable-expenses.html"><span class="b-icon">&#9620;</span><span>Expenses</span></a>
        <button type="button" id="more-tab" aria-label="More"><span class="b-icon">&#8801;</span><span>More</span></button>
      </nav>`);

    const nav = $('#main-nav');
    const setActive = (a) => {
      if (location.pathname === a.dataset.nav || (activePath && a.dataset.nav === activePath)) {
        a.classList.add('active');
      }
    };
    nav.querySelectorAll('a').forEach(setActive);
    $('#bottom-nav').querySelectorAll('a').forEach(setActive);
    $('#nav-toggle').addEventListener('click', () => nav.classList.toggle('open'));
    $('#more-tab').addEventListener('click', (e) => {
      e.stopPropagation();
      nav.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.topbar-inner') && !e.target.closest('#bottom-nav')) nav.classList.remove('open');
    });

    $('#logout-btn').addEventListener('click', async () => {
      try { await Belanja.request('/auth/logout', { method: 'POST' }); } catch { /* offline */ }
      Belanja.clearAuthFlag();
      Belanja.clearCachedMe();
      location.href = '/login.html';
    });

    return user;
  }

  function setLoading(btn, loading, text) {
    if (!btn) return;
    if (loading) {
      btn.dataset.orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Please wait...';
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.orig || text || 'Save';
    }
  }

  function bindForm(form, onSubmit, { submittingText = 'Saving...' } = {}) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type="submit"]');
      if (btn && btn.disabled) return;
      setLoading(btn, true, submittingText);
      Promise.resolve(onSubmit(new FormData(form)))
        .catch((err) => {
          toast(UI.fieldError(err), 'error');
        })
        .finally(() => setLoading(btn, false, submittingText));
    });
  }

  return {
    $, $$, fmtMoney, TYPE_LABELS, FIXED_TYPES, VARIABLE_TYPES, typeLabel,
    monthLabel, monthShort, esc, toast, openModal, closeModal, initShell,
    setLoading, bindForm,
  };
})();

// ---- PWA: register the service worker (static-shell offline caching) -----
// Guarded so the app keeps working anywhere a SW is unavailable (insecure
// contexts, old browsers). Errors are intentionally swallowed.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => {});
  });
}
registerServiceWorker();