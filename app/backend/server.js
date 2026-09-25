'use strict'

const fs = require('fs')
const path = require('path')
const express = require('express')
const helmet = require('helmet')
const cookieParser = require('cookie-parser')
const rateLimit = require('express-rate-limit')
const { config } = require('./config')
const { requestLogger } = require('./middleware/requestLogger')
const { notFoundHandler, errorHandler } = require('./utils/http')

const app = express()

// Nginx sits in front and forwards the real client address.
app.set('trust proxy', 1)

// Secure HTTP headers.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'same-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // inline styles used by dynamic elements
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        // Only upgrade to HTTPS when behind TLS (production / Cloudflare).
        // Local plain-HTTP development must not force https subresources.
        upgradeInsecureRequests: config.isProduction ? [] : null,
      },
    },
  })
)

// CORS: same-origin requests (any host the app is reached on, e.g. localhost,
// a LAN IP, or a Cloudflare domain) are always allowed. Cross-origin requests
// are allowed only when their origin is in the CORS_ORIGIN allowlist.
// Combined with SameSite=Strict httpOnly cookies this keeps cross-site access safe.
function isSameOrigin(origin, req) {
  try {
    const o = new URL(origin)
    const h = String(req.headers.host || '').toLowerCase()
    const b = h.split(':')
    const oPort = o.port || (o.protocol === 'https:' ? '443' : '80')
    const rPort = b.length > 1 ? b[1] : '80'
    if (o.hostname.toLowerCase() !== b[0]) return false
    if (oPort === rPort) return true
    return (oPort === '80' || oPort === '443') && (rPort === '80' || rPort === '443')
  } catch {
    return false
  }
}
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    const allowed = config.corsOrigin.includes(origin) || isSameOrigin(origin, req);
    if (!allowed) {
      return res.status(403).json({ status: 'error', error: 'Forbidden', message: 'Request origin is not allowed.' });
    }
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

app.set('etag', false)
app.use(express.json({ limit: '100kb' }))
app.use(cookieParser())
app.use(requestLogger)

// Never cache API responses: personal financial data stays fresh and the
// httpOnly session cookie is always re-validated (no heuristic 304 reuse).
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

// Rate limiting.
const rateLimitOptions = (limit) => ({
  windowMs: 15 * 60 * 1000,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { status: 'error', error: 'Too Many Requests', message: 'Too many requests. Please try again later.' },
})
app.use('/api/auth', rateLimit(rateLimitOptions(config.rateLimit.auth)))
app.use('/api', rateLimit(rateLimitOptions(config.rateLimit.api)))

// Routes.
app.use('/api/health', require('./routes/health'))
app.use('/api/auth', require('./routes/auth'))
app.use('/api/fixed-expenses', require('./routes/fixedExpenses'))
app.use('/api/variable-expenses', require('./routes/variableExpenses'))
app.use('/api/installments', require('./routes/installments'))
app.use('/api/monthly', require('./routes/monthly'))
app.use('/api/dashboard', require('./routes/dashboard'))

// Static frontend (Path 2 of the app).
// In the Docker/nginx layout nginx already serves ./frontend and only
// /api/* reaches this server, so this block is inert there. In Termux there is
// no nginx, so the Express server also serves the static shell on the same port
// (http://127.0.0.1:3000). Mirroring the nginx cache headers keeps the PWA
// service worker behaviour identical.
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend')
if (fs.existsSync(FRONTEND_DIR)) {
  const setHeaders = (res, filePath) => {
    if (filePath.endsWith('service-worker.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    } else if (/\.(css|js|png|jpe?g|svg|ico|woff2?)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=3600')
    }
  }
  app.use(express.static(FRONTEND_DIR, { setHeaders, index: 'index.html' }))

  // nginx `try_files $uri $uri/ /index.html`: unknown non-API paths fall back to
  // the SPA shell so deep links work. API 404s still return JSON (below).
  app.get(/^\/(?!api\/)/, (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')))
}

app.use(notFoundHandler)
app.use(errorHandler)

async function start() {
  // Apply database migrations before accepting traffic.
  if (config.isProduction || (process.env.RUN_MIGRATIONS ?? 'true') === 'true') {
    const { migrate } = require('./db/migrate')
    await migrate()
  }

  const { checkConnection, closePool } = require('./db/pool')
  const ok = await checkConnection()
  if (!ok) {
    throw new Error('Database connection check failed on startup')
  }
  console.log(`[db] connected (schema: ${config.databaseSchema})`)

  const server = app.listen(config.port, config.host, () => {
    console.log(`[server] Belanja API listening on ${config.host}:${config.port} (${config.env})`)
  })

  const shutdown = async (signal) => {
    console.log(`[server] ${signal} received, shutting down gracefully...`)
    server.close(async () => {
      await closePool()
      process.exit(0)
    })
    // Force-exit if connections refuse to drain.
    setTimeout(() => process.exit(1), 10_000).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  return server
}

module.exports = { app, start }

// Direct execution: node server.js
if (require.main === module) {
  start().catch((err) => {
    console.error('[server] fatal startup error:', err.message)
    process.exit(1)
  })
}