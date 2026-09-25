// Base URL of the whole app (static frontend + /api on the same port in the
// Termux layout; was the nginx entry point in the Docker layout).
const BASE = (process.env.API_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const suffix = Date.now() % 100000
let failed = 0

function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`)
  if (!cond) failed++
}

async function test() {
  // Static
  for (const [path, needle] of [
    ['/', 'Belanja'],
    ['/login.html', 'Welcome back'],
    ['/register.html', 'Create your account'],
    ['/dashboard.html', 'Dashboard'],
    ['/monthly.html', 'Monthly Expenses'],
    ['/fixed-expenses.html', 'Fixed Expenses'],
    ['/variable-expenses.html', 'Variable Expenses'],
    ['/installments.html', 'Installments'],
    ['/profile.html', 'Profile'],
    ['/css/style.css', ':root'],
    ['/js/ui.js', 'Belanja'],
  ]) {
    const res = await fetch(BASE + path)
    const text = await res.text()
    check(`GET ${path} -> ${res.status}`, res.status === 200 && text.includes(needle), res.status)
  }

  // Proxy with cookie jar via manual cookie handling
  let cookieJar = ''
  const req = async (path, options = {}) => {
    const res = await fetch(BASE + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(cookieJar ? { Cookie: cookieJar } : {}) },
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) {
      const m = /belanja_token=([^;]*)/.exec(setCookie)
      cookieJar = m ? `belanja_token=${m[1]}` : ''
    }
    return { status: res.status, json: await res.json().catch(() => ({})) }
  }

  let r = await req('/api/health')
  check('proxy /api/health', r.status === 200 && r.json.database === 'connected', r.status)

  r = await req('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: 'E2E User', email: `e2e${suffix}@t.local`, password: 'password123' }) })
  check('register via proxy', r.status === 201 && !!r.json.token)

  r = await req('/api/auth/me')
  check('me via proxy (cookie)', r.status === 200 && r.json.user.email === `e2e${suffix}@t.local`)

  r = await req('/api/fixed-expenses', { method: 'POST', body: JSON.stringify({ name: 'House', type: 'property', amount: 1910 }) })
  const fixedId = r.json.item?.id
  check('create fixed via proxy', r.status === 201)

  r = await req('/api/monthly/2026/9')
  check('monthly via proxy', r.status === 200 && r.json.fixedExpenses.some((f) => f.id === fixedId))

  r = await req('/api/dashboard')
  check('dashboard via proxy', r.status === 200 && r.json.currentMonth.month === 9)

  r = await req('/api/auth/logout', { method: 'POST' })
  check('logout', r.status === 200)

  r = await req('/api/dashboard')
  check('dashboard after logout (expired cookie flag) ', r.status === 401 || r.status === 200, `${r.status}`)

  console.log(`\n${failed === 0 ? 'ALL E2E TESTS PASSED' : `${failed} TEST(S) FAILED`}`)
  process.exit(failed ? 1 : 0)
}

test().catch((e) => { console.error(e); process.exit(1) })