/* Lightweight PWA service worker for Presensi FUPA */
const CACHE_VERSION = 'v1.0.3';
const APP_SHELL = [
  '/',             // GitHub Pages akan rewrite, namun biarkan sebagai hint
  '/index.html',
  '/karyawan.html',
  '/admin.html',
  '/manifest.webmanifest',
  '/app-shared.js'
];

// Runtime cache targets (fonts/icons)
const RUNTIME_ALLOWLIST = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://fonts.googleapis.com/css2',
  'https://fonts.gstatic.com/s',
  'https://fonts.gstatic.com/l',
  'https://fonts.gstatic.com/ea',
  'https://cdn.jsdelivr.net',
  'https://fonts.googleapis.com/icon'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(APP_SHELL);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE_VERSION) ? caches.delete(k) : null));
    self.clients.claim();
  })());
});

// Cache-first for app shell and whitelisted runtime; network-first for others
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Navigation fallback: serve index.html offline shell
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        return fresh;
      } catch {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  // Cache-first for fonts/icons and app shell
  const shouldCacheFirst = APP_SHELL.includes(url.pathname) ||
    RUNTIME_ALLOWLIST.some(origin => url.href.startsWith(origin));

  if (shouldCacheFirst) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE_VERSION);
        // Ignore opaque except fonts/icons
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch {
        return caches.match('/index.html');
      }
    })());
  }
});

// Optional: showNotification via postMessage
self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};
  if (type === 'notify' && self.registration && self.registration.showNotification) {
    self.registration.showNotification(payload.title || 'Informasi', {
      body: payload.body || '',
      icon: 'https://fonts.gstatic.com/s/i/materialiconsoutlined/notifications/24px.svg',
      badge: 'https://fonts.gstatic.com/s/i/materialiconsoutlined/notifications/24px.svg',
      silent: true
    });
  }
});