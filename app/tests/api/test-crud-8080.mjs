const BASE = (process.env.API_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '') + '/api'
const suffix = Date.now() % 100000
const A_USER = `alice${suffix}@test.local`
const B_USER = `bob${suffix}@test.local`
let A = null // token
let B = null // token
let fixedId = null
let varId = null
let instId = null
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

async function main() {
  // ---- auth ----
  let r = await req('POST', '/auth/register', { name: 'Alice', email: A_USER, password: 'password123' })
  A = r.json.token
  check('register alice', r.status === 201 && r.json.user.email === A_USER)
  r = await req('POST', '/auth/register', { name: 'Bob', email: B_USER, password: 'password456' })
  B = r.json.token
  check('register bob', r.status === 201)
  r = await req('POST', '/auth/login', { email: A_USER, password: 'password123' })
  check('login alice', r.status === 200)
  r = await req('POST', '/auth/login', { email: A_USER, password: 'wrong' })
  check('login wrong password -> 401', r.status === 401)
  r = await req('GET', '/auth/me', undefined, A)
  check('me (bearer)', r.status === 200 && r.json.user.email === A_USER)
  r = await req('GET', '/dashboard')
  check('no token -> 401', r.status === 401)

  // Current calendar month (server timezone) - variable expenses need an OPEN month.
  const cur = (await req('GET', '/monthly/current', undefined, A)).json
  const cy = cur.year
  const cm = cur.month
  const pad = (n) => String(n).padStart(2, '0')
  r = await req('POST', `/monthly/${cy}/${cm}/open`, undefined, A)
  check('open current month for variables', r.status === 200 && r.json.entry && r.json.entry.status === 'OPEN')

  // ---- fixed expenses ----
  r = await req('POST', '/fixed-expenses', { name: 'House', type: 'property', amount: 1910.0, remarks: 'Rumah', active: true }, A)
  fixedId = r.json.item?.id
  check('create fixed', r.status === 201 && r.json.item.name === 'House')
  await req('POST', '/fixed-expenses', { name: 'Car Loan', type: 'vehicle', amount: 1459 }, A)
  await req('POST', '/fixed-expenses', { name: 'Internet', type: 'bill', amount: 90 }, A)
  r = await req('PUT', `/fixed-expenses/${fixedId}`, { name: 'House', type: 'property', amount: 1600, remarks: 'Updated' }, A)
  check('update fixed (active preserved)', r.status === 200 && Number(r.json.item.amount) === 1600 && r.json.item.active === true)
  r = await req('PATCH', `/fixed-expenses/${fixedId}/active`, { active: false }, A)
  check('disable fixed', r.status === 200 && r.json.item.active === false)
  r = await req('PATCH', `/fixed-expenses/${fixedId}/active`, { active: true }, A)
  check('re-enable fixed', r.status === 200 && r.json.item.active === true)
  r = await req('GET', '/fixed-expenses', undefined, A)
  check('list fixed', r.status === 200 && r.json.items.length === 3)
  r = await req('POST', '/fixed-expenses', { name: 'X', type: 'crypto', amount: 10 }, A)
  check('reject invalid type', r.status === 400)
  r = await req('POST', '/fixed-expenses', { name: '', type: 'bank', amount: 10 }, A)
  check('reject empty name', r.status === 400)

  // ---- variable expenses ----
  r = await req('POST', '/variable-expenses', { name: 'Mee', type: 'food', amount: 12.5, expenseDate: `${cy}-${pad(cm)}-01` }, A)
  varId = r.json.item?.id
  check('create variable (current month)', r.status === 201 && r.json.item.month === cm && r.json.item.year === cy)
  await req('POST', '/variable-expenses', { name: 'Petrol', type: 'fuel', amount: 50, expenseDate: `${cy}-${pad(cm)}-03` }, A)
  await req('POST', '/variable-expenses', { name: 'Toll', type: 'toll', amount: 15.4, expenseDate: `${cy}-${pad(cm)}-05` }, A)
  r = await req('PUT', `/variable-expenses/${varId}`, { name: 'Mee Goreng', type: 'food', amount: 13.0, expenseDate: `${cy}-${pad(cm)}-02` }, A)
  check('update variable', r.status === 200 && r.json.item.name === 'Mee Goreng' && r.json.item.month === cm)
  r = await req('GET', `/variable-expenses?year=${cy}&month=${cm}`, undefined, A)
  check('list variable by month', r.status === 200 && r.json.items.length === 3)
  r = await req('POST', '/variable-expenses', { name: 'Bad date', type: 'food', amount: 5, expenseDate: '2026-13-01' }, A)
  check('reject invalid date', r.status === 400)

  // ---- installments ----
  r = await req('POST', '/installments', { loanName: 'iPad', type: 'credit_card', amount: 4500, totalMonths: 18, paidMonths: 9, monthlyInstallment: 250, startDate: '2026-01-01' }, A)
  instId = r.json.item?.id
  check('create installment + computed remaining 9', r.status === 201 && r.json.item.remainingMonths === 9)
  await req('POST', '/installments', { loanName: 'Maybank Balance Transfer', type: 'bank', amount: 1500, totalMonths: 9, paidMonths: 4, monthlyInstallment: 200, startDate: '2026-01-01' }, A)
  r = await req('PUT', `/installments/${instId}`, { loanName: 'iPad Pro', type: 'credit_card', amount: 5200, totalMonths: 18, paidMonths: 10, monthlyInstallment: 280, startDate: '2026-01-01' }, A)
  check('update installment recomputes remaining 8', r.status === 200 && r.json.item.remainingMonths === 8 && r.json.item.active === true)
  r = await req('POST', '/installments', { loanName: 'X', type: 'bank', amount: 100, totalMonths: 13, paidMonths: 14, monthlyInstallment: 10 }, A)
  check('reject paid>total', r.status === 400)
  r = await req('GET', '/installments', undefined, A)
  check('list installments', r.status === 200 && r.json.items.length === 2)

  // ---- isolation ----
  r = await req('GET', '/fixed-expenses', undefined, B)
  check('bob sees empty fixed list', r.status === 200 && r.json.items.length === 0)
  r = await req('DELETE', `/fixed-expenses/${fixedId}`, undefined, B)
  check('bob cannot delete alice fixed (404)', r.status === 404)
  r = await req('PUT', `/installments/${instId}`, { loanName: 'Hack', type: 'bank', amount: 0, totalMonths: 1, paidMonths: 0, monthlyInstallment: 100 }, B)
  check('bob cannot edit alice installment (404)', r.status === 404)
  r = await req('GET', '/dashboard', undefined, B)
  check('bob dashboard isolated (0 total)', r.status === 200 && r.json.totals.total === 0)

  // ---- delete by owner ----
  r = await req('DELETE', `/fixed-expenses/${fixedId}`, undefined, A)
  check('alice can delete own fixed', r.status === 200)
  r = await req('DELETE', `/fixed-expenses/${fixedId}`, undefined, A)
  check('delete missing -> 404', r.status === 404)

  console.log(`\n${failed === 0 ? 'ALL TESTS PASSED' : `${failed} TEST(S) FAILED`}`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })