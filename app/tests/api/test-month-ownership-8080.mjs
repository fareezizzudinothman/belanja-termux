import { psql, psqlT } from './db.mjs'

// Regression test for the clarified business rule: every expense month must be
// owned by its INTENDED month. Whatever the user enters from the monthly page
// (or any day's variable expense) must land in the month of that expense_date -
// and the backend must reject any attempt to write into a month that is not
// open, that is already closed, that is in the future, or that sits outside the
// editable window. Nothing may leak from the current month into an adjacent one,
// and closing/reopening a month must always keep its snapshot UNDER that month.
//
// Concrete scenario (pinned): current = 2026-09 (September), previous = 2026-08
// (August). August must show 0 / "-", never September's totals; October (future)
// must show nothing; closing September creates a September snapshot; a
// reopen+re-close cycle keeps the snapshot under September with no duplicates.
//
// psql (native local PostgreSQL, see ./db.mjs) is used ONLY to position months
// in the database as if time had moved on (opening past months is intentionally
// forbidden by the API).
const BASE = (process.env.API_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '') + '/api'
const suffix = Date.now() % 100000
const email = `owner${suffix}@t.local`
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

const back = (y, m, n) => { const t = y * 12 + m - n - 1; return { year: Math.floor(t / 12), month: (t % 12) + 1 } }
const ymd = (mm, d) => `${mm.year}-${pad(mm.month)}-${pad(d)}`

