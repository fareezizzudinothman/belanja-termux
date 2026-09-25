'use strict';

// Belanja service worker - static-shell caching only.
// Never caches API/auth/user data.

const CACHE = 'belanja-static-v1';

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
      .then((cache) => cache.addAll(PRECACHE_URLS))
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

  // Navigations: network-first, fall back to the offline page when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match('/offline.html'))
    );
    return;
  }

  // Static assets: cache-first, then network + cache fill.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          })
          .catch(() => undefined)
    )
  );
});