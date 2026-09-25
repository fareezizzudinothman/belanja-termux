'use strict';

// Belanja service worker - static-shell caching only.
// Never caches API/auth/user data.

const CACHE = 'belanja-static-v3';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/login.html',
  '/register.html',
  '/dashboard.html',
  '/monthly.html',
  '/fixed-expenses.html',
  '/variable-expenses.html',
  '/installments.html',
  '/profile.html',
  '/offline.html',
  '/manifest.json',
  '/css/style.css',
  '/js/ui.js',
  '/js/index.js',
  '/js/auth.js',
  '/js/dashboard.js',
  '/js/monthly.js',
  '/js/fixed-expenses.js',
  '/js/variable-expenses.js',
  '/js/installments.js',
  '/js/profile.js',
  '/images/icon-192.png',
  '/images/icon-512.png',
  '/images/icon-maskable-512.png',
  '/images/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all(
          // fetch(..., { cache: 'reload' }) bypasses the HTTP cache so a
          // re-precache after deployment always gets the CURRENT bytes - never
          // a stale 304 that would make cache.addAll reject and kill the update.
          PRECACHE_URLS.map((url) => fetch(url, { cache: 'reload' }).then((res) => cache.put(url, res)))
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('belanja-static-') && k !== CACHE).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only same-origin GET requests are handled.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Never touch API/auth/user data - network only.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: stale-while-revalidate. Serve the precached/known shell
  // (including query-string variants like /monthly.html?year=&month=) from the
  // cache immediately, then revalidate it in the background so the next visit
  // is even fresher. Offline still falls back to the built-in offline page.
  if (req.mode === 'navigate') {
    const normalize = new URL(url.origin);
    normalize.pathname = url.pathname;
    const shell = new Request(normalize.toString());

    event.respondWith(
      caches.match(shell).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(shell, copy));
            }
            return res;
          })
          .catch(() => cached || caches.match('/offline.html'));
        return cached || network;
      })
    );
    return;
  }

  // Static assets: stale-while-revalidate - always answer from the cache
  // immediately, but refresh it from the network in the background so that
  // deployments self-heal (an old JS file can never stay cached forever).
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => undefined);
      return hit || network;
    })
  );
});