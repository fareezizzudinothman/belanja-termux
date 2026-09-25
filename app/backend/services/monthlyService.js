'use strict'

const { pool, query } = require('../db/pool')
const { AppError } = require('../utils/http')
const { appNow, monthIndex } = require('../utils/time')
const variableExpenseService = require('./variableExpenseService')

function mapEntry(row) {
  return {
    id: row.id,
    year: row.year,
    month: row.month,
    status: row.status,
    closedAt: row.closed_at,
    reopenedAt: row.reopened_at,
  }
}

async function getEntry(userId, year, month) {
  const { rows } = await query(
    `SELECT id, year, month, status, closed_at, reopened_at
     FROM belanja.monthly_entries
     WHERE user_id = $1 AND year = $2 AND month = $3`,
    [userId, year, month]
  )
  return rows[0] ? mapEntry(rows[0]) : null
}

async function snapshotQuery(monthlyEntryId, userId) {
  const { rows } = await query(
    `SELECT id, name, type, amount, remarks
     FROM belanja.monthly_fixed_expenses
     WHERE monthly_entry_id = $1 AND user_id = $2
     ORDER BY created_at ASC`,
    [monthlyEntryId, userId]
  )
  return rows.map((r) => ({ id: r.id, name: r.name, type: r.type, amount: Number(r.amount), remarks: r.remarks }))
}

async function installmentsForEntry(monthlyEntryId, userId) {
  const { rows } = await query(
    `SELECT id, loan_name, type, monthly_installment, remarks
     FROM belanja.monthly_installments
     WHERE monthly_entry_id = $1 AND user_id = $2
     ORDER BY created_at ASC`,
    [monthlyEntryId, userId]
  )
  return rows.map((r) => ({
    id: r.id,
    loanName: r.loan_name,
    type: r.type,
    monthlyInstallment: Number(r.monthly_installment),
    remarks: r.remarks,
  }))
}

// Live (OPEN month): recurring masters as currently defined.
async function liveFixedExpenses(userId) {
  const { rows } = await query(
    `SELECT id, name, type, amount, remarks
     FROM belanja.fixed_expenses
     WHERE user_id = $1 AND active
     ORDER BY created_at ASC`,
    [userId]
  )
  return rows.map((r) => ({ id: r.id, name: r.name, type: r.type, amount: Number(r.amount), remarks: r.remarks }))
}

async function liveInstallments(userId) {
  const { rows } = await query(
    `SELECT id, loan_name, type, monthly_installment, remarks
     FROM belanja.installments
     WHERE user_id = $1 AND active
     ORDER BY created_at ASC`,
    [userId]
  )
  return rows.map((r) => ({
    id: r.id,
    loanName: r.loan_name,
    type: r.type,
    monthlyInstallment: Number(r.monthly_installment),
    remarks: r.remarks,
  }))
}

const sum = (xs) => xs.reduce((acc, x) => acc + x, 0)

// Describes where a (year, month) sits relative to the configured current month.
function monthStateOf(year, month) {
  const now = appNow()
  const currentIndex = monthIndex(now.year, now.month)
  const idx = monthIndex(year, month)
  const monthsAgo = currentIndex - idx // 0 = current, negative = future, positive = past
  return {
    isCurrent: monthsAgo === 0,
    isFuture: monthsAgo < 0,
    monthsAgo,
    withinReopenWindow: monthsAgo >= 0 && monthsAgo <= 3,
    currentYear: now.year,
    currentMonth: now.month,
  }
}

// Access rules derived from the entry + calendar position. The backend is the
// single source of truth; the UI simply reflects these flags.
function accessOf(entry, monthState) {
  return {
    // Opening is only meaningful for the CURRENT calendar month - the "Open
    // New Month" action. Past months are corrected via Reopen instead.
    canOpen: !entry && monthState.isCurrent,
    canClose: !!entry && entry.status === 'OPEN' && monthState.withinReopenWindow,
    canReopen: !!entry && entry.status === 'CLOSED' && monthState.withinReopenWindow,
  }
}

function displayStatusOf(entry, monthState) {
  if (entry) return entry.status
  if (monthState.isFuture) return 'FUTURE'
  if (monthState.isCurrent) return 'NOT OPEN'
  return 'HISTORY'
}

