'use strict'

const express = require('express')
const rateLimit = require('express-rate-limit')
const { config } = require('../config')
const { asyncHandler, AppError } = require('../utils/http')
const { validateBody } = require('../middleware/validate')
const { requireAuth } = require('../middleware/auth')
const authService = require('../services/authService')

const router = express.Router()

// Strict brute-force guard for credential entry points only.
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.rateLimit.authLogin,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { status: 'error', error: 'Too Many Requests', message: 'Too many attempts. Please try again later.' },
})
router.post('/register', strictLimiter)
router.post('/login', strictLimiter)

function unsetCookie(res) {
  res.clearCookie(config.authCookie.name, {
    httpOnly: config.authCookie.httpOnly,
    secure: config.authCookie.secure,
    sameSite: config.authCookie.sameSite,
    path: config.authCookie.path,
  })
}

function setCookie(res, token) {
  res.cookie(config.authCookie.name, token, {
    httpOnly: config.authCookie.httpOnly,
    secure: config.authCookie.secure,
    sameSite: config.authCookie.sameSite,
    path: config.authCookie.path,
    maxAge: config.authCookie.maxAge,
  })
}

const registerSchema = {
  name: (v) => {
    if (typeof v !== 'string' || v.trim().length < 1) return new AppError(400, 'name is required')
    if (v.trim().length > 100) return new AppError(400, 'name must be at most 100 characters')
    return v.trim().replace(/\s+/g, ' ')
  },
  email: (v) => {
    if (typeof v !== 'string' || v.trim() === '') return new AppError(400, 'email is required')
    return v.trim().toLowerCase()
  },
  password: (v) => {
    if (typeof v !== 'string' || v.length < 8) return new AppError(400, 'Password must be at least 8 characters long')
    return v
  },
}

const loginSchema = {
  email: (v) => {
    if (typeof v !== 'string' || v.trim() === '') return new AppError(400, 'email is required')
    return v.trim().toLowerCase()
  },
  password: (v) => {
    if (typeof v !== 'string' || v.length < 1) return new AppError(400, 'password is required')
    return v
  },
}

const profileSchema = {
  name: (v) => {
    if (typeof v !== 'string' || v.trim().length < 1) return new AppError(400, 'name is required')
    if (v.trim().length > 100) return new AppError(400, 'name must be at most 100 characters')
    return v.trim().replace(/\s+/g, ' ')
  },
}

// POST /api/auth/register
router.post(
  '/register',
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.clean
    const user = await authService.register({ name, email, password })
    const token = authService.issueToken(user)
    setCookie(res, token)
    res.status(201).json({ status: 'ok', token, user })
  })
)

// POST /api/auth/login
router.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.clean
    const { token, user } = await authService.login({ email, password })
    setCookie(res, token)
    res.json({ status: 'ok', token, user })
  })
)

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  unsetCookie(res)
  res.json({ status: 'ok', message: 'Logged out' })
})

// GET /api/auth/me
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await authService.me(req.user.id)
    res.json({ status: 'ok', user })
  })
)

// PUT /api/auth/me
router.put(
  '/me',
  requireAuth,
  validateBody(profileSchema),
  asyncHandler(async (req, res) => {
    const user = await authService.updateProfile(req.user.id, req.clean)
    res.json({ status: 'ok', user })
  })
)

module.exports = router