const CACHE_NAME = 'famguard-shell-v11';
const SHELL_FILES = ['/', '/manifest.webmanifest', '/famguard-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/')));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});

self.addEventListener('push', event => {
  let payload = {
    title: 'FamGuard SOS',
    body: 'A family member needs help.',
    alertId: null,
    senderName: 'A family member',
    latitude: null,
    longitude: null
  };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/famguard-icon.png',
    badge: '/famguard-icon.png',
    requireInteraction: true,
    vibrate: [500, 200, 500, 200, 800],
    tag: 'famguard-sos',
    renotify: true,
    actions: [
      { action: 'view-map', title: 'View on Map' },
      { action: 'acknowledge', title: 'Acknowledge' }
    ],
    data: {
      url: payload.url || '/#locations',
      alertId: payload.alertId,
      senderName: payload.senderName,
      latitude: payload.latitude,
      longitude: payload.longitude
    }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const action = event.action === 'acknowledge' ? 'acknowledge' : 'view-map';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    if (data.alertId) {
      const existing = clients.find(client => new URL(client.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        existing.postMessage({ type: 'famguard:sos-action', alertId: data.alertId, action });
        return;
      }
      const destination = new URL(data.url || '/#locations', self.location.origin);
      destination.searchParams.set('alertId', data.alertId);
      if (action === 'acknowledge') destination.searchParams.set('sosAction', action);
      return self.clients.openWindow(destination.href);
    }

    const destination = new URL(data.url || '/', self.location.origin).href;
    const existing = clients.find(client => client.url === destination);
    return existing ? existing.focus() : self.clients.openWindow(destination);
  }));
});