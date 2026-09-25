'use strict';

(async () => {
  await UI.initShell('/dashboard.html');

  const $ = UI.$;
  const set = (id, val) => { $(`#${id}`).textContent = val; };
  const card = document.getElementById('totals');

  async function load() {
    const dash = await Belanja.request('/dashboard');

    set('current-month-label', `Expenses for ${UI.monthLabel(dash.currentMonth.year, dash.currentMonth.month)}`);
    const badge = $('#month-status-badge');
    const st = dash.currentMonth.status;
    badge.className = `badge ${st === 'CLOSED' ? 'closed' : st === 'OPEN' ? 'open' : 'idle'}`;
    badge.textContent = st;

    set('t-total', UI.fmtMoney(dash.totals.total));
    set('t-month', UI.monthLabel(dash.currentMonth.year, dash.currentMonth.month));
    set('t-fixed', UI.fmtMoney(dash.totals.fixed));
    set('t-fixed-count', `${dash.summary.fixedExpenseCount} active`);
    set('t-inst', UI.fmtMoney(dash.totals.installments));
    set('t-inst-count', `${dash.summary.installmentCount} active`);
    set('t-var', UI.fmtMoney(dash.totals.variable));
    set('t-var-count', `${dash.summary.variableExpenseCount} entries`);
    set('t-unpaid', UI.fmtMoney(dash.unpaidTotal));
    set('t-unpaid-count', `${dash.summary.activeInstallmentCount} loans`);

    renderChart(dash.series);
    renderInstallments(dash.installments);
  }

  function renderChart(series) {
    const wrap = document.getElementById('chart');
    const max = Math.max(...series.map((s) => s.total), 1);
    set('chart-range', series[0] ? `${UI.monthShort(series[0].year, series[0].month)} \u2013 ${UI.monthShort(series[series.length - 1].year, series[series.length - 1].month)}` : '');

    wrap.innerHTML = series.map((s) => {
      const pct = Math.max((s.total / max) * 100, s.total > 0 ? 3 : 0);
      const tip = [
        s.label,
        `Total: ${UI.fmtMoney(s.total)}`,
        `Fixed: ${UI.fmtMoney(s.fixed)}`,
        `Installments: ${UI.fmtMoney(s.installments)}`,
        `Variable: ${UI.fmtMoney(s.variable)}`,
      ].join('\n');
      return `
        <div class="bar-col" title="${UI.esc(tip)}">
          <div class="bar-count small">${s.total > 0 ? UI.fmtMoney(s.total) : '&ndash;'}</div>
          <div class="bar-track"><div class="bar" style="height:${pct}%;"></div></div>
          <div class="bar-label">${s.label}</div>
        </div>`;
    }).join('');
  }

  function renderInstallments(items) {
    const wrap = document.getElementById('installments-list');
    if (!items.length) {
      wrap.innerHTML = '<div class="empty">No active installments yet. <a href="/installments.html">Add one&rarr;</a></div>';
      return;
    }
    wrap.innerHTML = items.map((i) => `
      <div class="card" style="margin-bottom:12px; padding:14px 16px;">
        <div class="row-flex justify-between">
          <div>
            <strong>${UI.esc(i.loanName)}</strong>
            <span class="badge type">${UI.typeLabel(i.type)}</span>
          </div>
          <div class="small muted">${UI.fmtMoney(i.monthlyInstallment)}/month</div>
        </div>
        <div class="small muted" style="margin:8px 0 6px;">Paid: ${i.paidMonths} / ${i.totalMonths} &middot; Remaining: ${i.remainingMonths} months</div>
        <div class="progress"><div style="width:${i.progress}%;"></div></div>
      </div>
    `).join('');
  }

  try {
    await load();
  } catch (err) {
    UI.toast(err.message, 'error');
    card.innerHTML = '<div class="empty">Failed to load dashboard.</div>';
  }
})();