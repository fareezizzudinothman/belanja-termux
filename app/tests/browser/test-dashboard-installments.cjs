'use strict';

const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const CHROME = process.env.CHROME_PATH || '/ms-playwright/chromium-1124/chrome-linux/chrome';
const suffix = Date.now() % 1000000;
const email = `dashfix${suffix}@t.local`;
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

  // register
  await page.goto(BASE + '/register.html', { waitUntil: 'networkidle' });
  await page.fill('#name', 'Dash Fix User');
  await page.fill('#email', email);
  await page.fill('#password', 'password123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click('#register-form [type="submit"]'),
  ]);
  await page.waitForSelector('#t-total');

  // add a normal installment
  await page.goto(BASE + '/installments.html', { waitUntil: 'networkidle' });
  await page.click('#add-inst-btn');
  await page.waitForSelector('#inst-modal[open]');
  await page.fill('#inst-loan', 'iPad');
  await page.fill('#inst-mo', '250');
  await page.fill('#inst-total-amount', '4500');
  await page.fill('#inst-total-months', '18');
  await page.fill('#inst-paid-months', '9');
  await page.click('#inst-form [type="submit"]');
  await page.waitForSelector('#inst-cards .card');

  // add an installment whose loan name contains HTML/JS (XSS probe)
  const XSS_NAME = '<img src=x onerror=window.__xss=1>Bad</script>';
  await page.click('#add-inst-btn');
  await page.waitForSelector('#inst-modal[open]');
  await page.fill('#inst-loan', XSS_NAME);
  await page.fill('#inst-mo', '50');
  await page.fill('#inst-total-amount', '600');
  await page.fill('#inst-total-months', '12');
  await page.fill('#inst-paid-months', '2');
  await page.click('#inst-form [type="submit"]');
  await page.waitForFunction((n) => document.querySelectorAll('#inst-cards .card').length === n, 2);

  // dashboard
  await page.goto(BASE + '/dashboard.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#installments-list .card');

  const cards = await page.$$eval('#installments-list .card', (els) => els.length);
  check('dashboard renders Active Installments as real cards', cards === 2, `${cards} cards`);

  const raw = await page.$eval('#installments-list', (el) => el.innerHTML);
  const showsSource = raw.includes('&lt;div') || raw.includes('&lt;/div&gt;');
  check('card HTML is NOT displayed as literal source text', !showsSource, 'innerHTML contains real markup');

  const text = await page.$eval('#installments-list', (el) => el.textContent);
  const norm = (s) => s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const t = norm(text);
  check('loan name "iPad" shown', t.includes('iPad'), t.slice(0, 120));
  check('monthly amount displayed', norm(await page.$eval('#installments-list .card:nth-child(1)', (el) => el.textContent)).includes('RM 250.00 / month'.replace(' ', '')) ||
    t.includes('RM 250.00'), t);
  check('paid / total months shown', t.includes('Paid: 9 / 18'), t);
  check('remaining months shown', t.includes('Remaining: 9'), t);

  // XSS checks
  const xssFired = await page.evaluate(() => window.__xss);
  check('XSS probe did NOT execute script (window.__xss undefined)', xssFired === undefined, `__xss=${xssFired}`);
  const injectedImg = await page.$$eval('#installments-list .card img', (els) => els.length);
  check('no <img> element injected into card', injectedImg === 0, `${injectedImg}`);
  const xssCardText = norm(await page.$eval('#installments-list .card:nth-child(2)', (el) => el.textContent));
  check('hostile loan name shown as escaped literal text', xssCardText.includes('<img src=x onerror=window.__xss=1>Bad'), xssCardText.slice(0, 100));

  const hardErrors = errors.filter((e) => !e.includes('favicon') && !e.includes('401'));
  check('no console/runtime errors', hardErrors.length === 0, hardErrors.join(' ;; ') || 'none');

  console.log(`\n${failed === 0 ? 'ALL DASHBOARD INSTALLMENT CHECKS PASSED' : `${failed} CHECK(S) FAILED`}`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1) });