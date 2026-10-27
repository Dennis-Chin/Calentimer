/**
 * sw.js - Service Worker for Calentimer
 * Manages caching, offline reliability, and notification interactions for PWA.
 */

const CACHE_NAME = 'calentimer-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/timerRuntime.js',
  '/schedulerEngine.js',
  '/taskStore.js',
  '/audioManager.js',
  '/mobileServices.js',
  '/calendarView.js',
  '/analyticsDb.js',
  '/manifest.json',
  '/icon.png',
  '/icon-512.png',
  '/icon.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        ASSETS.map((url) => {
          return cache.add(url).catch((err) => {
            // Non-fatal if a specific asset fails during dev
            console.warn('Asset precache skipped for:', url, err);
          });
        })
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Ignore chrome-extension:// and non-http schemes
  if (!event.request.url || !event.request.url.startsWith('http')) return;
  // Search engine crawlers: let robots.txt and sitemap.xml pass directly to network
  if (event.request.url.indexOf('/robots.txt') !== -1 || event.request.url.indexOf('/sitemap.xml') !== -1) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.mode === 'navigate') {
            return caches.match('/') || caches.match('/index.html');
          }
        });
      })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});
