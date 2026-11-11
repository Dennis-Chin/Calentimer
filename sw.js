/**
 * sw.js - Service Worker for Calentimer
 * Manages caching, offline reliability, and notification interactions for PWA.
 */

const CACHE_NAME = 'calentimer-v10';
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
  '/calendarSyncService.js',
  '/googleCalendarAdapter.js',
  '/microsoftCalendarAdapter.js',
  '/eventClassifier.js',
  '/cryptoPolyfill.js',
  '/telemetrySyncService.js',
  '/analyticsDb.js',
  '/manifest.json',
  '/icon.png',
  '/icon-512.png',
  '/icon.svg',
  '/badge-icon.png',
  '/badge-icon.svg'
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

// ========================================================
// Dynamic Background Countdown Ticking via Service Worker
// ========================================================
let bgTimerId = null;
let bgTimerState = null;

function renderBackgroundNotification(state, remainingSec) {
  if (!state || !state.activeTask) return;
  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;
  const timeStr = (mins < 10 ? '0' + mins : mins) + ':' + (secs < 10 ? '0' + secs : secs);
  const title = state.isPaused ? '⏸ Paused · ' + state.activeTask.title : state.activeTask.title;
  const timespan = state.timespanText ? ' · ' + state.timespanText : '';
  const body = timeStr + ' left' + timespan;

  return self.registration.showNotification(title, {
    body: body,
    icon: '/icon.png',
    badge: '/badge-icon.png',
    tag: 'calentimer-active-countdown',
    renotify: false,
    silent: true,
    requireInteraction: !state.isPaused,
    ongoing: !state.isPaused,
    data: { url: '/' }
  });
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'START_BG_TIMER') {
    bgTimerState = data.payload;
    if (bgTimerId) {
      clearInterval(bgTimerId);
      bgTimerId = null;
    }
    if (!bgTimerState || bgTimerState.isPaused) return;

    const remainingSec = typeof bgTimerState.remainingSeconds === 'number' ? bgTimerState.remainingSeconds : 0;
    const targetEndTime = Date.now() + (remainingSec * 1000);

    bgTimerId = setInterval(() => {
      const now = Date.now();
      const currentRemaining = Math.max(0, Math.round((targetEndTime - now) / 1000));
      renderBackgroundNotification(bgTimerState, currentRemaining);
      if (currentRemaining <= 0) {
        if (bgTimerId) {
          clearInterval(bgTimerId);
          bgTimerId = null;
        }
      }
    }, 1000);
  } else if (data.type === 'STOP_BG_TIMER') {
    if (bgTimerId) {
      clearInterval(bgTimerId);
      bgTimerId = null;
    }
    bgTimerState = null;
  }
});

