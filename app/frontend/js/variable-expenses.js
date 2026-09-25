'use strict';

(async () => {
  await UI.initShell('/variable-expenses.html');
  const $ = UI.$;
  let items = [];
  let editingId = null;
  let filter = null;

  function fillTypeSelect() {
    const sel = $('#var-type');
    sel.innerHTML = UI.VARIABLE_TYPES.map((t) => `<option value="${t}">${UI.typeLabel(t)}</option>`).join('');
  }

  function render() {
    const tbody = $('#var-tbody');
    const empty = $('#var-empty');
    if (!items.length) {
      tbody.innerHTML = '';
      empty.innerHTML = '<div class="empty">No variable expenses found for this view. Add your first expense.</div>';
      return;
    }
    empty.innerHTML = '';
    const total = items.reduce((a, i) => a + Number(i.amount), 0);
    tbody.innerHTML = items.map((v) => `
      <tr>
        <td class="small" data-label="Date">${UI.esc(v.expenseDate)}</td>
        <td data-label="Name"><strong>${UI.esc(v.name)}</strong></td>
        <td data-label="Type"><span class="badge type">${UI.typeLabel(v.type)}</span></td>
        <td class="num" data-label="Amount">${UI.fmtMoney(v.amount)}</td>
        <td class="muted small" data-label="Remarks">${UI.esc(v.remarks || '')}</td>
        <td data-label="Actions">
          <div class="actions">
            <button class="btn small" data-edit="${v.id}">Edit</button>
            <button class="btn small danger" data-del="${v.id}">Delete</button>
          </div>
        </td>
      </tr>`).join('') + `
      <tr class="totals-row">
        <td colspan="3"><strong>Total</strong></td>
        <td class="num"><strong>${UI.fmtMoney(total)}</strong></td>
        <td colspan="2" class="totals-fill"></td>
      </tr>`;

    tbody.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openModal(b.dataset.edit)));
    tbody.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => remove(b.dataset.del)));
  }

  async function load() {
    const qs = filter ? `?year=${filter.year}&month=${filter.month}` : '';
    const res = await Belanja.request(`/variable-expenses${qs}`);
    items = res.items;
    render();
  }

  function openModal(id) {
    editingId = id;
    $('#var-error').textContent = '';
    const form = $('#var-form');
    form.reset();
    $('#var-modal-title').textContent = id ? 'Edit Expense' : 'Add Expense';
    if (id) {
      const v = items.find((x) => x.id === id);
      if (!v) return;
      form.elements.name.value = v.name;
      form.elements.type.value = v.type;
      form.elements.amount.value = v.amount;
      form.elements.expenseDate.value = v.expenseDate;
      form.elements.remarks.value = v.remarks || '';
    } else {
      const d = new Date();
      form.elements.expenseDate.value = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
    }
    UI.openModal('var-modal');
  }

  $('#add-var-btn').addEventListener('click', () => openModal(null));
  document.querySelectorAll('[data-close-var]').forEach((b) => b.addEventListener('click', () => UI.closeModal('var-modal')));

  $('#var-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dataObj = Object.fromEntries(new FormData(e.target).entries());
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      await Belanja.request(`/variable-expenses${editingId ? `/${editingId}` : ''}`, {
        method: editingId ? 'PUT' : 'POST',
        body: dataObj,
      });
      UI.closeModal('var-modal');
      UI.toast('Saved', 'success');
      await load();
    } catch (err) {
      $('#var-error').textContent = Belanja.fieldError(err);
    } finally {
      btn.disabled = false;
    }
  });

  async function remove(id) {
    const v = items.find((x) => x.id === id);
    if (!confirm(`Delete "${v ? v.name : 'this expense'}"? This cannot be undone.`)) return;
    try {
      await Belanja.request(`/variable-expenses/${id}`, { method: 'DELETE' });
      UI.toast('Deleted', 'success');
      await load();
    } catch (err) { UI.toast(Belanja.fieldError(err), 'error'); }
  }

  // filter
  const mf = $('#month-filter');
  const d = new Date();
  mf.value = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0')].join('-');
  mf.addEventListener('change', () => {
    if (!mf.value) { filter = null; }
    else {
      const [y, m] = mf.value.split('-').map(Number);
      filter = { year: y, month: m };
    }
    load().catch((err) => UI.toast(err.message, 'error'));
  });

  try {
    fillTypeSelect();
    await load();
  } catch (err) { UI.toast(err.message, 'error'); }
})();