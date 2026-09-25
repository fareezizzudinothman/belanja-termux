'use strict'

const { config } = require('../config')

// Request logging, gated by LOG_REQUESTS (see config.js).
//
// Default Termux mode (LOG_REQUESTS unset / false) keeps the log quiet:
// static-file requests (html/css/js/images) are skipped entirely, only failed
// /api responses (>= 400) and every error are recorded. With LOG_REQUESTS=true
// every non-static request is logged with its duration so the app can be
// profiled per navigation.
const STATIC_RE = /\.(html|css|js|json|webmanifest|png|jpe?g|gif|svg|ico|woff2?)$/

function shouldLog(path) {
  if (!config.logRequests) return false
  return !STATIC_RE.test(path) || path === '/'
}

function requestLogger(req, res, next) {
  const start = Date.now()
  res.on('finish', () => {
    const status = res.statusCode
    if (config.logRequests) {
      if (!shouldLog(req.path)) return
      console.log(`${req.method} ${req.originalUrl} -> ${status} (${Date.now() - start}ms)`)
    } else if (status >= 400 && req.path.startsWith('/api/')) {
      console.log(`${req.method} ${req.originalUrl} -> ${status} (${Date.now() - start}ms)`)
    }
  })
  next()
}

module.exports = { requestLogger }