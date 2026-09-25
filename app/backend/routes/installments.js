'use strict'

const { Router } = require('express')
const { asyncHandler, AppError } = require('../utils/http')
const { validateBody, validateUuidParams } = require('../middleware/validate')
const { requireAuth } = require('../middleware/auth')
const { FIXED_EXPENSE_TYPES } = require('../utils/constants')
const {
  validateName,
  validateAmount,
  validateType,
  validateRemarks,
  validateDate,
  validateInteger,
  validateBoolean,
} = require('../utils/validators')
const installmentService = require('../services/installmentService')

const router = Router()

router.use(requireAuth)
router.use(validateUuidParams('id'))

const dateValidator = (field) => (v) => {
  if (v === undefined || v === null || v === '') return null
  const result = validateDate(v, field)
  if (result instanceof AppError) return result
  return result.date
}

const bodySchema = {
  loanName: validateName,
  type: (v) => validateType(v, FIXED_EXPENSE_TYPES),
  amount: validateAmount,
  totalMonths: (v) => validateInteger(v, { field: 'totalMonths', min: 1, max: 600 }),
  paidMonths: (v) => validateInteger(v, { field: 'paidMonths', min: 0, max: 600, required: false }),
  monthlyInstallment: (v, f) => {
    const r = validateAmount(v, f)
    if (r instanceof AppError) return r
    if (r <= 0) return new AppError(400, `${f} must be greater than 0`)
    return r
  },
  startDate: dateValidator('startDate'),
  endDate: dateValidator('endDate'),
  remarks: (v) => (v === undefined || v === null ? null : validateRemarks(v)),
  active: (v) => (v === undefined ? undefined : validateBoolean(v, 'active')),
}

// GET /api/installments
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await installmentService.listForUser(req.user.id)
    res.json({ status: 'ok', items })
  })
)

// POST /api/installments
router.post(
  '/',
  validateBody(bodySchema),
  asyncHandler(async (req, res) => {
    const item = await installmentService.create(req.user.id, req.clean)
    res.status(201).json({ status: 'ok', item })
  })
)

// PUT /api/installments/:id
router.put(
  '/:id',
  validateBody(bodySchema),
  asyncHandler(async (req, res) => {
    const item = await installmentService.update(req.user.id, req.params.id, req.clean)
    res.json({ status: 'ok', item })
  })
)

// PATCH /api/installments/:id/active
router.patch(
  '/:id/active',
  validateBody({ active: (v) => validateBoolean(v, 'active') }),
  asyncHandler(async (req, res) => {
    if (typeof req.clean.active !== 'boolean') throw new AppError(400, 'active is required (true or false)')
    const item = await installmentService.toggleActive(req.user.id, req.params.id, req.clean.active)
    res.json({ status: 'ok', item })
  })
)

// DELETE /api/installments/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await installmentService.remove(req.user.id, req.params.id)
    res.json({ status: 'ok', message: 'Installment deleted' })
  })
)

module.exports = router