/* Daybook service worker — offline app shell + notification click handling. */
const VERSION = 'daybook-v1';
const SHELL = [
  './',
  './index.html',
  './widget.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/widget.js',
  './js/store.js',
  './js/dates.js',
  './js/recur.js',
  './js/habits.js',
  './js/reminders.js',
  './js/ics.js',
  './js/wallpaper.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network-first for same-origin GETs so updates land quickly; cache fallback offline.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate ? client.navigate(url).catch(() => {}) : null;
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

// Ready for a Web Push backend: payload { title, body, url }.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Daybook', body: event.data && event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Daybook', {
      body: data.body || '',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { url: data.url || './index.html' },
    }),
  );
});
