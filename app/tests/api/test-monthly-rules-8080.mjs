import { psql, psqlT } from './db.mjs'

// End-to-end regression tests for the NEW monthly business rules (A-O).
// Uses psql (native local PostgreSQL, see ./db.mjs) ONLY to position months in
// the database as if time had moved on (opened/closed months from previous
// calendar months), since the API intentionally forbids opening past months
// directly.
const BASE = (process.env.API_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '') + '/api'
const suffix = Date.now() % 100000
const Alice = `rulesa${suffix}@t.local`
const Bob = `rulesb${suffix}@t.local`
const pad = (n) => String(n).padStart(2, '0')
let failed = 0

async function req(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}

function check(code, name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  [${code}] ${name}${detail ? '  | ' + detail : ''}`)
  if (!cond) failed++
}

const seed = (email, y, m, status) =>
  psql(`INSERT INTO belanja.monthly_entries (user_id,year,month,status,closed_at)
        SELECT id, ${y}, ${m}, '${status}', ${status === 'CLOSED' ? 'now()' : 'NULL'}
        FROM belanja.users WHERE email='${email}'
        ON CONFLICT (user_id,year,month) DO NOTHING;`)
const back = (y, m, n, out = {}) => { const t = y * 12 + m - n - 1; out.year = Math.floor(t / 12); out.month = (t % 12) + 1; return out }

async function main() {
  let r = await req('POST', '/auth/register', { name: 'Alice Rules', email: Alice, password: 'password123' })
  const TA = r.json.token
  await req('POST', '/auth/register', { name: 'Bob Rules', email: Bob, password: 'password123' })
  const cur = (await req('GET', '/monthly/current', undefined, TA)).json
  const cy = cur.year
  const cm = cur.month
  const m1 = back(cy, cm, 1)
  const m2 = back(cy, cm, 2)
  const m3 = back(cy, cm, 3)
  const m4 = back(cy, cm, 4)
  const mf = back(cy, cm, -1)
  const ymd = (mm, d) => `${mm.year}-${pad(mm.month)}-${pad(d)}`
  const entryId = (tok, mm) => req('GET', `/monthly/${mm.year}/${mm.month}`, undefined, tok).then((x) => x.json.entry && x.json.entry.id)

  // Master: 1 active fixed expense (1000) - FIRST access below must show it as
  // a live preview for the not-yet-open current month.
  await req('POST', '/fixed-expenses', { name: 'Rent', type: 'property', amount: 1000, active: true }, TA)

  // A) A month that was never opened: current month read-only preview, NOT OPEN.
  r = await req('GET', `/monthly/${cy}/${cm}`, undefined, TA)
  check('A', 'current never opened -> NOT OPEN, canOpen, no close/reopen',
    r.json.status === 'NOT OPEN' && r.json.entry === null &&
    r.json.access.canOpen === true && r.json.access.canClose === false && r.json.access.canReopen === false)
  check('A', 'NOT OPEN current shows live recap preview', r.json.totals.fixed === 1000 && r.json.totals.total === 1000)

  // B) Explicit opening is required to write; it is scoped to the current month.
  r = await req('POST', `/monthly/${cy}/${cm}/open`, undefined, TA)
  check('B', 'open current -> OPEN entry', r.status === 200 && r.json.entry.status === 'OPEN' && r.json.access.canClose === true)
  r = await req('POST', '/variable-expenses', { name: 'Laksa', type: 'food', amount: 20, expenseDate: ymd({ year: cy, month: cm }, 5) }, TA)
  check('B', 'variable write allowed while OPEN', r.status === 201)
  r = await req('GET', `/monthly/${cy}/${cm}`, undefined, TA)
  check('B', 'totals fixed 1000 + variable 20', r.json.totals.fixed === 1000 && r.json.totals.variable === 20 && r.json.totals.total === 1020)

  // C) Future months are always read-only; open/close/reopen and variable writes blocked.
  r = await req('GET', `/monthly/${mf.year}/${mf.month}`, undefined, TA)
  check('C', 'future GET -> FUTURE, nothing openable', r.json.status === 'FUTURE' && r.json.access.canOpen === false && r.json.access.canClose === false && r.json.access.canReopen === false)
  r = await req('POST', `/monthly/${mf.year}/${mf.month}/open`, undefined, TA)
  check('C', 'open future -> 400', r.status === 400)
  r = await req('POST', `/monthly/${mf.year}/${mf.month}/close`, undefined, TA)
  check('C', 'close future -> 400', r.status === 400)
  r = await req('POST', `/monthly/${mf.year}/${mf.month}/reopen`, undefined, TA)
  check('C', 'reopen future -> 400', r.status === 400)
  r = await req('POST', '/variable-expenses', { name: 'X', type: 'food', amount: 1, expenseDate: ymd(mf, 1) }, TA)
  check('C', 'variable write in future month -> 400', r.status === 400)

  // D) Closing a month that has no entry / is not open -> 409.
  r = await req('POST', `/monthly/${m1.year}/${m1.month}/close`, undefined, TA)
  check('D', 'close month with no entry -> 409', r.status === 409)
  r = await req('POST', '/variable-expenses', { name: 'Y', type: 'food', amount: 1, expenseDate: ymd(m1, 3) }, TA)
  check('D', 'variable write in non-open in-window past month -> 409', r.status === 409)

  // E) Closing locks the month; it cannot be opened again, only reopened.
  r = await req('POST', `/monthly/${cy}/${cm}/close`, undefined, TA)
  check('E', 'close current -> CLOSED', r.status === 200 && r.json.entry.status === 'CLOSED')
  r = await req('GET', `/monthly/${cy}/${cm}`, undefined, TA)
  check('E', 'CLOSED current: canReopen only', r.json.access.canOpen === false && r.json.access.canClose === false && r.json.access.canReopen === true)
  r = await req('POST', `/monthly/${cy}/${cm}/open`, undefined, TA)
  check('E', 'open already-closed month -> 409', r.status === 409)
  r = await req('POST', '/variable-expenses', { name: 'Z', type: 'food', amount: 1, expenseDate: ymd({ year: cy, month: cm }, 8) }, TA)
  check('E', 'variable write in CLOSED month -> 409', r.status === 409)

  // F/G/H) Reopen window (previous 3 calendar months). Seed CLOSED entries as if
  // the user had closed them when current; then each must be reopenable.
  seed(Alice, m1.year, m1.month, 'CLOSED')
  seed(Alice, m2.year, m2.month, 'CLOSED')
  seed(Alice, m3.year, m3.month, 'CLOSED')
  r = await req('POST', `/monthly/${m1.year}/${m1.month}/reopen`, undefined, TA)
  check('F', 'reopen current-1 -> OPEN + reopenedAt', r.status === 200 && r.json.entry.status === 'OPEN' && !!r.json.entry.reopenedAt)
  r = await req('POST', `/monthly/${m2.year}/${m2.month}/reopen`, undefined, TA)
  check('G', 'reopen current-2 -> OPEN', r.status === 200 && r.json.entry.status === 'OPEN' && !!r.json.entry.reopenedAt)
  r = await req('POST', `/monthly/${m3.year}/${m3.month}/reopen`, undefined, TA)
  check('H', 'reopen current-3 -> OPEN', r.status === 200 && r.json.entry.status === 'OPEN' && !!r.json.entry.reopenedAt)
  r = await req('POST', '/variable-expenses', { name: 'Correction', type: 'food', amount: 20, expenseDate: ymd(m1, 15) }, TA)
  check('F', 'variable write allowed in reopened current-1', r.status === 201)

  // I) current-4 (the fifth month back) is outside the editable window -> locked.
  r = await req('POST', `/monthly/${m4.year}/${m4.month}/reopen`, undefined, TA)
  check('I', 'reopen current-4 -> 409 (outside window)', r.status === 409)
  r = await req('POST', `/monthly/${m4.year}/${m4.month}/open`, undefined, TA)
  check('I', 'open current-4 -> 409 (only current month openable)', r.status === 409)
  r = await req('POST', '/variable-expenses', { name: 'Old', type: 'food', amount: 1, expenseDate: ymd(m4, 3) }, TA)
  check('I', 'variable write in current-4 -> 409 (read-only outside window)', r.status === 409)

  // J) Lazy auto-close: an OPEN month beyond the window (or not explicitly
  //    reopened) is normalized to CLOSED on any API access.
  seed(Alice, m4.year, m4.month, 'OPEN')
  r = await req('GET', `/monthly/${m4.year}/${m4.month}`, undefined, TA)
  check('J', 'stale OPEN current-4 auto-closed on GET', r.json.entry && r.json.entry.status === 'CLOSED' && !!r.json.entry.closedAt, JSON.stringify(r.json.entry && r.json.entry.status))

  // K) Explicitly reopened months in the window stay OPEN (auto-close spares them).
  r = await req('GET', `/monthly/${m1.year}/${m1.month}`, undefined, TA)
  check('K', 'reopened current-1 stays OPEN after further access', r.json.entry.status === 'OPEN')
  r = await req('GET', `/monthly/${m2.year}/${m2.month}`, undefined, TA)
  check('K', 'reopened current-2 stays OPEN after further access', r.json.entry.status === 'OPEN')
  r = await req('GET', `/monthly/${m3.year}/${m3.month}`, undefined, TA)
  check('K', 'reopened current-3 stays OPEN after further access', r.json.entry.status === 'OPEN')

  // L) Reopen a closed current month, correct data, close again -> snapshot rebuilt.
  r = await req('POST', `/monthly/${cy}/${cm}/reopen`, undefined, TA)
  check('L', 'reopen closed current month', r.status === 200 && r.json.entry.status === 'OPEN')
  r = await req('POST', '/variable-expenses', { name: 'Extra', type: 'food', amount: 30, expenseDate: ymd({ year: cy, month: cm }, 10) }, TA)
  check('L', 'variable write after reopen', r.status === 201)
  r = await req('POST', `/monthly/${cy}/${cm}/close`, undefined, TA)
  check('L', 'close again after reopen', r.status === 200 && !r.json.alreadyClosed && r.json.entry.status === 'CLOSED')
  r = await req('GET', `/monthly/${cy}/${cm}`, undefined, TA)
  check('L', 're-closed totals hold (fixed 1000 + vars 20+30)', r.json.totals.fixed === 1000 && r.json.totals.variable === 50 && r.json.totals.total === 1050)

  // M) Snapshots are not duplicated by the reopen -> close cycle.
  const curEntry = await entryId(TA, { year: cy, month: cm })
  const fixedRows = Number(psqlT(`SELECT count(*) FROM belanja.monthly_fixed_expenses WHERE monthly_entry_id='${curEntry}'`))
  check('M', 'current month has exactly 1 fixed snapshot row (no duplicates)', fixedRows === 1, `count=${fixedRows}`)

  // N) Rules are per-user: Bob is fully isolated.
  const bobCur = await req('GET', `/monthly/${cy}/${cm}`, undefined, await req('POST', '/auth/login', { email: Bob, password: 'password123' }).then((x) => x.json.token))
  check('N', 'bob sees nothing for current month', bobCur.json.entry === null && bobCur.json.status === 'NOT OPEN' && bobCur.json.totals.total === 0)
  const bobLogin = await req('POST', '/auth/login', { email: Bob, password: 'password123' })
  r = await req('POST', `/monthly/${m4.year}/${m4.month}/reopen`, undefined, bobLogin.json.token)
  check('N', 'bob cannot reopen alice legacy month', r.status === 409)

  // O) Dashboard reflects the final states.
  r = await req('GET', '/dashboard', undefined, TA)
  check('O', 'dashboard: current month CLOSED', r.json.currentMonth.year === cy && r.json.currentMonth.month === cm && r.json.currentMonth.status === 'CLOSED', JSON.stringify(r.json.currentMonth))
  const curSer = r.json.series.find((s) => s.year === cy && s.month === cm)
  check('O', 'dashboard: series current total 1050', Number(curSer.total) === 1050, `got ${curSer && curSer.total}`)
  const across = r.json.series.find((s) => s.year === m1.year && s.month === m1.month)
  check('O', 'dashboard: series current-1 = variable-only 20 (history excludes live recurring)', Number(across.total) === 20, `got ${across && across.total}`)

  console.log(`\n${failed === 0 ? 'ALL RULES TESTS PASSED' : `${failed} TEST(S) FAILED`}`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })