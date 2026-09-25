'use strict'

const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { query } = require('../db/pool')
const { config } = require('../config')
const { AppError } = require('../utils/http')

const BCRYPT_ROUNDS = 12

function normalizeEmail(email) {
  return String(email).trim().toLowerCase()
}

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function register({ name, email, password }) {
  const normalizedEmail = normalizeEmail(email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new AppError(400, 'Please provide a valid email address')
  }
  if (password.length < 8) {
    throw new AppError(400, 'Password must be at least 8 characters long')
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

  try {
    const { rows } = await query(
      `INSERT INTO belanja.users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, created_at, updated_at`,
      [name, normalizedEmail, passwordHash]
    )
    return publicUser(rows[0])
  } catch (err) {
    if (err.code === '23505') {
      throw new AppError(409, 'An account with this email already exists')
    }
    throw err
  }
}

async function login({ email, password }) {
  const normalizedEmail = normalizeEmail(email)
  const { rows } = await query(
    'SELECT id, name, email, password_hash FROM belanja.users WHERE email = $1',
    [normalizedEmail]
  )

  const user = rows[0]
  if (!user) {
    throw new AppError(401, 'Invalid email or password')
  }

  const ok = await bcrypt.compare(password, user.password_hash)
  if (!ok) {
    throw new AppError(401, 'Invalid email or password')
  }

  return { token: issueToken(user), user: publicUser(user) }
}

function issueToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  })
}

async function me(userId) {
  const { rows } = await query(
    'SELECT id, name, email, created_at, updated_at FROM belanja.users WHERE id = $1',
    [userId]
  )
  if (!rows[0]) throw new AppError(404, 'User not found')
  return publicUser(rows[0])
}

async function updateProfile(userId, { name }) {
  const { rows } = await query(
    `UPDATE belanja.users SET name = $1 WHERE id = $2
     RETURNING id, name, email, created_at, updated_at`,
    [name, userId]
  )
  if (!rows[0]) throw new AppError(404, 'User not found')
  return publicUser(rows[0])
}

module.exports = { register, login, me, updateProfile, issueToken }