/**
 * Read-only monthly payload.
 *
 * GET requests never create entries. A month without an entry is:
 *   - the current month                -> live recurring preview ("not open yet")
 *   - future or past (incl. in-window) -> no recurring data (history read-only)
 * CLOSED months always use their frozen snapshots; OPEN months use live masters.
 */
async function getMonth(userId, year, month) {
  const entry = await getEntry(userId, year, month)
  const monthState = monthStateOf(year, month)
  const access = accessOf(entry, monthState)

  let fixedExpenses
  let installments
  if (entry && entry.status === 'CLOSED') {
    ;[fixedExpenses, installments] = [await snapshotQuery(entry.id, userId), await installmentsForEntry(entry.id, userId)]
  } else if (entry && entry.status === 'OPEN') {
    ;[fixedExpenses, installments] = [await liveFixedExpenses(userId), await liveInstallments(userId)]
  } else if (monthState.isCurrent) {
    // Not opened yet: show today's expected recurring costs as a preview.
    ;[fixedExpenses, installments] = [await liveFixedExpenses(userId), await liveInstallments(userId)]
  } else {
    ;[fixedExpenses, installments] = [[], []]
  }

  const variableExpenses = await variableExpenseService.listForMonth(userId, year, month)

  const fixedTotal = sum(fixedExpenses.map((x) => x.amount))
  const installmentTotal = sum(installments.map((x) => x.monthlyInstallment))
  const variableTotal = sum(variableExpenses.map((x) => x.amount))

  return {
    entry,
    year,
    month,
    monthState,
    access,
    status: displayStatusOf(entry, monthState),
    fixedExpenses,
    installments,
    variableExpenses,
    totals: {
      fixed: fixedTotal,
      installments: installmentTotal,
      variable: variableTotal,
      total: fixedTotal + installmentTotal + variableTotal,
    },
  }
}

// Shared close step: runs inside an already-open transaction. Rebuilds the
// snapshot from the CURRENT active masters (delete + insert, so there are never
// duplicates), then marks the month CLOSED.
async function finalizeClose(client, entryId, userId) {
  await client.query('DELETE FROM belanja.monthly_fixed_expenses WHERE monthly_entry_id = $1', [entryId])
  await client.query('DELETE FROM belanja.monthly_installments WHERE monthly_entry_id = $1', [entryId])

  await client.query(
    `INSERT INTO belanja.monthly_fixed_expenses (monthly_entry_id, user_id, fixed_expense_id, name, type, amount, remarks)
     SELECT $1, user_id, id, name, type, amount, remarks
     FROM belanja.fixed_expenses
     WHERE user_id = $2 AND active`,
    [entryId, userId]
  )

  await client.query(
    `INSERT INTO belanja.monthly_installments (monthly_entry_id, user_id, installment_id, loan_name, type, monthly_installment, remarks)
     SELECT $1, user_id, id, loan_name, type, monthly_installment, remarks
     FROM belanja.installments
     WHERE user_id = $2 AND active`,
    [entryId, userId]
  )

  await client.query(
    `UPDATE belanja.monthly_entries
     SET status = 'CLOSED', closed_at = now(), updated_at = now()
     WHERE id = $1`,
    [entryId]
  )
}

/**
 * Explicitly open a month. Only the actual current calendar month may be opened
 * ("Open New Month"). Future months are rejected, and past months are corrected
 * through Reopen instead. Opening an already-open month is a safe no-op.
 */
async function openMonth(userId, year, month) {
  const monthState = monthStateOf(year, month)
  if (monthState.isFuture) throw new AppError(400, 'Cannot open a future month.')
  if (!monthState.isCurrent) {
    throw new AppError(409, 'Only the current month can be opened. Past months can be reopened instead.')
  }

  const entry = await getEntry(userId, year, month)
  if (entry && entry.status === 'OPEN') return { entry, alreadyOpen: true }
  if (entry && entry.status === 'CLOSED') {
    throw new AppError(409, 'This month is closed and cannot be opened. Use Reopen instead.')
  }

  await query(
    `INSERT INTO belanja.monthly_entries (user_id, year, month)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, year, month) DO NOTHING`,
    [userId, year, month]
  )
  const created = await getEntry(userId, year, month)
  return { entry: created, alreadyOpen: false }
}

/**
 * Close an OPEN month: snapshot the live active fixed expenses + installments
 * with their current values and mark the entry CLOSED. Transactional and
 * idempotent: closing an already-closed month is a no-op that returns the
 * existing frozen data unchanged (and never rebuilds its snapshot).
 */
