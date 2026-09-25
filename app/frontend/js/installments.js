'use strict';

(async () => {
  await UI.initShell('/installments.html');
  const $ = UI.$;
  let items = [];
  let editingId = null;

  const pad = (n) => String(n).padStart(2, '0');

  function fillTypeSelect() {
    const sel = $('#inst-type');
    sel.innerHTML = UI.FIXED_TYPES.map((t) => `<option value="${t}">${UI.typeLabel(t)}</option>`).join('');
  }

  function render() {
    const wrap = $('#inst-cards');
    const empty = $('#inst-empty');
    if (!items.length) {
      wrap.innerHTML = '';
      empty.innerHTML = '<div class="empty">No installments yet. Click &ldquo;+ Add Installment&rdquo; to start.</div>';
      return;
    }
    empty.innerHTML = '';
    wrap.innerHTML = items.map((i) => {
      const remainingBalance = i.monthlyInstallment * i.remainingMonths;
      return `
      <div class="card">
        <div class="row-flex justify-between" style="margin-bottom:8px;">
          <div>
            <strong>${UI.esc(i.loanName)}</strong>
            <span class="badge type">${UI.typeLabel(i.type)}</span>
            <span class="badge ${i.active ? 'on' : 'off'}">${i.active ? 'Active' : 'Inactive'}</span>
          </div>
          <div class="row-flex">
            <button class="btn small" data-toggle="${i.id}">${i.active ? 'Pause' : 'Resume'}</button>
            <button class="btn small" data-edit="${i.id}">Edit</button>
            <button class="btn small danger" data-del="${i.id}">Delete</button>
          </div>
        </div>
        <div style="font-size:20px; font-weight:800;">${UI.fmtMoney(i.monthlyInstallment)}<span class="muted small"> /month</span></div>
        <div class="small muted" style="margin:10px 0 6px;">
          Paid: <strong>${i.paidMonths}</strong> / ${i.totalMonths} months &middot;
          Remaining: <strong>${i.remainingMonths}</strong> months &middot;
          Balance: <strong>${UI.fmtMoney(remainingBalance)}</strong>
          ${i.startDate ? ` &middot; Started ${i.startDate}` : ''}
          ${i.endDate ? ` &middot; Ends ${i.endDate}` : ''}
        </div>
        <div class="progress"><div style="width:${i.progress}%;"></div></div>
        ${i.remarks ? `<div class="muted small" style="margin-top:8px;">${UI.esc(i.remarks)}</div>` : ''}
      </div>`;
    }).join('');

    wrap.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openModal(b.dataset.edit)));
    wrap.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => toggle(b.dataset.toggle)));
    wrap.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => remove(b.dataset.del)));
  }

  async function load() {
    const res = await Belanja.request('/installments');
    items = res.items;
    const withProgress = items.map((i) => ({ ...i, progress: i.totalMonths ? Number(((i.paidMonths / i.totalMonths) * 100).toFixed(1)) : 0 }));
    items = withProgress;
    render();
  }

  function openModal(id) {
    editingId = id;
    $('#inst-error').textContent = '';
    const form = $('#inst-form');
    form.reset();
    $('#inst-active').checked = true;
    $('#inst-paid-months').value = 0;
    $('#inst-modal-title').textContent = id ? 'Edit Installment' : 'Add Installment';
    if (id) {
      const i = items.find((x) => x.id === id);
      if (!i) return;
      form.elements.loanName.value = i.loanName;
      form.elements.type.value = i.type;
      form.elements.monthlyInstallment.value = i.monthlyInstallment;
      form.elements.amount.value = i.amount;
      form.elements.remarks.value = i.remarks || '';
      form.elements.totalMonths.value = i.totalMonths;
      form.elements.paidMonths.value = i.paidMonths;
      form.elements.startDate.value = i.startDate || '';
      form.elements.endDate.value = i.endDate || '';
      $('#inst-active').checked = i.active;
    } else {
      const d = new Date();
      form.elements.startDate.value = [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-');
    }
    UI.openModal('inst-modal');
  }

  $('#add-inst-btn').addEventListener('click', () => openModal(null));
  document.querySelectorAll('[data-close-inst]').forEach((b) => b.addEventListener('click', () => UI.closeModal('inst-modal')));

  $('#inst-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dataObj = Object.fromEntries(new FormData(e.target).entries());
    dataObj.active = $('#inst-active').checked;
    dataObj.totalMonths = Number(dataObj.totalMonths);
    dataObj.paidMonths = Number(dataObj.paidMonths || 0);
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      await Belanja.request(`/installments${editingId ? `/${editingId}` : ''}`, {
        method: editingId ? 'PUT' : 'POST',
        body: dataObj,
      });
      UI.closeModal('inst-modal');
      UI.toast('Saved', 'success');
      await load();
    } catch (err) {
      $('#inst-error').textContent = Belanja.fieldError(err);
    } finally {
      btn.disabled = false;
    }
  });

  async function toggle(id) {
    const i = items.find((x) => x.id === id);
    try {
      await Belanja.request(`/installments/${id}/active`, { method: 'PATCH', body: { active: !i.active } });
      UI.toast(i.active ? 'Paused (not counted in open months)' : 'Resumed', 'success');
      await load();
    } catch (err) { UI.toast(Belanja.fieldError(err), 'error'); }
  }

  async function remove(id) {
    const i = items.find((x) => x.id === id);
    if (!confirm(`Delete "${i ? i.loanName : 'this installment'}"? Closed months keep their snapshot; only the loan definition is removed.`)) return;
    try {
      await Belanja.request(`/installments/${id}`, { method: 'DELETE' });
      UI.toast('Deleted', 'success');
      await load();
    } catch (err) { UI.toast(Belanja.fieldError(err), 'error'); }
  }

  try {
    fillTypeSelect();
    await load();
  } catch (err) { UI.toast(err.message, 'error'); }
})();