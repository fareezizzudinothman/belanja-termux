'use strict'

const { AppError } = require('./http')

const NAME_MAX = 150
const REMARKS_MAX = 1000
const AMOUNT_MAX = 9999999999.99

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\s+/g, ' ')
    .trim()
}

function validateName(value, field = 'name') {
  const name = cleanText(value)
  if (!name) return new AppError(400, `${field} is required`)
  if (name.length > NAME_MAX) return new AppError(400, `${field} must be at most ${NAME_MAX} characters`)
  return name
}

function validateRemarks(value) {
  const remarks = cleanText(value)
  if (remarks.length > REMARKS_MAX) {
    return new AppError(400, `remarks must be at most ${REMARKS_MAX} characters`)
  }
  return remarks
}

function parseAmount(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return new AppError(400, 'amount must be a valid number')
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return new AppError(400, 'amount must be a valid number')
}

function validateAmount(value, field = 'amount') {
  const amount = parseAmount(value)
  if (amount instanceof AppError) return amount
  if (amount < 0) return new AppError(400, `${field} cannot be negative`)
  if (amount > AMOUNT_MAX) return new AppError(400, `${field} is too large`)
  // Reject more than 2 decimals (sane for currency).
  if (Math.round(amount * 100) !== amount * 100) {
    return new AppError(400, `${field} must have at most 2 decimal places`)
  }
  return amount
}

function validateType(value, allowed, field = 'type') {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    return new AppError(400, `${field} must be one of: ${allowed.join(', ')}`)
  }
  return value
}

function validateMonth(value) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 12) return new AppError(400, 'month must be an integer between 1 and 12')
  return n
}

function validateYear(value) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 2000 || n > 2100) return new AppError(400, 'year must be an integer between 2000 and 2100')
  return n
}

function validateDate(value, field) {
  if (value === undefined || value === null || value === '') return null
  const s = String(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return new AppError(400, `${field} must be a date in YYYY-MM-DD format`)
  const d = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return new AppError(400, `${field} must be a valid date`)
  return { date: s, obj: d }
}

function validateInteger(value, { field, min, max, required = true }) {
  const n = Number(value)
  if (!Number.isInteger(n)) {
    if (!required && (value === undefined || value === null || value === '')) return undefined
    return new AppError(400, `${field} must be an integer`)
  }
  if (min !== undefined && n < min) return new AppError(400, `${field} must be at least ${min}`)
  if (max !== undefined && n > max) return new AppError(400, `${field} must be at most ${max}`)
  return n
}

function validateBoolean(value, field) {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1 || value === '1') return true
  if (value === 'false' || value === 0 || value === '0') return false
  return new AppError(400, `${field} must be a boolean`)
}

function toError(result) {
  if (result instanceof AppError) return result
  if (result && typeof result === 'object' && result.error instanceof AppError) return result.error
  return null
}

const s = (x) => String(x)
const MONEY = new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

module.exports = {
  isPlainObject,
  cleanText,
  validateName,
  validateRemarks,
  validateAmount,
  validateType,
  validateMonth,
  validateYear,
  validateDate,
  validateInteger,
  validateBoolean,
  toError,
  MONEY,
}