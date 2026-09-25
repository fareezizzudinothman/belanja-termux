// db.js - local psql access for the API tests.
//
// Belanja's tests seed "historical" months directly in the database. In the
// original Docker setup that meant `docker exec belanja-db-1 psql ...`; on
// Termux (no Docker) the native `psql` binary is used against the local cluster.
//
// Connection details come from DATABASE_URL (the environment, or app/.env -
// exactly what backend/config.js reads), so the tests use the same database
// the running backend is using.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function findAppEnv() {
  // app/tests/api/db.mjs -> app/.env
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.join(here, '..', '..', '.env')
}

export function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = findAppEnv()
  if (fs.existsSync(envFile)) {
    const line = fs
      .readFileSync(envFile, 'utf8')
      .split('\n')
      .find((l) => l.startsWith('DATABASE_URL='))
    if (line) return line.slice('DATABASE_URL='.length).trim()
  }
  throw new Error('DATABASE_URL not set and no .env found. Run the app setup first.')
}

// postgres://user:pass@host:port/db  -> connection parts.
export function parseDbUrl(url) {
  const m = /^postgres(?:ql)?:\/\/([^:@/]+):([^@/]+)@([^:/]+)(?::(\d+))?\/([^?]+)/.exec(url)
  if (!m) throw new Error('Cannot parse DATABASE_URL: ' + url)
  return {
    user: decodeURIComponent(m[1]),
    password: decodeURIComponent(m[2]),
    host: m[3],
    port: m[4] ? Number(m[4]) : 5432,
    db: m[5],
  }
}

function run(sql, opts = {}) {
  const c = parseDbUrl(databaseUrl())
  const out = spawnSync('psql', ['-h', c.host, '-p', String(c.port), '-U', c.user, '-d', c.db, ...(opts.tuplesOnly ? ['-tA'] : []), '-c', sql], {
    encoding: 'utf8',
    env: { ...process.env, PGPASSWORD: c.password },
  })
  if (out.error) {
    throw new Error(`psql not found (${out.error.message}). Install postgresql (./scripts/setup-termux.sh) or set DATABASE_URL.`)
  }
  if (out.status !== 0) throw new Error('psql failed: ' + (out.stderr || ''))
  return out
}

// Execute SQL, return raw stdout.
export function psql(sql) {
  return run(sql).stdout
}

// Execute SQL with -tA (tuples only), return trimmed output.
export function psqlT(sql) {
  return run(sql, { tuplesOnly: true }).stdout.trim()
}