const BASE = (process.env.API_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '') + '/api'
import { psql, psqlT } from './db.mjs'
const suffix = Date.now() % 100000
let A = null
let B = null
let failed = 0

async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`)
  if (!cond) failed++
}

const money = (n) => Number(n)
const pad = (n) => String(n).padStart(2, '0')

// Direct DB seeding is used ONLY to set up months in positions the API no
// longer allows creating (e.g. an OPEN past month) - the "calendar moved on"
// scenarios. psql runs against the native local PostgreSQL (see ./db.mjs).

async function main() {
  let r = await req('POST', '/auth/register', { name: 'Maya', email: `maya${suffix}@t.local`, password: 'password123' })
  A = r.json.token
  r = await req('POST', '/auth/register', { name: 'Robert', email: `mobob${suffix}@t.local`, password: 'password123' })
  B = r.json.token

  const cur = (await req('GET', '/monthly/current', undefined, A)).json
  const cy = cur.year
  const cm = cur.month
  const curKey = `${cy}-${pad(cm)}`

  // Seed masters: 2 active fixed + 1 inactive fixed, 2 active installments
  await req('POST', '/fixed-expenses', { name: 'House', type: 'property', amount: 1600, active: true }, A)
  await req('POST', '/fixed-expenses', { name: 'Car', type: 'vehicle', amount: 1459, active: true }, A)
  await req('POST', '/fixed-expenses', { name: 'Ala Carte', type: 'others', amount: 500, active: false }, A)
  await req('POST', '/installments', { loanName: 'iPad', type: 'credit_card', amount: 4500, totalMonths: 18, paidMonths: 9, monthlyInstallment: 250, startDate: '2026-01-01' }, A)
  await req('POST', '/installments', { loanName: 'Maybank BT', type: 'bank', amount: 1500, totalMonths: 9, paidMonths: 4, monthlyInstallment: 200, startDate: '2026-01-01' }, A)

  // 1) GET must NOT create an entry; opening is explicit.
  r = await req('GET', `/monthly/${cy}/${cm}`, undefined, A)
  check('1A) GET month does NOT create entry', r.json.entry === null && r.json.status === 'NOT OPEN', JSON.stringify(r.json.entry))
  r = await req('POST', `/monthly/${cy}/${cm}/open`, undefined, A)
  check('1B) open current month -> OPEN', r.status === 200 && !r.json.alreadyOpen && r.json.entry.status === 'OPEN')
  r = await req('GET', `/monthly/${cy}/${cm}`, undefined, A)
  const month = r.json
  check('1C) month now OPEN', month.entry.status === 'OPEN')
  check('live fixed shows only active masters (House+Car)', month.fixedExpenses.length === 2)
  check('live installments = 2', month.installments.length === 2)
  const fixedLive = money(month.totals.fixed)
  const instLive = money(month.totals.installments)
  check('1D) fixed total 3059', fixedLive === 3059, `got ${fixedLive}`)
  check('1E) installments total 450', instLive === 450, `got ${instLive}`)

  // 2) Explicit re-open is a safe no-op
  r = await req('POST', `/monthly/${cy}/${cm}/open`, undefined, A)
  check('re-open current idempotent', r.status === 200 && r.json.alreadyOpen === true)

  // 3) Add variable expenses
  await req('POST', '/variable-expenses', { name: 'Mee', type: 'food', amount: 13, expenseDate: `${cy}-${pad(cm)}-02` }, A)
  await req('POST', '/variable-expenses', { name: 'Petrol', type: 'fuel', amount: 50, expenseDate: `${cy}-${pad(cm)}-04` }, A)
  r = await req('GET', `/monthly/${cy}/${cm}`, undefined, A)
  check('3A) variable total 63', money(r.json.totals.variable) === 63, `got ${money(r.json.totals.variable)}`)
  check('3B) grand total 3572', money(r.json.totals.total) === 3572, `got ${money(r.json.totals.total)}`)

  // 4) Close current month
  r = await req('POST', `/monthly/${cy}/${cm}/close`, undefined, A)
  check('4A) close month -> CLOSED', r.status === 200 && r.json.status === 'CLOSED' && r.json.alreadyClosed === false)
  check('4B) snapshot rows present', r.json.fixedExpenses.length === 2 && r.json.installments.length === 2)
  r = await req('POST', `/monthly/${cy}/${cm}/close`, undefined, A)
  check('4C) re-close idempotent', r.status === 200 && r.json.alreadyClosed === true)

  // 5) Edit fixed AFTER close; snapshots must stay intact
  const fixedAll = (await req('GET', '/fixed-expenses', undefined, A)).json.items
  const house = fixedAll.find((f) => f.name === 'House')
  const car = fixedAll.find((f) => f.name === 'Car')
  await req('PUT', `/fixed-expenses/${house.id}`, { name: 'House', type: 'property', amount: 9999, remarks: 'changed later' }, A)
  await req('PUT', `/fixed-expenses/${car.id}`, { name: 'Car', type: 'vehicle', amount: 1, active: true }, A)
  await req('POST', '/fixed-expenses', { name: 'Added Later', type: 'bill', amount: 777, active: true }, A)
  r = await req('GET', `/monthly/${cy}/${cm}`, undefined, A)
  check('5A) CLOSED month keeps House=1600', r.json.fixedExpenses.find((x) => x.name === 'House').amount === 1600)
  check('5B) CLOSED month keeps Car=1459', r.json.fixedExpenses.find((x) => x.name === 'Car').amount === 1459)
  check('5C) CLOSED month excludes later-added master', !r.json.fixedExpenses.some((x) => x.name === 'Added Later'))
  check('5D) closed totals unchanged 3572', money(r.json.totals.total) === 3572, `got ${money(r.json.totals.total)}`)

  // 6) Closed month = read-only for variables
  r = await req('POST', '/variable-expenses', { name: 'Late', type: 'food', amount: 1, expenseDate: `${cy}-${pad(cm)}-28` }, A)
  check('6A) add variable to CLOSED month -> 409', r.status === 409)
  const mayaVars = (await req('GET', `/monthly/${cy}/${cm}`, undefined, A)).json.variableExpenses
  r = await req('PUT', `/variable-expenses/${mayaVars[0].id}`, { name: 'Mee', type: 'food', amount: 99, expenseDate: `${cy}-${pad(cm)}-02` }, A)
  check('6B) edit variable in CLOSED month -> 409', r.status === 409)
  r = await req('DELETE', `/variable-expenses/${mayaVars[0].id}`, undefined, A)
  check('6C) delete variable in CLOSED month -> 409', r.status === 409)

  // Compute the previous calendar month for the reopen/stale tests below.
  let py = cy
  let pm = cm - 1
  if (pm < 1) { pm = 12; py-- }

  // 10) Dashboard (before the prev-month experiments so its series stays clean)
  r = await req('GET', '/dashboard', undefined, A)
  const dash = r.json
  check('10A) dashboard current month matches server', dash.currentMonth.year === cy && dash.currentMonth.month === cm)
  check('10B) dashboard status = CLOSED for closed current month', dash.currentMonth.status === 'CLOSED')
  check('10C) dashboard installment info present', dash.installments.length === 2 && dash.installments[0].remainingMonths >= 0)
  check('10D) dashboard unpaidTotal > 0', dash.unpaidTotal > 0, `got ${dash.unpaidTotal}`)
  const curSer = dash.series.find((s) => s.year === cy && s.month === cm)
  check(`10E) series ${curKey} total = 3572 (closed snapshot)`, curSer && money(curSer.total) === 3572, `got ${curSer && money(curSer.total)}`)
  check('10F) series includes 12 months', dash.series.length === 12)
  const prevSer = dash.series.find((s) => s.year === py && s.month === pm)
  check(`10G) series previous month = 0 (no inherited totals)`, prevSer && money(prevSer.total) === 0, `got ${prevSer && money(prevSer.total)}`)

  // 7) A previous month can only be REOPENED (never freshly opened) through the
  //    API. GET shows history read-only. And an OPEN in-window month that was
  //    never explicitly reopened gets automatically closed by the lazy
  //    maintenance rule once the calendar has moved on (rule 8), even when
  //    directly seeded in the DB.
  r = await req('GET', `/monthly/${py}/${pm}`, undefined, A)
  check('7A) GET previous month: no entry, read-only history', r.json.entry === null && r.json.status === 'HISTORY' && r.json.fixedExpenses.length === 0)
  r = await req('POST', `/monthly/${py}/${pm}/open`, undefined, A)
  check('7B) cannot OPEN a previous month', r.status === 409)
  r = await req('POST', `/monthly/${py}/${pm}/reopen`, undefined, A)
  check('7C) cannot REOPEN a month with no entry', r.status === 409)

  // Seed: previous month OPEN, no records, no reopened_at (= opened while it
  // was current and left OPEN when the calendar moved on).
  psql(`INSERT INTO belanja.monthly_entries (user_id,year,month,status)
        SELECT id, ${py}, ${pm}, 'OPEN' FROM belanja.users WHERE email='maya${suffix}@t.local'
        ON CONFLICT (user_id,year,month) DO NOTHING;`)
  r = await req('GET', `/monthly/${py}/${pm}`, undefined, A)
  check('7D) lazy auto-close closes stale OPEN month', r.json.entry && r.json.entry.status === 'CLOSED' && !!r.json.entry.closedAt, JSON.stringify(r.json.entry && r.json.entry.status))

  r = await req('POST', `/monthly/${py}/${pm}/reopen`, undefined, A)
  check('7E) reopen (explicit) -> OPEN + reopenedAt set', r.status === 200 && r.json.entry.status === 'OPEN' && !!r.json.entry.reopenedAt)
  r = await req('GET', `/monthly/${py}/${pm}`, undefined, A)
  check('7F) explicitly reopened month stays OPEN (not re-auto-closed), live masters 10777', r.json.entry.status === 'OPEN' && money(r.json.totals.fixed) === 10777, `got ${r.json.entry.status} / ${money(r.json.totals.fixed)}`)

  // 8) No duplicate entry (same id across calls)
  const dup = await req('GET', `/monthly/${py}/${pm}`, undefined, A)
  check('8) no duplicate entry (same id across calls)', dup.json.entry.id === r.json.entry.id)

  // 9) Close the prev month (fresh snapshot from live masters) then reopen twice
  r = await req('POST', `/monthly/${py}/${pm}/close`, undefined, A)
  check('9A) close previous month -> CLOSED', r.status === 200 && !r.json.alreadyClosed && r.json.entry.status === 'CLOSED')
  r = await req('POST', `/monthly/${py}/${pm}/reopen`, undefined, A)
  check('9B) reopen previous month -> OPEN', r.status === 200 && r.json.entry.status === 'OPEN' && !!r.json.entry.reopenedAt)
  r = await req('POST', `/monthly/${py}/${pm}/close`, undefined, A)
  check('9C) close again after reopen works', r.status === 200 && !r.json.alreadyClosed && r.json.entry.status === 'CLOSED')
  r = await req('GET', `/monthly/${py}/${pm}`, undefined, A)
  check('9D) closed again, snapshot frozen 11227', money(r.json.totals.total) === 11227, `got ${money(r.json.totals.total)}`)

  // 11) User isolation for months
  const bb = await req('GET', `/monthly/${cy}/${cm}`, undefined, B)
  check('11) bob month independent (no entry, zero totals)', bb.json.entry === null && money(bb.json.totals.total) === 0)

  console.log(`\n${failed === 0 ? 'ALL TESTS PASSED' : `${failed} TEST(S) FAILED`}`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })