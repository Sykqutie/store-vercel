/* Convenience Store POS service worker: offline-first app shell, network-only API. */
'use strict';

var CACHE = 'store-pos-v25';
var RUNTIME = 'store-pos-rt-v24';

// Bump this list when shell files change.
var PRECACHE = [
  '/',
  '/dashboard',
  '/pos',
  '/cashier',
  '/inventory',
  '/products',
  '/categories',
  '/report',
  '/receipt',
  '/users',
  '/backup',
  '/login',
  '/install',
  '/forgot-password',
  '/edit-product',
  '/offline',
  '/html/index.html',
  '/html/login.html',
  '/html/install.html',
  '/html/forgot-password.html',
  '/html/dashboard.html',
  '/html/pos.html',
  '/html/products.html',
  '/html/edit-product.html',
  '/html/categories.html',
  '/html/report.html',
  '/html/receipt.html',
  '/html/users.html',
  '/html/backup.html',
  '/html/offline.html',
  '/css/base.css',
  '/css/base.css?v=20261029',
  '/css/app.css',
  '/css/app.css?v=20261029',
  '/js/common.js',
  '/js/common.js?v=20261029',
  '/js/idb.js',
  '/js/sync.js',
  '/js/pwa.js',
  '/js/pwa.js?v=20261027',
  '/js/alerts.js',
  '/js/cart.js',
  '/js/index.js',
  '/js/login.js',
  '/js/login.js?v=20261027',
  '/js/install.js',
  '/js/forgot-password.js',
  '/js/dashboard.js',
  '/js/pos.js',
  '/js/products.js',
  '/js/edit-product.js',
  '/js/categories.js',
  '/js/report.js',
  '/js/receipt.js',
  '/js/users.js',
  '/js/backup.js',
  '/manifest.webmanifest',
  '/logo.svg',
  '/logo-full.svg',
  '/icons/smartmart-icon-192.png',
  '/icons/smartmart-icon-512.png',
  '/icons/smartmart-maskable-192.png',
  '/icons/smartmart-maskable-512.png',
  '/icons/smartmart-apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(PRECACHE);
    }).then(function () {
      return self.skipWaiting();
    }).catch(function () {
      // Offline-first is best-effort: an uncached file must not block install.
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE && k !== RUNTIME) return caches.delete(k);
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

function isApi(url) {
  return url.pathname.indexOf('/api/') === 0;
}

function networkFirstNavigation(request) {
  return fetch(request).then(function (res) {
    // Cache successful app-shell navigations for offline startup.
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(RUNTIME).then(function (cache) {
        cache.put(request, copy).catch(function () {});
      }).catch(function () {});
    }
    return res;
  }).catch(function () {
    return caches.match(request, { ignoreSearch: false }).then(function (hit) {
      if (hit) return hit;
      // Fall back to the cached route document, then the offline page.
      var url = new URL(request.url);
      var doc = '/html/offline.html';
      if (url.pathname === '/' || url.pathname === '/dashboard') doc = '/html/dashboard.html';
      else if (url.pathname === '/cashier') doc = '/html/pos.html';
      else if (url.pathname === '/pos') doc = '/html/pos.html';
      else if (url.pathname === '/inventory' || url.pathname === '/products') doc = '/html/products.html';
      else if (url.pathname === '/report') doc = '/html/report.html';
      else if (url.pathname === '/receipt') doc = '/html/receipt.html';
      else if (url.pathname === '/login') doc = '/html/login.html';
      else if (url.pathname === '/install') doc = '/html/install.html';
      else if (url.pathname === '/forgot-password') doc = '/html/forgot-password.html';
      else if (url.pathname === '/users') doc = '/html/users.html';
      else if (url.pathname === '/backup') doc = '/html/backup.html';
      else if (url.pathname === '/edit-product') doc = '/html/edit-product.html';
      return caches.match(doc).then(function (page) {
        return page || caches.match('/html/offline.html');
      });
    });
  });
}

function cacheFirstStatic(request) {
  return caches.match(request, { ignoreSearch: false }).then(function (hit) {
    if (hit) return hit;
    return fetch(request).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(RUNTIME).then(function (cache) {
          cache.put(request, copy).catch(function () {});
        }).catch(function () {});
      }
      return res;
    });
  });
}

// Scripts and styles use network-first while online so a deployment takes
// effect on the next load, not one reload later. The cached copy still covers
// offline use.
function networkFirstStatic(request) {
  return fetch(request).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(RUNTIME).then(function (cache) {
        cache.put(request, copy).catch(function () {});
      }).catch(function () {});
    }
    return res;
  }).catch(function () {
    return caches.match(request, { ignoreSearch: true }).then(function (hit) {
      return hit || new Response('', { status: 503, statusText: 'Offline' });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return; // never cache writes
  var url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return; // CDN/fonts: leave to the network
  if (isApi(url)) return; // API is network-only; the app queues when offline

  if (req.mode === 'navigate' || (req.destination === '' && req.headers.get('accept') && req.headers.get('accept').indexOf('text/html') !== -1)) {
    event.respondWith(networkFirstNavigation(req));
    return;
  }
  if (req.destination === 'style' || req.destination === 'script' || url.pathname === '/manifest.webmanifest' || url.pathname === '/sw.js') {
    event.respondWith(networkFirstStatic(req));
    return;
  }
  if (req.destination === 'image' || req.destination === 'font' || url.pathname.indexOf('/icons/') === 0) {
    event.respondWith(cacheFirstStatic(req));
  }
});
