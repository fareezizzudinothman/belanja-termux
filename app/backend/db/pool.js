'use strict'

const { Pool } = require('pg')
const { config } = require('../config')

// search_path is pinned to the application schema so every SQL statement in
// the codebase can be written without schema prefixes. Parameterized queries
// (from pg) protect against SQL injection.
const pool = new Pool({
  connectionString: config.databaseUrl,
  options: `-c search_path=${config.databaseSchema}`,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

pool.on('error', (err) => {
  // Keep the process alive when an idle client has a transient issue.
  console.error('[db] idle client error:', err.message)
})

async function query(text, params) {
  return pool.query(text, params)
}

async function checkConnection() {
  const { rows } = await pool.query('SELECT 1 AS ok')
  return rows[0]?.ok === 1
}

async function closePool() {
  await pool.end()
}

module.exports = { pool, query, checkConnection, closePool }