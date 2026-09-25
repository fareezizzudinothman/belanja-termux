'use strict';

const { chromium } = require('playwright');
const http = require('http');

// Mobile + PWA (Phase 1) browser test.
//
// The app is reached through the Playwright container at
// `host.docker.internal:8080`, but a service worker needs a SECURE context.
// `http://localhost` is natively secure, so the test starts a tiny reverse
// proxy inside the container on 127.0.0.1 and drives the browser against it.
// The proxy forwards everything (static + /api + Set-Cookie) unchanged, so
// cookies, CORS/same-origin and the service worker all behave like production
// on localhost or HTTPS (e.g. the Cloudflare tunnel).
const TARGET_URL = new URL((process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, ''));
const CHROME = process.env.CHROME_PATH || '/ms-playwright/chromium-1124/chrome-linux/chrome';
const suffix = Date.now() % 1000000;
const email = `mobile${suffix}@t.local`;
const password = 'password123';
const VIEWPORTS = [[375, 667], [390, 844], [412, 915]];
let failed = 0;
let dialogs = [];
let errors = [];

function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
  if (!cond) failed++;
}

// Same formatting as UI.monthLabel in frontend/js/ui.js.
function expectedLabel(year, month) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-MY', { month: 'long', year: 'numeric' });
}

function noOverflow(page) {
  return page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
  }));
}

// `emulateOffline` makes the proxy drop client connections, so the service
// worker's network requests actually reject (Playwright's setOffline does not
// reliably block requests made by a controlling service worker).
const proxy = http.createServer((req, res) => {
  if (proxy.emulateOffline) { req.destroy(); return; }
  const up = http.request({
    host: TARGET_URL.hostname,
    port: TARGET_URL.port,
    path: req.url,
    method: req.method,
    headers: req.headers,
  }, (ures) => {
    res.writeHead(ures.statusCode, ures.headers);
    ures.pipe(res);
  });
  req.pipe(up);
  up.on('error', () => { try { res.writeHead(502); } catch { /* ignore */ } res.end(); });
});

