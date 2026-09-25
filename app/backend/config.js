'use strict'

const path = require('path')

// Load .env from the app root (parent of backend/) so the same file works in
// Docker (app/ is the build context), for local runs, and migrations.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })
require('dotenv').config()

const env = process.env

function required(name) {
  const value = env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

const isProduction = env.NODE_ENV === 'production'

const config = {
  env: env.NODE_ENV || 'development',
  isProduction,

  // Host the HTTP server binds to. 0.0.0.0 keeps the Docker/nginx setup working;
  // Termux sets HOST=127.0.0.1 so the app is reachable only on the phone itself.
  host: env.HOST || '0.0.0.0',
  port: Number(env.PORT || 4000),
  databaseUrl: env.DATABASE_URL,
  databaseSchema: env.POSTGRES_SCHEMA || 'belanja',
  // IANA timezone that defines the app's "current calendar month". All monthly
  // lifecycle rules derive from this, so it must never leak a different clock.
  appTimeZone: env.APP_TIMEZONE || 'Asia/Kuala_Lumpur',

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: env.JWT_EXPIRES_IN || '7d',
  },

  authCookie: {
    name: 'belanja_token',
    // httpOnly + secure cookie for production; SameSite Strict mitigates CSRF.
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (keep in sync with JWT expiry)
  },

  corsOrigin: (env.CORS_ORIGIN || 'http://localhost:8080')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Rate limiting (requests per 15-minute window per IP).
  rateLimit: {
    auth: Number(env.RATE_LIMIT_AUTH || 300), // /api/auth (includes /me on every page load)
    authLogin: Number(env.RATE_LIMIT_AUTH_LOGIN || 30), // strict: login + register only
    api: Number(env.RATE_LIMIT_API || 600), // every other /api endpoint
  },

  // Internal database password is intentionally NOT read here in plain form;
  // it flows through DATABASE_URL only.
  requireDb: toBool(env.REQUIRE_DB, true),
}

if (!config.databaseUrl) {
  if (config.requireDb) {
    throw new Error('Missing required environment variable: DATABASE_URL')
  }
  config.databaseUrl = 'postgres://postgres:postgres@localhost:5432/postgres'
}

module.exports = { config, required, toBool }