'use strict'

const { query } = require('../db/pool')
const { AppError } = require('../utils/http')

function mapRow(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    amount: Number(row.amount),
    remarks: row.remarks,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function listForUser(userId, options = {}) {
  const { includeInactive = true } = options
  const where = includeInactive ? `user_id = $1` : `user_id = $1 AND active`
  const { rows } = await query(
    `SELECT id, name, type, amount, remarks, active, created_at, updated_at
     FROM belanja.fixed_expenses
     WHERE ${where}
     ORDER BY active DESC, created_at ASC`,
    [userId]
  )
  return rows.map(mapRow)
}

async function getForUser(userId, id) {
  const { rows } = await query(
    `SELECT id, name, type, amount, remarks, active, created_at, updated_at
     FROM belanja.fixed_expenses
     WHERE id = $1 AND user_id = $2`,
    [id, userId]
  )
  return rows[0] ? mapRow(rows[0]) : null
}

async function create(userId, input) {
  const { name, type, amount, remarks, active } = input
  const { rows } = await query(
    `INSERT INTO belanja.fixed_expenses (user_id, name, type, amount, remarks, active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, type, amount, remarks, active, created_at, updated_at`,
    [userId, name, type, amount, remarks ?? null, active ?? true]
  )
  return mapRow(rows[0])
}

async function update(userId, id, input) {
  const existing = await getForUser(userId, id)
  if (!existing) throw new AppError(404, 'Fixed expense not found')

  const { name, type, amount, remarks, active } = input
  const resolvedActive = active ?? existing.active
  const resolvedRemarks = remarks === undefined ? existing.remarks : remarks ?? null

  const { rows } = await query(
    `UPDATE belanja.fixed_expenses
     SET name = $1, type = $2, amount = $3, remarks = $4, active = $5, updated_at = now()
     WHERE id = $6 AND user_id = $7
     RETURNING id, name, type, amount, remarks, active, created_at, updated_at`,
    [name, type, amount, resolvedRemarks, resolvedActive, id, userId]
  )
  return mapRow(rows[0])
}

async function toggleActive(userId, id, active) {
  const existing = await getForUser(userId, id)
  if (!existing) throw new AppError(404, 'Fixed expense not found')

  const { rows } = await query(
    `UPDATE belanja.fixed_expenses
     SET active = $1, updated_at = now()
     WHERE id = $2 AND user_id = $3
     RETURNING id, name, type, amount, remarks, active, created_at, updated_at`,
    [active, id, userId]
  )
  return mapRow(rows[0])
}

async function remove(userId, id) {
  const result = await query(
    'DELETE FROM belanja.fixed_expenses WHERE id = $1 AND user_id = $2',
    [id, userId]
  )
  if (result.rowCount === 0) throw new AppError(404, 'Fixed expense not found')
  return true
}

module.exports = { listForUser, getForUser, create, update, toggleActive, remove }