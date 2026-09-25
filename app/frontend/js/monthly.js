'use strict';

(async () => {
  await UI.initShell('/monthly.html');
  const $ = UI.$;

  const params = new URLSearchParams(location.search);
  let serverNow = null;
  let year = parseInt(params.get('year'), 10) || null;
  let month = parseInt(params.get('month'), 10) || null;
  let data = null;
  let editingId = null;

  function pad(n) { return String(n).padStart(2, '0'); }

  function isOpen() {
    return !!(data.entry && data.entry.status === 'OPEN');
  }

  function subtitle() {
    switch (data.status) {
      case 'OPEN':
        return 'Expected recurring costs plus this month\u2019s actual expenses.';
      case 'CLOSED':
        return 'This month is closed and read-only. Historical values are preserved.';
      case 'FUTURE':
        return 'This is a future month. It cannot be opened yet.';
      case 'HISTORY':
        return 'Historical month outside the editable window. Read-only, cannot be reopened.';
      default: // NOT OPEN
        return 'This month is not open yet. Open it to start recording expenses.';
    }
  }

  function render() {
    setTitle();
    $('#month-sub').textContent = subtitle();

    const badge = $('#month-status');
    badge.textContent = data.status;
    badge.className = `badge ${data.status === 'CLOSED' ? 'closed' : data.status === 'OPEN' ? 'open' : 'idle'}`;

    const banner = $('#month-banner');
    banner.innerHTML = '';
    if (data.status === 'CLOSED') {
      banner.innerHTML = '<div class="banner closed">' +
        'This month is closed (read-only). Close protects the record: future changes to ' +
        'fixed expenses or installments will not change this month\'s snapshot.</div>';
    } else if (data.status === 'NOT OPEN') {
      banner.innerHTML = '<div class="banner">' +
        'This month is not open yet. Nothing is recorded until you open it.</div>';
    } else if (data.status === 'FUTURE') {
      banner.innerHTML = '<div class="banner idle">' +
        'Future month \u2014 it cannot be opened until the calendar reaches it.</div>';
    } else if (data.status === 'HISTORY') {
      banner.innerHTML = '<div class="banner idle">' +
        'This month is older than the editable window (current + previous 3 months). Read-only.</div>';
    }

    renderFixed();
    renderInst();
    renderVar();
    renderTotals();

    const openBtn = $('#open-month-btn');
    const closeBtn = $('#close-month-btn');
    const reopenBtn = $('#reopen-month-btn');
    openBtn.style.display = data.access.canOpen ? '' : 'none';
    closeBtn.style.display = data.access.canClose ? '' : 'none';
    reopenBtn.style.display = data.access.canReopen ? '' : 'none';
    openBtn.disabled = false;
    closeBtn.disabled = false;
    reopenBtn.disabled = false;

    const addBtn = $('#add-var-btn');
    addBtn.style.display = isOpen() ? '' : 'none';
  }

  function setTitle() {
    const title = $('#month-title');
    title.textContent = UI.monthLabel(year, month);
    title.style.opacity = 1;
  }

  function renderFixed() {
    const wrap = $('#fixed-list');
    const items = data.fixedExpenses;
    if (!items.length) {
      wrap.innerHTML = '<div class="empty">No active fixed expenses for this month. <a href="/fixed-expenses.html">Add one&rarr;</a></div>';
      return;
    }
    wrap.innerHTML = items.map((f) => `
      <div class="total-line">
        <span>${UI.esc(f.name)} <span class="badge type">${UI.typeLabel(f.type)}</span></span>
        <strong>${UI.fmtMoney(f.amount)}</strong>
      </div>`).join('');
  }

  function renderInst() {
    const wrap = $('#inst-list');
    const items = data.installments;
    if (!items.length) {
      wrap.innerHTML = '<div class="empty">No active installments for this month. <a href="/installments.html">Add one&rarr;</a></div>';
      return;
    }
    wrap.innerHTML = items.map((i) => `
      <div class="total-line">
        <span>${UI.esc(i.loanName)} <span class="badge type">${UI.typeLabel(i.type)}</span></span>
        <strong>${UI.fmtMoney(i.monthlyInstallment)}</strong>
      </div>`).join('');
  }

  function renderVar() {
    const wrap = $('#var-list');
    const items = data.variableExpenses;
    const readOnly = data.status !== 'OPEN';
    if (!items.length) {
      wrap.innerHTML = '<div class="empty">No variable expenses recorded for this month yet.</div>';
      return;
    }
    wrap.innerHTML = items.map((v) => `
      <div class="total-line var-item">
        <span class="var-main">
          <span class="var-name">${UI.esc(v.name)}</span> <span class="badge type">${UI.typeLabel(v.type)}</span>
          <span class="var-meta muted small">${UI.esc(v.expenseDate)}${v.remarks ? ` &mdash; ${UI.esc(v.remarks)}` : ''}</span>
        </span>
        <span class="row-flex var-side">
          <strong>${UI.fmtMoney(v.amount)}</strong>
          <span class="actions var-actions">
            ${readOnly ? '' : `<button class="btn ghost small" data-edit="${v.id}" title="edit">&#9998;</button>
            <button class="btn ghost small" data-del="${v.id}" title="delete">&times;</button>`}
          </span>
        </span>
      </div>`).join('');

    wrap.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openVarModal(b.dataset.edit)));
    wrap.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => deleteVar(b.dataset.del)));
  }

  function renderTotals() {
    const t = data.totals;
    $('#sum-fixed').textContent = UI.fmtMoney(t.fixed);
    $('#sum-inst').textContent = UI.fmtMoney(t.installments);
    $('#sum-var').textContent = UI.fmtMoney(t.variable);
    $('#sum-total').textContent = UI.fmtMoney(t.total);
  }

  async function load() {
    data = await Belanja.request(`/monthly/${year}/${month}`);
    render();
  }

  // ---- Variable expense modal ----
  function fillTypeSelect() {
    const sel = $('#var-type');
    sel.innerHTML = UI.VARIABLE_TYPES.map((t) => `<option value="${t}">${UI.typeLabel(t)}</option>`).join('');
  }

  function openVarModal(id) {
    editingId = id;
    $('#var-error').textContent = '';
    const form = $('#var-form');
    form.reset();
    const title = $('#var-modal-title');
    if (id) {
      const v = data.variableExpenses.find((x) => x.id === id);
      if (!v) return;
      title.textContent = 'Edit Expense';
      form.elements.name.value = v.name;
      form.elements.type.value = v.type;
      form.elements.amount.value = v.amount;
      form.elements.expenseDate.value = v.expenseDate;
      form.elements.remarks.value = v.remarks || '';
    } else {
      title.textContent = 'Add Expense';
      form.elements.expenseDate.value = `${year}-${pad(month)}-01`;
    }
    UI.openModal('var-modal');
  }

  $('#add-var-btn').addEventListener('click', () => openVarModal(null));
  document.querySelectorAll('[data-close-modal]').forEach((b) => b.addEventListener('click', () => UI.closeModal('var-modal')));

  $('#var-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    const dataObj = Object.fromEntries(new FormData(e.target).entries());
    btn.disabled = true;
    try {
      await Belanja.request(`/variable-expenses${editingId ? `/${editingId}` : ''}`, {
        method: editingId ? 'PUT' : 'POST',
        body: dataObj,
      });
      UI.closeModal('var-modal');
      UI.toast('Expense saved', 'success');
      await load();
    } catch (err) {
      $('#var-error').textContent = Belanja.fieldError(err);
    } finally {
      btn.disabled = false;
    }
  });

  async function deleteVar(id) {
    const v = data.variableExpenses.find((x) => x.id === id);
    if (!confirm(`Delete "${v ? v.name : 'this expense'}"? This cannot be undone.`)) return;
    try {
      await Belanja.request(`/variable-expenses/${id}`, { method: 'DELETE' });
      UI.toast('Expense deleted', 'success');
      await load();
    } catch (err) {
      UI.toast(Belanja.fieldError(err), 'error');
    }
  }

  // ---- Month navigation + lifecycle actions ----
  function goto(y, m) {
    year = y; month = m;
    history.replaceState(null, '', `/monthly.html?year=${y}&month=${m}`);
    $('#month-title').style.opacity = 0.4;
    load().catch((err) => UI.toast(err.message, 'error')).finally(() => { $('#month-title').style.opacity = 1; });
  }

  $('#prev-month').addEventListener('click', () => {
    const d = new Date(Date.UTC(year, month - 2, 1));
    goto(d.getUTCFullYear(), d.getUTCMonth() + 1);
  });
  $('#next-month').addEventListener('click', () => {
    const d = new Date(Date.UTC(year, month, 1));
    goto(d.getUTCFullYear(), d.getUTCMonth() + 1);
  });
  $('#today-btn').addEventListener('click', () => {
    if (serverNow) goto(serverNow.year, serverNow.month);
  });

  async function runAction(path, confirmMsg, doneMsg, doneType, btn) {
    if (!confirm(confirmMsg)) return;
    btn.disabled = true;
    btn.textContent = 'Please wait...';
    try {
      const res = await Belanja.request(`/monthly/${year}/${month}/${path}`, { method: 'POST' });
      data = res;
      render();
      UI.toast(doneMsg, doneType);
    } catch (err) {
      UI.toast(Belanja.fieldError(err), 'error');
      btn.disabled = false;
      btn.textContent = btn.dataset.label || '';
    }
  }

  // Open / (re)open action handler factory keeps the three buttons concise.
  // The confirm message is built lazily at CLICK time: `year`/`month` are not
  // resolved until /monthly/current is fetched, so any message computed at load
  // would render from null values (e.g. UI.monthLabel(null, null) -> "December
  // 1899"). Building it inside the handler always shows the real month.
  function bindLifecycle(selector, action, label, buildConfirmMsg, doneMsg) {
    const btn = $(selector);
    btn.dataset.label = label;
    btn.addEventListener('click', (e) => runAction(action, buildConfirmMsg(), doneMsg, 'success', e.currentTarget));
  }

  bindLifecycle('#open-month-btn', 'open',
    'Open Month',
    () => `Open ${UI.monthLabel(year, month)}?\n\nOpening makes the month editable so you can record expenses.`,
    'Month opened.');

  bindLifecycle('#close-month-btn', 'close',
    'Close Month',
    () => `Close ${UI.monthLabel(year, month)}?\n\nOnce closed, this month becomes read-only and its fixed/installment values are frozen as a snapshot.`,
    'Month closed.');

  bindLifecycle('#reopen-month-btn', 'reopen',
    'Reopen Month',
    () => `Reopen ${UI.monthLabel(year, month)}?\n\nYou can correct data again. The historical snapshot is kept and rebuilt the next time you close the month.`,
    'Month reopened.');

  async function init() {
    try {
      const current = await Belanja.request('/monthly/current');
      serverNow = current;
      if (!year) year = current.year;
      if (!month) month = current.month;
      fillTypeSelect();
      await load();
    } catch (err) {
      UI.toast(err.message, 'error');
    }
  }

  init();
})();