'use strict';

const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const CHROME = process.env.CHROME_PATH || '/ms-playwright/chromium-1124/chrome-linux/chrome';
const suffix = Date.now() % 1000000;
const email = `series${suffix}@t.local`;
let failed = 0;

function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
  if (!cond) failed++;
}

const norm = (s) => String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('dialog', (d) => d.accept());

  // register
  await page.goto(BASE + '/register.html', { waitUntil: 'networkidle' });
  await page.fill('#name', 'Series User');
  await page.fill('#email', email);
  await page.fill('#password', 'password123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click('#register-form [type="submit"]'),
  ]);
  await page.waitForSelector('#t-total');

  // fixed expense -> live recurring > 0 (House Rent 1000)
  await page.goto(BASE + '/fixed-expenses.html', { waitUntil: 'networkidle' });
  await page.click('#add-fixed-btn');
  await page.waitForSelector('#fixed-modal[open]');
  await page.fill('#fixed-name', 'House Rent');
  await page.selectOption('#fixed-type', 'property');
  await page.fill('#fixed-amount', '1000');
  await page.click('#fixed-form [type="submit"]');
  await page.waitForSelector('#fixed-tbody tr');

  // variable expense in the CURRENT month -> Nasi 8.50 (month must be opened first)
  await page.goto(BASE + '/monthly.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#fixed-list .total-line');
  await page.waitForFunction(() => document.getElementById('open-month-btn').style.display !== 'none');
  await page.click('#open-month-btn');
  await page.waitForFunction(() => document.getElementById('add-var-btn').style.display !== 'none');
  await page.click('#add-var-btn');
  await page.waitForSelector('#var-modal[open]');
  await page.fill('#var-name', 'Nasi');
  await page.selectOption('#var-type', 'food');
  await page.fill('#var-amount', '8.5');
  await page.click('#var-form [type="submit"]');
  await page.waitForFunction(() => document.getElementById('var-list').textContent.includes('Nasi'));

  // The previous month must stay EMPTY (no auto-open, no inherited totals).
  const current = await page.evaluate(() => fetch('/api/monthly/current').then((r) => r.json()));
  const cy = current.year;
  const cm = current.month;
  const py = cm === 1 ? cy - 1 : cy;
  const pm = cm === 1 ? 12 : cm - 1;
  const prev = await page.evaluate(({ y, m }) => fetch(`/api/monthly/${y}/${m}`).then((r) => r.json()), { y: py, m: pm });
  check('GET previous month does NOT create entry (read-only GET)', prev.entry === null && prev.status === 'HISTORY', JSON.stringify(prev.entry));

  // ---- Dashboard ----
  await page.goto(BASE + '/dashboard.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#chart .bar-col');

  // API-level verification
  const dash = await page.evaluate(() => fetch('/api/dashboard').then((r) => r.json()));
  const aug = dash.series.find((s) => s.year === py && s.month === pm);
  const sep = dash.series.find((s) => s.year === cy && s.month === cm);
  check(`API: prev month (${py}-${pm}) total = 0`, aug && norm(aug.total) === '0', `got ${aug && aug.total}`);
  check(`API: current month (${cy}-${cm}) total = 1008.5`, sep && norm(sep.total) === '1008.5', `got ${sep && sep.total}`);
  check('API: prev does NOT inherit current total', aug && sep && aug.total !== sep.total, `aug=${aug && aug.total} sep=${sep && sep.total}`);
  const labels = dash.series.map((s) => s.label);
  const monthLabel = new Date(Date.UTC(cy, cm - 1, 1)).toLocaleString('en-US', { month: 'short' });
  const firstHist = new Date(Date.UTC(cy, cm - 12, 1)).toLocaleString('en-US', { month: 'short' });
  check(`API: range is ${firstHist} ${cy} .. ${monthLabel} ${cy}`, labels[0] === firstHist && labels[11] === monthLabel, labels.join(','));

  // DOM-level verification of the rendered chart + range (real en-dash, spans correct years)
  const rangeText = norm(await page.$eval('#chart-range', (el) => el.textContent));
  const startY = dash.series[0].year;
  const endY = dash.series[dash.series.length - 1].year;
  check('chart-range renders real en-dash spanning the right years',
    rangeText.includes('–') && !rangeText.includes('&ndash;') && rangeText.includes(`${startY}`) && rangeText.includes(`${endY}`), `"${rangeText}"`);

  const bars = await page.$$eval('#chart .bar-col', (els) => els.map((el) => ({
    label: el.querySelector('.bar-label').textContent.trim(),
    count: String(el.querySelector('.bar-count').textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(),
  })));
  const prevIdx = dash.series.findIndex((s) => s.year === py && s.month === pm);
  const currIdx = dash.series.findIndex((s) => s.year === cy && s.month === cm);
  const prevBar = bars[prevIdx];
  const currBar = bars[currIdx];
  check('DOM: prev month bar shows zero (no amount)', prevBar && prevBar.count === '–', `got "${prevBar && prevBar.count}"`);
  check('DOM: current month bar shows RM 1,008.50', currBar && currBar.count.includes('RM 1,008.50'), `got "${currBar && currBar.count}"`);
  check('DOM: prev bar != current bar', prevBar && currBar && prevBar.count !== currBar.count, `prev="${prevBar && prevBar.count}" curr="${currBar && currBar.count}"`);

  // chart and stat card agree on the current month
  const statTotal = norm(await page.$eval('#t-total', (el) => el.textContent));
  check('stat card matches Sep bar', statTotal.includes('RM 1,008.50'), statTotal);

  const hardErrors = errors.filter((e) => !e.includes('favicon') && !e.includes('401'));
  check('no console/runtime errors', hardErrors.length === 0, hardErrors.join(' ;; ') || 'none');

  console.log(`\n${failed === 0 ? 'ALL REGRESSION CHECKS PASSED' : `${failed} CHECK(S) FAILED`}`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1) });