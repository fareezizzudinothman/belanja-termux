'use strict'

const jwt = require('jsonwebtoken')
const { config } = require('../config')
const { AppError } = require('../utils/http')

// Reads the token from the httpOnly cookie first; falls back to the
// Authorization: Bearer header (handy for API tooling). The user_id is always
// taken from the verified token — never from the client body/query.
function authenticate(req, _res, next) {
  let token = req.cookies?.[config.authCookie.name]

  const header = req.headers.authorization
  if (!token && header && header.startsWith('Bearer ')) {
    token = header.slice(7)
  }

  if (!token) {
    return next(new AppError(401, 'Authentication required. Please log in.'))
  }

  try {
    const payload = jwt.verify(token, config.jwt.secret)
    if (!payload.sub) throw new Error('missing subject')
    req.user = { id: payload.sub, email: payload.email || null }
    return next()
  } catch {
    return next(new AppError(401, 'Session is invalid or has expired. Please log in again.'))
  }
}

function requireAuth(req, res, next) {
  authenticate(req, res, next)
}

module.exports = { authenticate, requireAuth }