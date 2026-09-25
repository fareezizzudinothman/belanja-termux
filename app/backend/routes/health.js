'use strict'

const { Router } = require('express')
const { asyncHandler } = require('../utils/http')
const { checkConnection } = require('../db/pool')

const router = Router()

// GET /api/health
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    let database = 'connected'
    try {
      const ok = await checkConnection()
      if (!ok) database = 'error'
    } catch {
      database = 'disconnected'
    }
    res.json({ status: 'ok', database, timestamp: new Date().toISOString() })
  })
)

module.exports = router