async function closeMonth(userId, year, month) {
  const monthState = monthStateOf(year, month)
  if (monthState.isFuture) throw new AppError(400, 'Cannot close a future month.')

  const entry = await getEntry(userId, year, month)
  if (!entry) throw new AppError(409, 'This month is not open, so it cannot be closed.')
  if (entry.status === 'CLOSED') return { entry, alreadyClosed: true }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT id, year, month, status, closed_at, reopened_at
       FROM belanja.monthly_entries
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [entry.id, userId]
    )
    const locked = mapEntry(rows[0])
    if (locked.status === 'CLOSED') {
      await client.query('COMMIT')
      return { entry: locked, alreadyClosed: true }
    }
    await finalizeClose(client, locked.id, userId)
    await client.query('COMMIT')
    return { entry: { ...locked, status: 'CLOSED', closedAt: new Date() }, alreadyClosed: false }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Reopen a CLOSED month within the editable window (current + previous 3).
 * The frozen snapshot rows are intentionally KEPT while the month is open -
 * they are ignored by OPEN-month reads and are fully rebuilt (delete + insert)
 * the next time the month is closed, so no historical information is lost and
 * no duplicate snapshots can accumulate. The reopened-at marker tells the
 * auto-close logic that this month was deliberately reopened, so it stays open
 * for corrections and is not closed again behind the user's back.
 */
async function reopenMonth(userId, year, month) {
  const monthState = monthStateOf(year, month)
  if (monthState.isFuture) throw new AppError(400, 'Cannot reopen a future month.')
  if (!monthState.withinReopenWindow) throw new AppError(409, 'This month is outside the editable window and cannot be reopened.')

  const entry = await getEntry(userId, year, month)
  if (!entry) throw new AppError(409, 'This month is not closed, so it cannot be reopened.')
  if (entry.status === 'OPEN') throw new AppError(409, 'This month is already open.')

  await query(
    `UPDATE belanja.monthly_entries
     SET status = 'OPEN', closed_at = NULL, reopened_at = now(), updated_at = now()
     WHERE id = $1 AND user_id = $2`,
    [entry.id, userId]
  )
  return { entry: { ...entry, status: 'OPEN', closedAt: null, reopenedAt: new Date() }, reopened: true }
}

/**
 * Lazy maintenance run on API access (never on a timer):
 *   - OPEN months OUTSIDE the editable window (older than the last 3) or in the
 *     future are always closed - they must not stay open.
 *   - OPEN months WITHIN the window but older than the current month are the
 *     "left open when the calendar moved on" case (e.g. September left open
 *     when October arrives): they are closed UNLESS the user explicitly
 *     reopened them (reopened_at set), in which case they stay open for
 *     corrections until the user closes them.
 * Idempotent: only OPEN rows are selected, so closing never runs twice and no
 * duplicate snapshots can be created. Never opens any month automatically.
 */
async function autoCloseStaleMonths(userId) {
  const now = appNow()
  const currentIndex = monthIndex(now.year, now.month)

  const stale = await query(
    `SELECT id FROM belanja.monthly_entries
     WHERE user_id = $1 AND status = 'OPEN'
       AND (
         (year * 12 + (month - 1)) < $2
         OR (year * 12 + (month - 1)) > $3
         OR ((year * 12 + (month - 1)) BETWEEN $4 AND $5 AND reopened_at IS NULL)
       )`,
    [userId, currentIndex - 3, currentIndex, currentIndex - 3, currentIndex - 1]
  )
  if (!stale.rows.length) return 0

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT id FROM belanja.monthly_entries
       WHERE user_id = $1 AND status = 'OPEN'
         AND (
           (year * 12 + (month - 1)) < $2
           OR (year * 12 + (month - 1)) > $3
           OR ((year * 12 + (month - 1)) BETWEEN $4 AND $5 AND reopened_at IS NULL)
         )
       FOR UPDATE`,
      [userId, currentIndex - 3, currentIndex, currentIndex - 3, currentIndex - 1]
    )
    for (const { id } of rows) {
      await finalizeClose(client, id, userId)
    }
    await client.query('COMMIT')
    return rows.length
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

module.exports = {
  getMonth,
  openMonth,
  closeMonth,
  reopenMonth,
  autoCloseStaleMonths,
  getEntry,
  monthStateOf,
  accessOf,
}