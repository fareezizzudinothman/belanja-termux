'use strict'

const { query } = require('../db/pool')
const monthlyService = require('./monthlyService')
const installmentService = require('./installmentService')
const { appNow } = require('../utils/time')

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function buildSeries(months, statusByKey, variablesByKey, snapshotFixedByKey, snapshotInstByKey, liveFixedTotal, liveInstTotal, currentYear, currentMonth) {
  return months.map(({ year, month }) => {
    const key = monthKey(year, month)
    const status = statusByKey.get(key)
    // CLOSED months use their frozen snapshots. Only the CURRENT month may use
    // the live recurring definitions (matches the monthly page and the stat
    // cards). Any other OPEN month has no frozen data recorded for that period,
    // so it shows only its own actual variable expenses - a month never
    // inherits another month's total, and empty months stay zero. Months with
    // no entry at all show only their actual variable expenses.
    let fixed = snapshotFixedByKey.get(key) ?? 0
    let installments = snapshotInstByKey.get(key) ?? 0
    if (status === 'OPEN' && year === currentYear && month === currentMonth) {
      fixed = liveFixedTotal
      installments = liveInstTotal
    }
    const variable = variablesByKey.get(key) ?? 0
    return {
      year,
      month,
      label: MONTH_SHORT[month - 1],
      fixed,
      installments,
      variable,
      total: fixed + installments + variable,
    }
  })
}

async function dashboard(userId) {
  // Monthly lifecycle maintenance first: any OPEN month older than the current
  // calendar month is auto-closed. This never opens the current month.
  await monthlyService.autoCloseStaleMonths(userId)

  const today = appNow()
  const currentYear = today.year
  const currentMonth = today.month

  // Current month payload (read-only; entry may be null if never opened).
  const current = await monthlyService.getMonth(userId, currentYear, currentMonth)

  // --- Last 12 months, including the current month ---
  const months = []
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(currentYear, currentMonth - 1 - i, 1))
    months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 })
  }
  const minYear = months[0].year
  const maxYear = months[months.length - 1].year

  // NOTE: month arithmetic above uses UTC only to build the 12-month LABEL
  // range (recent-info display). The app's current month / lifecycle rules use
  // the configured APP_TIMEZONE via appNow().

  const [varRows, entryRows] = await Promise.all([
    query(
      `SELECT year, month, COALESCE(SUM(amount), 0) AS total
       FROM belanja.variable_expenses
       WHERE user_id = $1 AND year BETWEEN $2 AND $3
       GROUP BY year, month`,
      [userId, minYear, maxYear]
    ),
    query(
      `SELECT id, year, month, status FROM belanja.monthly_entries
       WHERE user_id = $1 AND year BETWEEN $2 AND $3`,
      [userId, minYear, maxYear]
    ),
  ])

  const variablesByKey = new Map(varRows.rows.map((r) => [monthKey(r.year, r.month), Number(r.total)]))
  const statusByKey = new Map(entryRows.rows.map((r) => [monthKey(r.year, r.month), r.status]))

  const entryIds = entryRows.rows.filter((r) => r.status === 'CLOSED').map((r) => r.id)
  const snapshotFixedByKey = new Map()
  const snapshotInstByKey = new Map()
  if (entryIds.length) {
    const [fixedSnap, instSnap] = await Promise.all([
      query(
        `SELECT monthly_entry_id, COALESCE(SUM(amount), 0) AS total
         FROM belanja.monthly_fixed_expenses
         WHERE monthly_entry_id = ANY($1)
         GROUP BY monthly_entry_id`,
        [entryIds]
      ),
      query(
        `SELECT monthly_entry_id, COALESCE(SUM(monthly_installment), 0) AS total
         FROM belanja.monthly_installments
         WHERE monthly_entry_id = ANY($1)
         GROUP BY monthly_entry_id`,
        [entryIds]
      ),
    ])
    const entryMap = new Map(entryRows.rows.map((r) => [r.id, r]))
    for (const r of fixedSnap.rows) {
      const e = entryMap.get(r.monthly_entry_id)
      if (e) snapshotFixedByKey.set(monthKey(e.year, e.month), Number(r.total))
    }
    for (const r of instSnap.rows) {
      const e = entryMap.get(r.monthly_entry_id)
      if (e) snapshotInstByKey.set(monthKey(e.year, e.month), Number(r.total))
    }
  }

  // Live recurring definitions apply only to the current (open) month.
  const [liveFixed, liveInst] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM belanja.fixed_expenses WHERE user_id = $1 AND active`,
      [userId]
    ),
    query(
      `SELECT COALESCE(SUM(monthly_installment), 0) AS total FROM belanja.installments WHERE user_id = $1 AND active`,
      [userId]
    ),
  ])
  const liveFixedTotal = Number(liveFixed.rows[0].total)
  const liveInstTotal = Number(liveInst.rows[0].total)

  const series = buildSeries(
    months,
    statusByKey,
    variablesByKey,
    snapshotFixedByKey,
    snapshotInstByKey,
    liveFixedTotal,
    liveInstTotal,
    currentYear,
    currentMonth
  )

  // --- Active installments with progress + unpaid balance ---
  const activeInstallments = (await installmentService.listForUser(userId, { includeInactive: false })).map((inst) => ({
    id: inst.id,
    loanName: inst.loanName,
    type: inst.type,
    monthlyInstallment: inst.monthlyInstallment,
    totalMonths: inst.totalMonths,
    paidMonths: inst.paidMonths,
    remainingMonths: inst.remainingMonths,
    progress: inst.totalMonths > 0 ? Number(((inst.paidMonths / inst.totalMonths) * 100).toFixed(1)) : 0,
    active: inst.active,
  }))

  const unpaidTotal = activeInstallments.reduce((acc, inst) => acc + inst.monthlyInstallment * inst.remainingMonths, 0)

  return {
    currentMonth: {
      year: currentYear,
      month: currentMonth,
      label: `${MONTH_SHORT[currentMonth - 1]} ${currentYear}`,
      status: current.entry ? current.entry.status : 'NOT_OPEN',
    },
    totals: current.totals,
    series,
    installments: activeInstallments,
    unpaidTotal,
    summary: {
      fixedExpenseCount: current.fixedExpenses.length,
      installmentCount: current.installments.length,
      variableExpenseCount: current.variableExpenses.length,
      activeInstallmentCount: activeInstallments.length,
    },
  }
}

module.exports = { dashboard, monthKey }