async function main() {
  const reg = await req('POST', '/auth/register', { name: 'Month Owner', email, password: 'password123' })
  const token = reg.json.token
  const uid = psqlT(`SELECT id FROM belanja.users WHERE email='${email}'`)

  const cur = (await req('GET', '/monthly/current', undefined, token)).json
  const cy = cur.year
  const cm = cur.month
  const sep = { year: cy, month: cm }
  const aug = back(cy, cm, 1)
  const m4 = back(cy, cm, 4)
  const oct = back(cy, cm, -1)

  const seed = (mm, status) => psql(
    `INSERT INTO belanja.monthly_entries (user_id,year,month,status,closed_at)
     SELECT id, ${mm.year}, ${mm.month}, '${status}', ${status === 'CLOSED' ? 'now()' : 'NULL'}
     FROM belanja.users WHERE email='${email}'
     ON CONFLICT (user_id,year,month) DO UPDATE SET status = EXCLUDED.status, closed_at = EXCLUDED.closed_at, reopened_at = NULL;`
  )
  const entryId = (mm) => psqlT(`SELECT id FROM belanja.monthly_entries WHERE user_id='${uid}' AND year=${mm.year} AND month=${mm.month}`)

  // Masters: fixed 1000 + installment 2000 = 3000 recurring.
  await req('POST', '/fixed-expenses', { name: 'Rent', type: 'property', amount: 1000, active: true }, token)
  await req('POST', '/installments', { loanName: 'Car', type: 'vehicle', amount: 20000, monthlyInstallment: 2000, totalMonths: 12, paidMonths: 3, active: true }, token)

  // ---------------------------------------------------------------
  // O1) The app's "current month" is the known scenario month: 2026-09.
  // ---------------------------------------------------------------
  check('O1', 'current month is September 2026', cy === 2026 && cm === 9, `current=${cy}-${cm}`)

  // ---------------------------------------------------------------
  // O2) GET is read-only: NOT OPEN, no entry created, live preview only.
  // ---------------------------------------------------------------
  let r = await req('GET', `/monthly/${cy}/${cm}`, undefined, token)
  check('O2', 'September GET -> NOT OPEN, entry null, canOpen', r.json.status === 'NOT OPEN' && r.json.entry === null && r.json.access.canOpen === true)
  check('O2', 'NOT OPEN current shows live recap preview (3000)', r.json.totals.fixed === 1000 && r.json.totals.installments === 2000 && r.json.totals.total === 3000)

  // ---------------------------------------------------------------
  // O3) Writes into a month that was never opened are rejected - a variable
  //     expense can NEVER silently land in August just because its date says so.
  // ---------------------------------------------------------------
  r = await req('POST', '/variable-expenses', { name: 'August ghost', type: 'food', amount: 1, expenseDate: ymd(aug, 10) }, token)
  check('O3', 'variable write into never-opened August -> 409 (not open)', r.status === 409, `status=${r.status}`)
  r = await req('GET', `/monthly/${aug.year}/${aug.month}`, undefined, token)
  check('O3', 'August GET -> HISTORY, entry null, totals 0', r.json.status === 'HISTORY' && r.json.entry === null && r.json.totals.total === 0)

  // ---------------------------------------------------------------
  // O4) Open September; a new expense belongs to (2026,9) - verified in the
  //     API response AND in the database row - and never to August.
  // ---------------------------------------------------------------
  r = await req('POST', `/monthly/${cy}/${cm}/open`, undefined, token)
  check('O4', 'open September -> OPEN', r.status === 200 && r.json.entry.status === 'OPEN')
  r = await req('POST', '/variable-expenses', { name: 'September coffee', type: 'food', amount: 50, expenseDate: ymd(sep, 15) }, token)
  check('O4', 'create September expense -> 201, belongs to 2026-9', r.status === 201 && r.json.item.year === 2026 && r.json.item.month === 9, `got ${r.json.item && r.json.item.year}-${r.json.item && r.json.item.month}`)
  const dbres = r.json.item && r.json.item.id
  check('O4', 'DB row month = 2026-9', psqlT(`SELECT year||'-'||month FROM belanja.variable_expenses WHERE id='${dbres}'`) === '2026-9')
  r = await req('GET', '/variable-expenses', undefined, token)
  check('O4', 'expense NOT in a different month (list month 8 has 0 rows)', psqlT(`SELECT count(*) FROM belanja.variable_expenses WHERE user_id='${uid}' AND year=2026 AND month=8`) === '0')

  // ---------------------------------------------------------------
  // O5) Dashboard: August = 0 / "-"; September = live 3000 + variable 50.
  // ---------------------------------------------------------------
  const seriesOf = async () => {
    const dash = (await req('GET', '/dashboard', undefined, token)).json
    return {
      sep: dash.series.find((s) => s.year === cy && s.month === cm),
      aug: dash.series.find((s) => s.year === aug.year && s.month === aug.month),
    }
  }
  let s = await seriesOf()
  check('O5', 'August total = 0 (no real data, no inheritance)', Number(s.aug.total) === 0, `aug.total=${s.aug && s.aug.total}`)
  check('O5', 'August fixed=0 AND installments=0 (Sep totals NOT in Aug)', Number(s.aug.fixed) === 0 && Number(s.aug.installments) === 0, `f=${s.aug && s.aug.fixed} i=${s.aug && s.aug.installments}`)
  check('O5', 'September total = 3050 (fixed 1000 + inst 2000 + variable 50)', Number(s.sep.total) === 3050, `sep.total=${s.sep && s.sep.total}`)
  check('O5', 'September != August (no cross-month leak)', Number(s.sep.total) !== Number(s.aug.total))

  // ---------------------------------------------------------------
  // O6) Future months (October) are empty and cannot be written to.
  // ---------------------------------------------------------------
  r = await req('GET', `/monthly/${oct.year}/${oct.month}`, undefined, token)
  check('O6', 'October GET -> FUTURE, entry null, totals 0', r.json.status === 'FUTURE' && r.json.entry === null && r.json.totals.total === 0)
  r = await req('POST', `/monthly/${oct.year}/${oct.month}/open`, undefined, token)
  check('O6', 'open future October -> 400', r.status === 400)
  r = await req('POST', '/variable-expenses', { name: 'October ghost', type: 'food', amount: 1, expenseDate: ymd(oct, 1) }, token)
  check('O6', 'variable write into future October -> 400', r.status === 400)
  check('O6', 'October still has no DB entry (GET did not create it)', entryId(oct) === '')

  // ---------------------------------------------------------------
  // O7) Closing September creates a SNAPSHOT UNDER September, not August.
  // ---------------------------------------------------------------
  r = await req('POST', `/monthly/${cy}/${cm}/close`, undefined, token)
  check('O7', 'close September -> CLOSED + closedAt', r.status === 200 && r.json.entry.status === 'CLOSED' && !!r.json.entry.closedAt)
  const sepEntry = entryId(sep)
  check('O7', 'September snapshot rows exist under September entry', psqlT(`SELECT count(*) FROM belanja.monthly_fixed_expenses WHERE monthly_entry_id='${sepEntry}'`) === '1' && psqlT(`SELECT count(*) FROM belanja.monthly_installments WHERE monthly_entry_id='${sepEntry}'`) === '1')
  check('O7', 'August has NO snapshot rows', psqlT(`SELECT count(*) FROM belanja.monthly_fixed_expenses WHERE monthly_entry_id IN (SELECT id FROM belanja.monthly_entries WHERE user_id='${uid}' AND year=2026 AND month=8)`) === '0')
  r = await req('GET', `/monthly/${cy}/${cm}`, undefined, token)
  check('O7', 'closed September totals (frozen snapshot 1000+2000, variable 50)', r.json.totals.fixed === 1000 && r.json.totals.installments === 2000 && r.json.totals.variable === 50 && r.json.totals.total === 3050)
  r = await req('POST', '/variable-expenses', { name: 'September closed ghost', type: 'food', amount: 1, expenseDate: ymd(sep, 20) }, token)
  check('O7', 'variable write into CLOSED September -> 409 (read-only)', r.status === 409)

  // ---------------------------------------------------------------
  // O8) Reopen September, add a correction, close again: the snapshot stays
  //     under September, rebuilt exactly once (no duplicates, none under Aug).
  // ---------------------------------------------------------------
  r = await req('POST', `/monthly/${cy}/${cm}/reopen`, undefined, token)
  check('O8', 'reopen September -> OPEN + reopenedAt', r.status === 200 && r.json.entry.status === 'OPEN' && !!r.json.entry.reopenedAt)
  r = await req('POST', '/variable-expenses', { name: 'September correction', type: 'food', amount: 20, expenseDate: ymd(sep, 22) }, token)
  check('O8', 'variable write after reopen -> 201', r.status === 201)
  r = await req('POST', `/monthly/${cy}/${cm}/close`, undefined, token)
  check('O8', 'close September again -> CLOSED', r.status === 200 && r.json.entry.status === 'CLOSED')
  check('O8', 'exactly 1 fixed + 1 installment snapshot row (no duplicates after cycle)', psqlT(`SELECT count(*) FROM belanja.monthly_fixed_expenses WHERE monthly_entry_id='${sepEntry}'`) === '1' && psqlT(`SELECT count(*) FROM belanja.monthly_installments WHERE monthly_entry_id='${sepEntry}'`) === '1')
  check('O8', 'snapshot still keyed to September entry, not August', psqlT(`SELECT count(*) FROM belanja.monthly_fixed_expenses WHERE monthly_entry_id IN (SELECT id FROM belanja.monthly_entries WHERE user_id='${uid}' AND year=2026 AND month=8)`) === '0')
  r = await req('GET', `/monthly/${cy}/${cm}`, undefined, token)
  check('O8', 're-closed September totals (frozen 3000 + variables 70)', r.json.totals.fixed === 1000 && r.json.totals.installments === 2000 && r.json.totals.variable === 70 && r.json.totals.total === 3070)

  // ---------------------------------------------------------------
  // O9) Lifecycle rules remain unchanged.
  // ---------------------------------------------------------------
  seed(aug, 'CLOSED')
  r = await req('POST', `/monthly/${aug.year}/${aug.month}/reopen`, undefined, token)
  check('O9', 'August (month 8) is reopenable within window -> OPEN', r.status === 200 && r.json.entry.status === 'OPEN')
  seed(m4, 'OPEN')
  r = await req('GET', `/monthly/${m4.year}/${m4.month}`, undefined, token)
  check('O9', 'stale OPEN beyond window auto-closes on GET -> CLOSED', r.json.entry && r.json.entry.status === 'CLOSED', `status=${r.json.entry && r.json.entry.status}`)
  r = await req('POST', `/monthly/${m4.year}/${m4.month}/reopen`, undefined, token)
  check('O9', 'current-4 cannot be reopened (outside editable window) -> 409', r.status === 409)

  console.log(`\n${failed === 0 ? 'ALL MONTH-OWNERSHIP TESTS PASSED' : `${failed} TEST(S) FAILED`}`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })