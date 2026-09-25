'use strict'

const { query } = require('../db/pool')
const { AppError } = require('../utils/http')
const { appNow, monthIndex } = require('../utils/time')

function mapRow(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    amount: Number(row.amount),
    expenseDate: row.expense_date,
    year: row.year,
    month: row.month,
    remarks: row.remarks,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// A variable expense belongs to the month of its expense_date. Mutations are
// allowed only when that month's entry is explicitly OPEN and within the
// editable window (current + previous 3). CLOSED months are read-only, months
// that were never opened must be opened first, and future/old-history months
// are never editable.
async function assertMonthOpen(userId, year, month) {
  const { rows } = await query(
    `SELECT status FROM belanja.monthly_entries
     WHERE user_id = $1 AND year = $2 AND month = $3`,
    [userId, year, month]
  )
  const entry = rows[0]

  const now = appNow()
  const currentIndex = monthIndex(now.year, now.month)
  const idx = monthIndex(year, month)
  if (idx > currentIndex) throw new AppError(400, 'Cannot modify a future month.')
  if (idx < currentIndex - 3) throw new AppError(409, 'This month is outside the editable window and is read-only.')
  if (!entry) throw new AppError(409, 'This month is not open. Open it before recording expenses.')
  if (entry.status === 'CLOSED') {
    throw new AppError(409, 'This month is closed and is read-only. Open expenses can no longer be modified.')
  }
}

async function listForMonth(userId, year, month) {
  const { rows } = await query(
    `SELECT id, name, type, amount, expense_date, year, month, remarks, created_at, updated_at
     FROM belanja.variable_expenses
     WHERE user_id = $1 AND year = $2 AND month = $3
     ORDER BY expense_date ASC, created_at ASC`,
    [userId, year, month]
  )
  return rows.map(mapRow)
}

async function listForUser(userId) {
  const { rows } = await query(
    `SELECT id, name, type, amount, expense_date, year, month, remarks, created_at, updated_at
     FROM belanja.variable_expenses
     WHERE user_id = $1
     ORDER BY expense_date DESC, created_at DESC`,
    [userId]
  )
  return rows.map(mapRow)
}

async function getForUser(userId, id) {
  const { rows } = await query(
    `SELECT id, name, type, amount, expense_date, year, month, remarks, created_at, updated_at
     FROM belanja.variable_expenses
     WHERE id = $1 AND user_id = $2`,
    [id, userId]
  )
  return rows[0] ? mapRow(rows[0]) : null
}

async function create(userId, input) {
  const { name, type, amount, expenseDate, remarks } = input
  const year = expenseDate.getUTCFullYear()
  const month = expenseDate.getUTCMonth() + 1
  await assertMonthOpen(userId, year, month)

  const { rows } = await query(
    `INSERT INTO belanja.variable_expenses (user_id, name, type, amount, expense_date, remarks)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, type, amount, expense_date, year, month, remarks, created_at, updated_at`,
    [userId, name, type, amount, expenseDate, remarks ?? null]
  )
  return mapRow(rows[0])
}

async function update(userId, id, input) {
  const existing = await getForUser(userId, id)
  if (!existing) throw new AppError(404, 'Variable expense not found')
  // Expensive path safety: if the existing record or the new date belongs to a
  // closed month, editing is not allowed.
  await assertMonthOpen(userId, existing.year, existing.month)

  const { name, type, amount, expenseDate, remarks } = input
  const year = expenseDate.getUTCFullYear()
  const month = expenseDate.getUTCMonth() + 1
  await assertMonthOpen(userId, year, month)

  const { rows } = await query(
    `UPDATE belanja.variable_expenses
     SET name = $1, type = $2, amount = $3, expense_date = $4, remarks = $5, updated_at = now()
     WHERE id = $6 AND user_id = $7
     RETURNING id, name, type, amount, expense_date, year, month, remarks, created_at, updated_at`,
    [name, type, amount, expenseDate, remarks ?? null, id, userId]
  )
  return mapRow(rows[0])
}

async function remove(userId, id) {
  const existing = await getForUser(userId, id)
  if (!existing) throw new AppError(404, 'Variable expense not found')
  await assertMonthOpen(userId, existing.year, existing.month)

  const result = await query(
    'DELETE FROM belanja.variable_expenses WHERE id = $1 AND user_id = $2',
    [id, userId]
  )
  return true
}

async function sumByMonth(userId, year, month) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM belanja.variable_expenses
     WHERE user_id = $1 AND year = $2 AND month = $3`,
    [userId, year, month]
  )
  return Number(rows[0].total)
}

module.exports = {
  listForMonth,
  listForUser,
  getForUser,
  create,
  update,
  remove,
  sumByMonth,
  assertMonthOpen,
}