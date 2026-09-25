'use strict'

const { Router } = require('express')
const { asyncHandler } = require('../utils/http')
const { requireAuth } = require('../middleware/auth')
const dashboardService = require('../services/dashboardService')

const router = Router()

// GET /api/dashboard
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = await dashboardService.dashboard(req.user.id)
    res.json({ status: 'ok', ...payload })
  })
)

module.exports = router