(async () => {
  const PORT = await new Promise((resolve) => proxy.listen(0, '127.0.0.1', () => resolve(proxy.address().port)));
  const BASE = `http://localhost:${PORT}`;
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  // ---- Seed a fresh account once (register -> fixed master -> loan) -------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());

    await page.goto(BASE + '/register.html', { waitUntil: 'networkidle' });
    await page.fill('#name', 'Mobile User');
    await page.fill('#email', email);
    await page.fill('#password', password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      page.click('#register-form [type="submit"]'),
    ]);
    check('register -> dashboard', page.url().includes('/dashboard.html'), page.url());
    await page.waitForSelector('#t-total');

    await page.goto(BASE + '/fixed-expenses.html', { waitUntil: 'networkidle' });
    await page.click('#add-fixed-btn');
    await page.waitForSelector('#fixed-modal[open]');
    await page.fill('#fixed-name', 'Mobile Rent');
    await page.selectOption('#fixed-type', 'property');
    await page.fill('#fixed-amount', '1200');
    await page.click('#fixed-form [type="submit"]');
    await page.waitForSelector('#fixed-tbody tr');

    await page.goto(BASE + '/installments.html', { waitUntil: 'networkidle' });
    await page.click('#add-inst-btn');
    await page.waitForSelector('#inst-modal[open]');
    await page.fill('#inst-loan', 'Mobile Loan');
    await page.fill('#inst-mo', '150');
    await page.fill('#inst-total-amount', '3600');
    await page.fill('#inst-total-months', '24');
    await page.fill('#inst-paid-months', '6');
    await page.click('#inst-form [type="submit"]');
    await page.waitForSelector('#inst-cards .card');
    await ctx.close();
  }

  // ---- Functional mobile checks at several phone widths -------------------
  for (const [w, h] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true });
    const page = await ctx.newPage();
    dialogs = [];
    errors = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

    // Login (also verifies the login page is mobile-friendly).
    await page.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
    const loginOv = await noOverflow(page);
    check(`[${w}x${h}] login page no horizontal overflow`, loginOv.sw <= loginOv.iw + 1, `scrollWidth=${loginOv.sw} innerWidth=${loginOv.iw}`);
    await page.fill('#email', email);
    await page.fill('#password', password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      page.click('#login-form [type="submit"]'),
    ]);
    await page.waitForSelector('#t-total');
    check(`[${w}x${h}] login -> dashboard`, page.url().includes('/dashboard.html'), page.url());

    const dOv = await noOverflow(page);
    check(`[${w}x${h}] dashboard no horizontal overflow`, dOv.sw <= dOv.iw + 1, `scrollWidth=${dOv.sw} innerWidth=${dOv.iw}`);

    const cards = await page.$$eval('#totals .card', (els) => els.length);
    check(`[${w}x${h}] five stat cards render`, cards === 5, `${cards}`);

    const bars = await page.$$eval('#chart .bar-col', (els) => els.length);
    check(`[${w}x${h}] chart keeps 12 bars (scrollable wrap)`, bars === 12, `${bars}`);

    const navs = await page.$$eval('#bottom-nav a', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
    check(`[${w}x${h}] bottom nav: Dashboard|Monthly|Expenses present`, navs.some((t) => t.includes('Dashboard')) && navs.some((t) => t.includes('Monthly')) && navs.some((t) => t.includes('Expenses')), navs.join(' | '));
    check(`[${w}x${h}] bottom nav More tab present`, (await page.$('#more-tab')) !== null);

    await page.click('#more-tab');
    check(`[${w}x${h}] More opens the nav menu`, await page.$eval('#main-nav', (el) => el.classList.contains('open')));
    await page.click('#more-tab');
    check(`[${w}x${h}] More closes the nav menu`, await page.$eval('#main-nav', (el) => !el.classList.contains('open')));

    await page.click('#nav-toggle');
    check(`[${w}x${h}] hamburger opens the nav menu`, await page.$eval('#main-nav', (el) => el.classList.contains('open')));
    await page.click('#nav-toggle');

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      page.click('#bottom-nav a[data-nav="/monthly.html"]'),
    ]);
    check(`[${w}x${h}] bottom nav navigates to Monthly`, page.url().includes('/monthly.html'), page.url());

    await page.waitForSelector('#month-status');
    const badge = await page.$eval('#month-status', (el) => el.textContent.trim());
    const cur = await page.evaluate(() => fetch('/api/monthly/current').then((r) => r.json()));
    const label = expectedLabel(cur.year, cur.month);

    if (badge.includes('NOT OPEN')) {
      await page.click('#open-month-btn');
      await page.waitForFunction(() => document.getElementById('month-status').textContent.trim() === 'OPEN');
      const openMsg = dialogs[dialogs.length - 1] || '';
      check(`[${w}x${h}] "Open ${label}?" confirm names month`, openMsg.startsWith(`Open ${label}?`), JSON.stringify(openMsg));
    }

    const mOv = await noOverflow(page);
    check(`[${w}x${h}] monthly page no horizontal overflow`, mOv.sw <= mOv.iw + 1, `scrollWidth=${mOv.sw} innerWidth=${mOv.iw}`);

    await page.waitForFunction(() => document.getElementById('add-var-btn').style.display !== 'none');
    await page.click('#add-var-btn');
    await page.waitForSelector('#var-modal[open]');
    const dlg = await page.evaluate(() => {
      const r = document.getElementById('var-modal').getBoundingClientRect();
      return { w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight };
    });
    check(`[${w}x${h}] add-expense modal fits viewport`, dlg.w <= dlg.vw && dlg.h <= dlg.vh, JSON.stringify(dlg));
    const expenseName = `Mobile${w}`;
    await page.fill('#var-name', expenseName);
    await page.selectOption('#var-type', 'food');
    await page.fill('#var-amount', '12.5');
    await page.click('#var-form [type="submit"]');
    await page.waitForFunction((n) => document.getElementById('var-list').textContent.includes(n), expenseName);
    check(`[${w}x${h}] variable expense added via modal`, true);

    await page.click('#close-month-btn');
    await page.waitForFunction(() => document.getElementById('month-status').textContent.includes('CLOSED'));
    const closeMsg = dialogs[dialogs.length - 1] || '';
    check(`[${w}x${h}] "Close ${label}?" confirm`, closeMsg.startsWith(`Close ${label}?`), JSON.stringify(closeMsg));

    await page.click('#reopen-month-btn');
    await page.waitForFunction(() => document.getElementById('month-status').textContent.trim() === 'OPEN');
    const reopenMsg = dialogs[dialogs.length - 1] || '';
    check(`[${w}x${h}] "Reopen ${label}?" confirm`, reopenMsg.startsWith(`Reopen ${label}?`), JSON.stringify(reopenMsg));

    await page.goto(BASE + '/fixed-expenses.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('#fixed-tbody tr');
    const fOv = await noOverflow(page);
    const fixedRows = await page.$$eval('#fixed-tbody tr', (els) => els.length);
    const hasLabels = await page.$$eval('#fixed-tbody td', (els) => els.every((td) => td.dataset.label !== undefined));
    check(`[${w}x${h}] fixed expenses render as mobile cards, no overflow`, fixedRows >= 1 && fOv.sw <= fOv.iw + 1, `rows=${fixedRows} scrollWidth=${fOv.sw} innerWidth=${fOv.iw}`);
    check(`[${w}x${h}] fixed rows carry data-label`, hasLabels);

    await page.goto(BASE + '/installments.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('#inst-cards .card');
    const iOv = await noOverflow(page);
    check(`[${w}x${h}] installments page no horizontal overflow`, iOv.sw <= iOv.iw + 1, `scrollWidth=${iOv.sw} innerWidth=${iOv.iw}`);

    await page.goto(BASE + '/profile.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('#p-email');
    const pOv = await noOverflow(page);
    check(`[${w}x${h}] profile page no horizontal overflow`, pOv.sw <= pOv.iw + 1, `scrollWidth=${pOv.sw} innerWidth=${pOv.iw}`);

    const hardErrors = errors.filter((e) => !e.includes('favicon') && !e.includes('401'));
    check(`[${w}x${h}] no console/runtime errors`, hardErrors.length === 0, hardErrors.join(' ;; ') || 'none');

    await ctx.close();
  }

  // ---- PWA checks: manifest, service worker, caching, offline -------------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());

    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: 'networkidle' });
    check('service worker controls the page after reload', await page.evaluate(() => !!navigator.serviceWorker.controller));
    const regInfo = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      return { active: !!(r && r.active), scope: r ? r.scope : '' };
    });
    check('service worker registered with scope /', regInfo.active && regInfo.scope.endsWith('/'), JSON.stringify(regInfo));

    const cacheInfo = await page.evaluate(async () => {
      const keys = await caches.keys();
      const style = await caches.match('/css/style.css');
      const api = await caches.match('/api/dashboard');
      const offline = await caches.match('/offline.html');
      return { keys, hasStyle: !!style, hasApi: !!api, hasOffline: !!offline };
    });
    check('cache "belanja-static-v1" exists', cacheInfo.keys.includes('belanja-static-v1'), cacheInfo.keys.join(','));
    check('css/style.css is precached', cacheInfo.hasStyle);
    check('offline.html is precached', cacheInfo.hasOffline);
    check('/api/* is NEVER cached', !cacheInfo.hasApi);

    const mani = await page.evaluate(() => fetch('/manifest.json').then((r) => (r.status === 200 ? r.json() : Promise.reject(r.status))));
    check('manifest: name Belanja', mani.name === 'Belanja', mani.name);
    check('manifest: short_name Belanja', mani.short_name === 'Belanja', mani.short_name);
    check('manifest: display standalone', mani.display === 'standalone', mani.display);
    check('manifest: theme_color #0f766e', mani.theme_color === '#0f766e', mani.theme_color);
    check('manifest: background_color #f4f6f8', mani.background_color === '#f4f6f8', mani.background_color);
    check('manifest: start_url / scope /', mani.start_url === '/' && mani.scope === '/', `${mani.start_url} / ${mani.scope}`);
    const sizes = (mani.icons || []).map((i) => i.sizes);
    check('manifest: icons 192 + 512', sizes.includes('192x192') && sizes.includes('512x512'), sizes.join(','));
    const hasMaskable = (mani.icons || []).some((i) => i.purpose === 'maskable');
    check('manifest: maskable icon present', hasMaskable);

    const headCheck = await page.evaluate(() => ({
      manifest: !!document.querySelector('link[rel="manifest"][href="/manifest.json"]'),
      theme: !!document.querySelector('meta[name="theme-color"]'),
      apple: !!document.querySelector('link[rel="apple-touch-icon"]'),
      appleCap: !!document.querySelector('meta[name="apple-mobile-web-app-capable"]'),
    }));
    check('head includes manifest link', headCheck.manifest);
    check('head includes theme-color meta', headCheck.theme);
    check('head includes apple-touch-icon', headCheck.apple);
    check('head includes apple-mobile-web-app metadata', headCheck.appleCap);

    const icon = await page.evaluate(() => fetch('/images/icon-192.png').then((r) => ({ s: r.status, ct: r.headers.get('content-type') })));
    check('icon-192 serves as image/png', icon.s === 200 && (icon.ct || '').includes('image/png'), JSON.stringify(icon));

    const swHdr = await page.evaluate(() => fetch('/service-worker.js').then((r) => ({ s: r.status, cc: r.headers.get('cache-control') })));
    check('service-worker.js served no-store', swHdr.s === 200 && /no-store/i.test(swHdr.cc || ''), JSON.stringify(swHdr));

    check('no localStorage / user data written by PWA layer', await page.evaluate(() => localStorage.length === 0));

    // Offline behaviour (via the controlling service worker). First clear the
    // browser's HTTP disk cache (the precache addAll just filled it), then make
    // the proxy drop every connection - so the service worker's network
    // requests genuinely reject and it must fall back to the cache.
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.clearBrowserCache');
    proxy.emulateOffline = true;
    await page.goto(BASE + '/dashboard.html', { waitUntil: 'load' });
    const offlineNav = await page.evaluate(() => document.body.textContent.includes("You're offline"));
    check('offline navigation falls back to the offline page', offlineNav);

    await page.goto(BASE + '/offline.html', { waitUntil: 'load' });
    check('offline.html loads from cache', await page.evaluate(() => !!document.querySelector('.card')));

    const cssStatus = await page.evaluate(() => fetch('/css/style.css').then((r) => r.status));
    check('css served from cache while offline', cssStatus === 200, `${cssStatus}`);

    const apiOffline = await page.evaluate(() => fetch('/api/dashboard').then(() => 'ok', () => 'failed'));
    check('/api failed offline (not cached)', apiOffline === 'failed', apiOffline);
    proxy.emulateOffline = false;

    await ctx.close();
  }

  console.log(`\n${failed === 0 ? 'ALL MOBILE+PWA TESTS PASSED' : `${failed} TEST(S) FAILED`}`);
  await browser.close();
  proxy.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });