'use strict'

const { Router } = require('express')
const { asyncHandler, AppError } = require('../utils/http')
const { requireAuth } = require('../middleware/auth')
const { validateYear, validateMonth } = require('../utils/validators')
const { appNow } = require('../utils/time')
const monthlyService = require('../services/monthlyService')

const router = Router()

router.use(requireAuth)

// Lazy auto-close: whenever a logged-in user touches a monthly endpoint, any
// of their OPEN months older than the current calendar month are closed with
// the normal snapshot logic. Idempotent and never opens months automatically.
router.use(
  asyncHandler(async (req, _res, next) => {
    await monthlyService.autoCloseStaleMonths(req.user.id)
    next()
  })
)

function parseYearMonth(req) {
  const { year, month } = req.params
  const y = validateYear(year)
  const m = validateMonth(month)
  if (y instanceof AppError) throw y
  if (m instanceof AppError) throw m
  return { year: y, month: m }
}

// GET /api/monthly/current  -> server's current calendar month (APP_TIMEZONE).
// Used by the UI to pick the default month and the "Today" navigation target.
router.get(
  '/current',
  asyncHandler(async (_req, res) => {
    const now = appNow()
    res.json({ status: 'ok', year: now.year, month: now.month })
  })
)

// GET /api/monthly/:year/:month  (read-only - never creates an entry)
router.get(
  '/:year/:month',
  asyncHandler(async (req, res) => {
    const { year, month } = parseYearMonth(req)
    const payload = await monthlyService.getMonth(req.user.id, year, month)
    res.json({ status: 'ok', ...payload })
  })
)

// POST /api/monthly/:year/:month/open
router.post(
  '/:year/:month/open',
  asyncHandler(async (req, res) => {
    const { year, month } = parseYearMonth(req)
    const result = await monthlyService.openMonth(req.user.id, year, month)
    const payload = await monthlyService.getMonth(req.user.id, year, month)
    res.json({
      status: 'ok',
      alreadyOpen: result.alreadyOpen,
      message: result.alreadyOpen ? 'Month is already open.' : 'Month opened.',
      ...payload,
    })
  })
)

// POST /api/monthly/:year/:month/close
router.post(
  '/:year/:month/close',
  asyncHandler(async (req, res) => {
    const { year, month } = parseYearMonth(req)
    const result = await monthlyService.closeMonth(req.user.id, year, month)
    const payload = await monthlyService.getMonth(req.user.id, year, month)
    res.json({
      status: 'ok',
      alreadyClosed: result.alreadyClosed,
      message: result.alreadyClosed ? 'Month was already closed and is read-only.' : 'Month closed.',
      ...payload,
    })
  })
)

// POST /api/monthly/:year/:month/reopen
router.post(
  '/:year/:month/reopen',
  asyncHandler(async (req, res) => {
    const { year, month } = parseYearMonth(req)
    const result = await monthlyService.reopenMonth(req.user.id, year, month)
    const payload = await monthlyService.getMonth(req.user.id, year, month)
    res.json({
      status: 'ok',
      reopened: result.reopened,
      message: 'Month reopened. You can modify allowed data again.',
      ...payload,
    })
  })
)

module.exports = router