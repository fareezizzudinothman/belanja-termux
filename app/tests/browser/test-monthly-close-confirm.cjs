'use strict';

const { chromium } = require('playwright');

// Browser regression test (Test B): the Close/Open/Reopen confirmation dialogs
// on the monthly page must name the ACTUAL selected month (e.g. "Close September
// 2026?"), never an invalid fallback such as "December 1899" (which appeared
// because the message was computed once at script-load, before /monthly/current
// had resolved year/month — Date.UTC(0, -1, 1) renders December 1899).
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const CHROME = process.env.CHROME_PATH || '/ms-playwright/chromium-1124/chrome-linux/chrome';
const suffix = Date.now() % 1000000;
const email = `closeconfirm${suffix}@t.local`;
let failed = 0;

function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
  if (!cond) failed++;
}

// Same formatting as UI.monthLabel in frontend/js/ui.js.
function expectedLabel(year, month) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-MY', { month: 'long', year: 'numeric' });
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const errors = [];
  const dialogs = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  // Record the raw confirm message, then accept (same safety as the main suite).
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });

  const badge = () => page.$eval('#month-status', (el) => el.textContent.trim());

  // register
  await page.goto(BASE + '/register.html', { waitUntil: 'networkidle' });
  await page.fill('#name', 'Close Confirm');
  await page.fill('#email', email);
  await page.fill('#password', 'password123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click('#register-form [type="submit"]'),
  ]);
  await page.waitForSelector('#t-total');

  // a master so the current month preview is non-empty
  await page.goto(BASE + '/fixed-expenses.html', { waitUntil: 'networkidle' });
  await page.click('#add-fixed-btn');
  await page.waitForSelector('#fixed-modal[open]');
  await page.fill('#fixed-name', 'Rent');
  await page.selectOption('#fixed-type', 'property');
  await page.fill('#fixed-amount', '1500');
  await page.click('#fixed-form [type="submit"]');
  await page.waitForSelector('#fixed-tbody tr');

  // Expected month label from the server (server /monthly/current).
  const current = await page.evaluate(() => fetch('/api/monthly/current').then((r) => r.json()));
  const label = expectedLabel(current.year, current.month);

  // Navigate WITHOUT query params (this is the exact bug #2 reproduction).
  await page.goto(BASE + '/monthly.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.getElementById('month-status').textContent.includes('NOT OPEN'));
  check(`B badge = NOT OPEN (${current.year}-${current.month})`, (await badge()) === 'NOT OPEN', await badge());

  // 1) Open Month dialog names the current month
  await page.click('#open-month-btn');
  await page.waitForFunction(() => document.getElementById('month-status').textContent.trim() === 'OPEN');
  check('B "Open <Month Year>?"', dialogs.length > 0 && dialogs[dialogs.length - 1] === `Open ${label}?\n\nOpening makes the month editable so you can record expenses.`, JSON.stringify(dialogs[dialogs.length - 1]));

  // 2) Close Month dialog must name the current month, NEVER December 1899.
  await page.click('#close-month-btn');
  await page.waitForFunction(() => document.getElementById('month-status').textContent.includes('CLOSED'));
  const closeMsg = dialogs[dialogs.length - 1] || '';
  check(`B "Close ${label}?" shown when current month is ${current.month}/${current.year}`, closeMsg === `Close ${label}?\n\nOnce closed, this month becomes read-only and its fixed/installment values are frozen as a snapshot.`, JSON.stringify(closeMsg));
  check('B message never shows December 1899 / 1899', !/1899/.test(closeMsg), closeMsg);

  // 3) Reload (hard-reload equivalent) and close via Reopen path still correct.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.getElementById('month-status').textContent.includes('CLOSED'));
  await page.click('#reopen-month-btn');
  await page.waitForFunction(() => document.getElementById('month-status').textContent.trim() === 'OPEN');
  const reopenMsg = dialogs[dialogs.length - 1] || '';
  check(`B "Reopen ${label}?" after reload`, reopenMsg === `Reopen ${label}?\n\nYou can correct data again. The historical snapshot is kept and rebuilt the next time you close the month.`, JSON.stringify(reopenMsg));
  check('B reopen message never shows 1899', !/1899/.test(reopenMsg), reopenMsg);

  // Close again after reopen - message still the real month.
  await page.click('#close-month-btn');
  await page.waitForFunction(() => document.getElementById('month-status').textContent.includes('CLOSED'));
  const closeMsg2 = dialogs[dialogs.length - 1] || '';
  check(`B "Close ${label}?" after reopen`, closeMsg2 === `Close ${label}?\n\nOnce closed, this month becomes read-only and its fixed/installment values are frozen as a snapshot.`, JSON.stringify(closeMsg2));

  // 4) No unexpected console/runtime errors.
  const hardErrors = errors.filter((e) => !e.includes('favicon') && !e.includes('401'));
  check('B no console/runtime errors', hardErrors.length === 0, hardErrors.join(' ;; ') || 'none');

  console.log(`\n${failed === 0 ? 'ALL CLOSE-CONFIRM TESTS PASSED' : `${failed} TEST(S) FAILED`}`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1) });