const CACHE_NAME = 'tradex-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './dashboard.html',
  './depth.html',
  './history.html',
  './login.html',
  './orders.html',
  './performance.html',
  './portfolio.html',
  './profile.html',
  './receipts.html',
  './trade.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './css/style.css',
  './js/api.js',
  './js/charts.js',
  './js/config.js',
  './js/layout.js',
  './js/mock.js',
  './js/pwa.js',
  './js/store.js',
  './js/utils.js',
  './js/pages/dashboard.js',
  './js/pages/depth.js',
  './js/pages/history.js',
  './js/pages/login.js',
  './js/pages/orders.js',
  './js/pages/performance.js',
  './js/pages/portfolio.js',
  './js/pages/profile.js',
  './js/pages/receipts.js',
  './js/pages/trade.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('tradex-shell-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  const isNavigation = request.mode === 'navigate';
  const isAppAsset = url.pathname.endsWith('/manifest.json')
    || url.pathname.startsWith('/css/')
    || url.pathname.startsWith('/js/')
    || url.pathname.startsWith('/icons/');
  if (!isNavigation && !isAppAsset) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (isNavigation) {
        const home = await cache.match('./index.html');
        if (home) return home;
      }
      throw error;
    }
  })());
});
