'use strict'

/**
 * Idempotent SQL migration runner.
 *
 * - Tracks applied migrations in belanja.schema_migrations (version + checksum).
 * - Runs each pending migration inside its own transaction.
 * - Uses an advisory lock so concurrent runs (e.g. several containers) are safe.
 * - Refuses to re-run a migration whose file content changed (checksum drift).
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { pool, query } = require('./pool')

const MIGRATIONS_DIR = path.join(__dirname, 'migrations')

function loadMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()
    .map((file) => ({
      version: file,
      path: path.join(MIGRATIONS_DIR, file),
      sql: fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'),
      checksum: crypto.createHash('sha256').update(fs.readFileSync(path.join(MIGRATIONS_DIR, file))).digest('hex'),
    }))
}

async function ensureTrackingTable(schema) {
  await query(`
    CREATE SCHEMA IF NOT EXISTS ${schema};
    CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (
      version     text        PRIMARY KEY,
      checksum    text        NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    );
  `)
}

async function getApplied() {
  const { rows } = await query('SELECT version, checksum FROM belanja.schema_migrations')
  return new Map(rows.map((r) => [r.version, r.checksum]))
}

async function applyOne(migration) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(migration.sql)
    await client.query(
      'INSERT INTO belanja.schema_migrations (version, checksum) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING',
      [migration.version, migration.checksum]
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function migrate() {
  // Guard against a totally unreachable database (fail loudly, never mask).
  const { query: ensure } = require('./pool')
  const schema = process.env.POSTGRES_SCHEMA || 'belanja'

  const poolClient = await pool.connect()
  try {
    // serializable behaves better for the advisory lock session anyway.
    await poolClient.query('SELECT pg_advisory_lock(hashtext($1))', ['belanja:migrate'])
  } finally {
    poolClient.release()
  }

  try {
    await ensureTrackingTable(schema)
    const applied = await getApplied()
    const files = loadMigrationFiles()

    let appliedCount = 0
    for (const migration of files) {
      const existing = applied.get(migration.version)
      if (existing === undefined) {
        console.log(`[migrate] applying ${migration.version}`)
        await applyOne(migration)
        appliedCount += 1
        continue
      }
      if (existing !== migration.checksum) {
        throw new Error(
          `Migration ${migration.version} was already applied with different content. ` +
            'Refusing to run. Never edit an applied migration; add a new one instead.'
        )
      }
    }

    console.log(`[migrate] done. ${files.length} total, ${appliedCount} applied, ${files.length - appliedCount} already up-to-date.`)
    return { total: files.length, applied: appliedCount }
  } finally {
    await pool.query('SELECT pg_advisory_unlock_all()').catch(() => {})
  }
}

async function status() {
  const applied = await getApplied()
  const files = loadMigrationFiles()
  const lines = files.map((f) => {
    const row = applied.get(f.version)
    return `  ${row ? 'APPLIED   ' : 'PENDING   '} ${f.version}`
  })
  console.log(`[migrate:status] ${files.length} migration files, ${applied.size} applied.`)
  console.log(lines.join('\n'))
  return lines
}

async function main() {
  const isStatus = process.argv.includes('--status')
  try {
    if (isStatus) {
      await status()
    } else {
      await migrate()
    }
  } catch (err) {
    console.error('[migrate] failed:', err.message)
    process.exitCode = 1
  } finally {
    await pool.end().catch(() => {})
  }
}

// Runs when executed directly OR when required as a library (no side effects on import).
if (require.main === module) {
  main()
}

module.exports = { migrate, status, loadMigrationFiles }