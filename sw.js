// Service Worker - Malé Tacos
// Gère le cache offline et sert de base pour les futures notifications push

const CACHE_NAME = 'male-tacos-v3';
const OFFLINE_URL = './index.html';

// Fichiers essentiels à mettre en cache pour un fonctionnement offline correct
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './js/app.js',
  './js/products-render.js',
  './manifest.webmanifest',
  './logo-male.png',
  './standard.jpg',
  './mc-yaourt.jpg',
  './spaghetti.jpg',
  './burger.jpg',
  './tacos-viande.jpg',
  './tacos-poulet.jpg'
];

// Installation : on précharge les fichiers essentiels
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[SW] Erreur de précache :', err))
  );
});

// Activation : on nettoie les anciens caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch : stratégie "cache d'abord, réseau en secours" pour les assets,
// et "réseau d'abord, cache en secours" pour la navigation (pour avoir les mises à jour)
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Ignorer les requêtes non-GET (ex: WhatsApp, API externes)
  if (request.method !== 'GET') return;

  // Ignorer les requêtes vers d'autres domaines (ex: wa.me)
  if (!request.url.startsWith(self.location.origin)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => cached);
    })
  );
});

// Base pour les notifications push (opt-in, gérées plus tard depuis app.js)
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Malé Tacos', {
      body: data.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'male-tacos-notification'
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('./index.html');
      }
    })
  );
});
