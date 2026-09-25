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
  validateBoolean,
} = require('../utils/validators')
const fixedExpenseService = require('../services/fixedExpenseService')

const router = Router()

router.use(requireAuth)
router.use(validateUuidParams('id'))

const bodySchema = {
  name: validateName,
  type: (v) => validateType(v, FIXED_EXPENSE_TYPES),
  amount: validateAmount,
  remarks: (v) => (v === undefined || v === null ? null : validateRemarks(v)),
  active: (v) => (v === undefined ? undefined : validateBoolean(v, 'active')),
}

// GET /api/fixed-expenses
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await fixedExpenseService.listForUser(req.user.id)
    res.json({ status: 'ok', items })
  })
)

// POST /api/fixed-expenses
router.post(
  '/',
  validateBody(bodySchema),
  asyncHandler(async (req, res) => {
    const item = await fixedExpenseService.create(req.user.id, req.clean)
    res.status(201).json({ status: 'ok', item })
  })
)

// PUT /api/fixed-expenses/:id
router.put(
  '/:id',
  validateBody(bodySchema),
  asyncHandler(async (req, res) => {
    const item = await fixedExpenseService.update(req.user.id, req.params.id, req.clean)
    res.json({ status: 'ok', item })
  })
)

// PATCH /api/fixed-expenses/:id/active   (enable/disable without editing)
router.patch(
  '/:id/active',
  validateBody({ active: (v) => validateBoolean(v, 'active') }),
  asyncHandler(async (req, res) => {
    if (typeof req.clean.active !== 'boolean') throw new AppError(400, 'active is required (true or false)')
    const item = await fixedExpenseService.toggleActive(req.user.id, req.params.id, req.clean.active)
    res.json({ status: 'ok', item })
  })
)

// DELETE /api/fixed-expenses/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await fixedExpenseService.remove(req.user.id, req.params.id)
    res.json({ status: 'ok', message: 'Fixed expense deleted' })
  })
)

module.exports = router