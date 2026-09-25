'use strict';

(async () => {
  await UI.initShell('/fixed-expenses.html');
  const $ = UI.$;
  let items = [];
  let editingId = null;

  function fillTypeSelect() {
    const sel = $('#fixed-type');
    sel.innerHTML = UI.FIXED_TYPES.map((t) => `<option value="${t}">${UI.typeLabel(t)}</option>`).join('');
  }

  function render() {
    const tbody = $('#fixed-tbody');
    const empty = $('#fixed-empty');
    if (!items.length) {
      tbody.innerHTML = '';
      empty.innerHTML = '<div class="empty">No fixed expenses yet. Click &ldquo;+ Add Fixed Expense&rdquo; to start.</div>';
      return;
    }
    empty.innerHTML = '';
    tbody.innerHTML = items.map((f) => `
      <tr>
        <td data-label="Name"><strong>${UI.esc(f.name)}</strong></td>
        <td data-label="Type"><span class="badge type">${UI.typeLabel(f.type)}</span></td>
        <td class="num" data-label="Amount">${UI.fmtMoney(f.amount)}</td>
        <td class="muted small" data-label="Remarks">${UI.esc(f.remarks || '')}</td>
        <td data-label="Status"><span class="badge ${f.active ? 'on' : 'off'}">${f.active ? 'Active' : 'Inactive'}</span></td>
        <td data-label="Actions">
          <div class="actions">
            <button class="btn small" data-toggle="${f.id}">${f.active ? 'Disable' : 'Enable'}</button>
            <button class="btn small" data-edit="${f.id}">Edit</button>
            <button class="btn small danger" data-del="${f.id}">Delete</button>
          </div>
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openModal(b.dataset.edit)));
    tbody.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => toggle(b.dataset.toggle)));
    tbody.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => remove(b.dataset.del)));
  }

  async function load() {
    const res = await Belanja.request('/fixed-expenses');
    items = res.items;
    render();
  }

  function openModal(id) {
    editingId = id;
    $('#fixed-error').textContent = '';
    const form = $('#fixed-form');
    form.reset();
    $('#fixed-active').checked = true;
    $('#fixed-modal-title').textContent = id ? 'Edit Fixed Expense' : 'Add Fixed Expense';
    if (id) {
      const f = items.find((x) => x.id === id);
      if (!f) return;
      form.elements.name.value = f.name;
      form.elements.type.value = f.type;
      form.elements.amount.value = f.amount;
      form.elements.remarks.value = f.remarks || '';
      $('#fixed-active').checked = f.active;
    }
    UI.openModal('fixed-modal');
  }

  $('#add-fixed-btn').addEventListener('click', () => openModal(null));
  document.querySelectorAll('[data-close-fixed]').forEach((b) => b.addEventListener('click', () => UI.closeModal('fixed-modal')));

  $('#fixed-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dataObj = Object.fromEntries(new FormData(e.target).entries());
    dataObj.active = $('#fixed-active').checked;
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      await Belanja.request(`/fixed-expenses${editingId ? `/${editingId}` : ''}`, {
        method: editingId ? 'PUT' : 'POST',
        body: dataObj,
      });
      UI.closeModal('fixed-modal');
      UI.toast('Saved', 'success');
      await load();
    } catch (err) {
      $('#fixed-error').textContent = Belanja.fieldError(err);
    } finally {
      btn.disabled = false;
    }
  });

  async function toggle(id) {
    const f = items.find((x) => x.id === id);
    try {
      await Belanja.request(`/fixed-expenses/${id}/active`, { method: 'PATCH', body: { active: !f.active } });
      UI.toast(f.active ? 'Disabled' : 'Enabled', 'success');
      await load();
    } catch (err) { UI.toast(Belanja.fieldError(err), 'error'); }
  }

  async function remove(id) {
    const f = items.find((x) => x.id === id);
    if (!confirm(`Delete "${f ? f.name : 'this expense'}"?\nClosed months keep their snapshot; only the recurring definition is removed.`)) return;
    try {
      await Belanja.request(`/fixed-expenses/${id}`, { method: 'DELETE' });
      UI.toast('Deleted', 'success');
      await load();
    } catch (err) { UI.toast(Belanja.fieldError(err), 'error'); }
  }

  try {
    fillTypeSelect();
    await load();
  } catch (err) { UI.toast(err.message, 'error'); }
})();