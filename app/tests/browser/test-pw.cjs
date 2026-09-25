'use strict';

const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const CHROME = process.env.CHROME_PATH || '/ms-playwright/chromium-1124/chrome-linux/chrome';
const suffix = Date.now() % 100000;
const email = `browser${suffix}@t.local`;
let failed = 0;

function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
  if (!cond) failed++;
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('requestfailed', (r) => console.log('REQFAIL:', r.url(), (r.failure() || {}).errorText));
  page.on('request', (r) => { if (r.url().includes('/api/installments')) console.log('REQ install:', r.postData()); });

  // 1. index -> login
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  check('index redirects to login', page.url().includes('/login.html'), page.url());

  // 2. register -> dashboard
  await page.goto(BASE + '/register.html', { waitUntil: 'networkidle' });
  await page.fill('#name', 'Browser User');
  await page.fill('#email', email);
  await page.fill('#password', 'password123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click('#register-form [type="submit"]'),
  ]);
  check('register -> dashboard redirect', page.url().includes('/dashboard.html'), page.url());

  // 3. dashboard stats
  await page.waitForSelector('#t-total');
  const totalText = await page.$eval('#t-total', (el) => el.textContent);
  check('dashboard total rendered as RM 0.00', /RM\s+0\.00/.test(totalText), totalText);
  const chartBars = await page.$$eval('#chart .bar-col', (els) => els.length);
  check('chart has 12 bars', chartBars === 12, `${chartBars}`);

  // 4. add fixed expense
  await page.goto(BASE + '/fixed-expenses.html', { waitUntil: 'networkidle' });
  await page.click('#add-fixed-btn');
  await page.waitForSelector('#fixed-modal[open]');
  await page.fill('#fixed-name', 'House Rent');
  await page.selectOption('#fixed-type', 'property');
  await page.fill('#fixed-amount', '1910');
  await page.click('#fixed-form [type="submit"]');
  await page.waitForSelector('#fixed-tbody tr');
  const rowText = await page.$eval('#fixed-tbody', (el) => el.textContent);
  check('fixed expense in table', rowText.includes('House Rent') && rowText.replace(/\u00a0/g, ' ').includes('RM 1,910.00'), rowText.trim());

  // 5. add installment
  await page.goto(BASE + '/installments.html', { waitUntil: 'networkidle' });
  await page.click('#add-inst-btn');
  await page.waitForSelector('#inst-modal[open]');
  await page.fill('#inst-loan', 'iPad');
  await page.fill('#inst-mo', '250');
  await page.fill('#inst-total-amount', '4500');
  await page.fill('#inst-total-months', '18');
  await page.fill('#inst-paid-months', '9');
  await page.click('#inst-form [type="submit"]');
  try {
    await page.waitForSelector('#inst-cards .card', { timeout: 8000 });
  } catch (e) {
    const diag = await page.evaluate(() => ({
      err: document.getElementById('inst-error')?.textContent,
      modalOpen: document.getElementById('inst-modal')?.open,
      cards: document.querySelectorAll('#inst-cards .card').length,
      toast: document.querySelector('.toast')?.textContent,
    }));
    console.log('DIAG install:', JSON.stringify(diag));
    throw e;
  }
  const instText = await page.$eval('#inst-cards', (el) => el.textContent);
  check('installment card renders progress info', instText.includes('Remaining:') && instText.includes('Paid:'), instText.replace(/\s+/g, ' ').slice(0, 180));

  // 6. monthly page - a fresh user's current month starts as NOT OPEN
  await page.goto(BASE + '/monthly.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#fixed-list .total-line');
  const fixedTxt = await page.$eval('#fixed-list', (el) => el.textContent);
  const instTxt = await page.$eval('#inst-list', (el) => el.textContent);
  check('monthly shows expected fixed (House Rent)', fixedTxt.includes('House Rent'));
  check('monthly shows expected installment (iPad)', instTxt.includes('iPad'));
  await page.waitForFunction(() => document.getElementById('open-month-btn').style.display !== 'none');
  check('not-open month shows Open Month button', await page.$eval('#open-month-btn', (el) => el.style.display !== 'none'));
  check('not-open month hides Add Expense button', await page.$eval('#add-var-btn', (el) => el.style.display === 'none'));
  await page.click('#open-month-btn');
  await page.waitForFunction(() => document.getElementById('add-var-btn').style.display !== 'none');
  await page.waitForFunction(() => document.getElementById('open-month-btn').style.display === 'none');
  check('after open, Open hidden + Add Expense shown', await page.$eval('#add-var-btn', (el) => el.style.display !== 'none'));
  await page.click('#add-var-btn');
  await page.waitForSelector('#var-modal[open]');
  await page.fill('#var-name', 'Nasi Lemak');
  await page.selectOption('#var-type', 'food');
  await page.fill('#var-amount', '8.5');
  await page.click('#var-form [type="submit"]');
  await page.waitForFunction(() => document.getElementById('var-list').textContent.includes('Nasi Lemak'));
  const sumTotal = await page.$eval('#sum-total', (el) => el.textContent);
  check('grand total = RM 2,168.50', sumTotal.replace(/\u00a0/g, ' ').trim() === 'RM 2,168.50', `${sumTotal}`);

  // 7. close month
  await page.click('#close-month-btn');
  await page.waitForFunction(() => document.getElementById('close-month-btn').style.display === 'none');
  const banner = await page.$eval('#month-banner', (el) => el.textContent);
  check('closed banner shown', banner.toLowerCase().includes('closed'), banner.trim().slice(0, 60));
  check('closed month shows Reopen button', await page.$eval('#reopen-month-btn', (el) => el.style.display !== 'none'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#sum-total');
  const sumTotal2 = await page.$eval('#sum-total', (el) => el.textContent);
  check('closed retains RM 2,168.50', sumTotal2.replace(/\u00a0/g, ' ').trim() === 'RM 2,168.50', `${sumTotal2}`);

  // 8. edit fixed AFTER closing -> month must stay unchanged
  await page.goto(BASE + '/fixed-expenses.html', { waitUntil: 'networkidle' });
  await page.click('#fixed-tbody [data-edit]');
  await page.waitForSelector('#fixed-modal[open]');
  await page.$eval('#fixed-amount', (el) => { el.value = ''; });
  await page.fill('#fixed-amount', '9876');
  await page.click('#fixed-form [type="submit"]');
  await page.waitForFunction(() => document.getElementById('fixed-tbody').textContent.includes('9,876'));
  await page.goto(BASE + '/monthly.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#sum-total');
  const sumTotal3 = await page.$eval('#sum-total', (el) => el.textContent);
  check('CLOSED month still RM 2,168.50 (snapshot preserved)', sumTotal3.replace(/\u00a0/g, ' ').trim() === 'RM 2,168.50', `${sumTotal3}`);

  // 9. read-only variable list after close
  const varActions = await page.$$eval('#var-list [data-edit], #var-list [data-del]', (els) => els.length);
  check('no edit/delete buttons on closed month', varActions === 0, `${varActions}`);

  // 10. profile
  await page.goto(BASE + '/profile.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  console.log('PROFILE url:', page.url(), '| email:', await page.$eval('#p-email', (el) => el.textContent), '| name:', await page.$eval('#p-name', (el) => el.value));
  await page.waitForSelector('#p-email');
  const profEmail = await page.$eval('#p-email', (el) => el.textContent);
  check('profile shows email', profEmail === email, profEmail);

  // 11. logout
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click('#logout-btn'),
  ]);
  check('logout -> login', page.url().includes('/login.html'), page.url());

  const hardErrors = errors.filter((e) => !e.includes('favicon') && !e.includes('401'));
  check('no console/runtime errors', hardErrors.length === 0, hardErrors.join(' ;; ') || 'none');

  console.log(`\n${failed === 0 ? 'ALL BROWSER TESTS PASSED' : `${failed} TEST(S) FAILED`}`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1) });