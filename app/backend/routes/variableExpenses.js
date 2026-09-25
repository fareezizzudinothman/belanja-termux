'use strict'

const { Router } = require('express')
const { asyncHandler, AppError } = require('../utils/http')
const { validateBody, validateUuidParams } = require('../middleware/validate')
const { requireAuth } = require('../middleware/auth')
const { VARIABLE_EXPENSE_TYPES } = require('../utils/constants')
const monthlyService = require('../services/monthlyService')
const {
  validateName,
  validateAmount,
  validateType,
  validateRemarks,
  validateDate,
  validateYear,
  validateMonth,
} = require('../utils/validators')
const variableExpenseService = require('../services/variableExpenseService')

const router = Router()

router.use(requireAuth)
router.use(validateUuidParams('id'))

// Monthly lifecycle maintenance runs on any authenticated request too (lazy
// auto-close of stale OPEN months). Idempotent and never opens months.
router.use(
  asyncHandler(async (req, _res, next) => {
    await monthlyService.autoCloseStaleMonths(req.user.id)
    next()
  })
)

const bodySchema = {
  name: validateName,
  type: (v) => validateType(v, VARIABLE_EXPENSE_TYPES),
  amount: validateAmount,
  expenseDate: (v) => {
    const result = validateDate(v, 'expenseDate')
    if (result instanceof AppError) return result
    return result.obj // Date object
  },
  remarks: (v) => (v === undefined || v === null ? null : validateRemarks(v)),
}

// GET /api/variable-expenses?year=2026&month=9
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { year, month } = req.query
    if (year !== undefined || month !== undefined) {
      const y = year === undefined ? undefined : validateYear(year)
      const m = month === undefined ? undefined : validateMonth(month)
      if (y instanceof AppError) throw y
      if (m instanceof AppError) throw m
      const items = await variableExpenseService.listForMonth(req.user.id, y || new Date().getUTCFullYear(), m || 1)
      return res.json({ status: 'ok', items })
    }
    const items = await variableExpenseService.listForUser(req.user.id)
    return res.json({ status: 'ok', items })
  })
)

// POST /api/variable-expenses
router.post(
  '/',
  validateBody(bodySchema),
  asyncHandler(async (req, res) => {
    const item = await variableExpenseService.create(req.user.id, req.clean)
    res.status(201).json({ status: 'ok', item })
  })
)

// PUT /api/variable-expenses/:id
router.put(
  '/:id',
  validateBody(bodySchema),
  asyncHandler(async (req, res) => {
    const item = await variableExpenseService.update(req.user.id, req.params.id, req.clean)
    res.json({ status: 'ok', item })
  })
)

// DELETE /api/variable-expenses/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await variableExpenseService.remove(req.user.id, req.params.id)
    res.json({ status: 'ok', message: 'Variable expense deleted' })
  })
)

module.exports = router