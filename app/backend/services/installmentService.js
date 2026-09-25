'use strict'

const { query } = require('../db/pool')
const { AppError } = require('../utils/http')

function addMonths(dateStr, amount) {
  if (!dateStr) return null
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + amount)
  return d.toISOString().slice(0, 10)
}

function mapRow(row) {
  return {
    id: row.id,
    loanName: row.loan_name,
    type: row.type,
    amount: Number(row.amount),
    totalMonths: row.total_months,
    paidMonths: row.paid_months,
    remainingMonths: row.remaining_months,
    monthlyInstallment: Number(row.monthly_installment),
    startDate: row.start_date,
    endDate: row.end_date,
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
    `SELECT id, loan_name, type, amount, total_months, paid_months, remaining_months,
            monthly_installment, start_date, end_date, remarks, active, created_at, updated_at
     FROM belanja.installments
     WHERE ${where}
     ORDER BY active DESC, created_at ASC`,
    [userId]
  )
  return rows.map(mapRow)
}

async function getForUser(userId, id) {
  const { rows } = await query(
    `SELECT id, loan_name, type, amount, total_months, paid_months, remaining_months,
            monthly_installment, start_date, end_date, remarks, active, created_at, updated_at
     FROM belanja.installments
     WHERE id = $1 AND user_id = $2`,
    [id, userId]
  )
  return rows[0] ? mapRow(rows[0]) : null
}

async function create(userId, input) {
  const {
    loanName,
    type,
    amount,
    totalMonths,
    paidMonths = 0,
    monthlyInstallment,
    startDate = null,
    endDate = null,
    remarks = null,
    active = true,
  } = input

  if (paidMonths > totalMonths) {
    throw new AppError(400, 'paid_months cannot be greater than total_months')
  }

  const resolvedEndDate = endDate || addMonths(startDate, totalMonths)

  const { rows } = await query(
    `INSERT INTO belanja.installments
       (user_id, loan_name, type, amount, total_months, paid_months,
        monthly_installment, start_date, end_date, remarks, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, loan_name, type, amount, total_months, paid_months, remaining_months,
               monthly_installment, start_date, end_date, remarks, active, created_at, updated_at`,
    [userId, loanName, type, amount, totalMonths, paidMonths, monthlyInstallment, startDate, resolvedEndDate, remarks, active]
  )
  return mapRow(rows[0])
}

async function update(userId, id, input) {
  const existing = await getForUser(userId, id)
  if (!existing) throw new AppError(404, 'Installment not found')

  const {
    loanName,
    type,
    amount,
    totalMonths,
    paidMonths,
    monthlyInstallment,
    startDate,
    endDate,
    remarks,
    active,
  } = input

  if (paidMonths > totalMonths) {
    throw new AppError(400, 'paid_months cannot be greater than total_months')
  }

  const resolvedPaidMonths = paidMonths ?? existing.paidMonths
  const resolvedActive = active ?? existing.active
  const resolvedStartDate = startDate ?? existing.startDate
  const resolvedEndDateValue = endDate ?? existing.endDate
  const resolvedEndDate = resolvedEndDateValue || addMonths(resolvedStartDate, totalMonths)
  const resolvedRemarks = remarks === undefined ? existing.remarks : remarks ?? null

  const { rows } = await query(
    `UPDATE belanja.installments
     SET loan_name = $1, type = $2, amount = $3, total_months = $4, paid_months = $5,
         monthly_installment = $6, start_date = $7, end_date = $8, remarks = $9,
         active = $10, updated_at = now()
     WHERE id = $11 AND user_id = $12
     RETURNING id, loan_name, type, amount, total_months, paid_months, remaining_months,
               monthly_installment, start_date, end_date, remarks, active, created_at, updated_at`,
    [loanName, type, amount, totalMonths, resolvedPaidMonths, monthlyInstallment, resolvedStartDate, resolvedEndDate, resolvedRemarks, resolvedActive, id, userId]
  )
  return mapRow(rows[0])
}

async function toggleActive(userId, id, active) {
  const existing = await getForUser(userId, id)
  if (!existing) throw new AppError(404, 'Installment not found')

  const { rows } = await query(
    `UPDATE belanja.installments
     SET active = $1, updated_at = now()
     WHERE id = $2 AND user_id = $3
     RETURNING id, loan_name, type, amount, total_months, paid_months, remaining_months,
               monthly_installment, start_date, end_date, remarks, active, created_at, updated_at`,
    [active, id, userId]
  )
  return mapRow(rows[0])
}

async function remove(userId, id) {
  const result = await query(
    'DELETE FROM belanja.installments WHERE id = $1 AND user_id = $2',
    [id, userId]
  )
  if (result.rowCount === 0) throw new AppError(404, 'Installment not found')
  return true
}

module.exports = { listForUser, getForUser, create, update, toggleActive, remove }