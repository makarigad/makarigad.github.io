const CACHE_NAME = 'makarigad-cache-v4';
const API_CACHE_NAME = 'makarigad-api-cache-v1';

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './plant-data.html',
    './hourly-log.html',
    './energy-summary.html',
    './nepali-calendar.html',
    './user-management.html',
    './signin.html',
    './header.html',
    './core-app.js',
    './hourly-log-tools.js',
    './manifest.json',
    './plant-data.js',
    './plant-data.css',
    './hourly-log.css',
    './footer.html'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => Promise.all(
            cacheNames.map((cacheName) => {
                if (cacheName !== CACHE_NAME && cacheName !== API_CACHE_NAME) {
                    return caches.delete(cacheName);
                }
            })
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // 1. OFFLINE DATABASE MAGIC: Cache Supabase Data for offline reading!
    if (event.request.url.includes('supabase.co/rest/v1/')) {
        if (event.request.method === 'GET') {
            event.respondWith(
                fetch(event.request).then(response => {
                    const clone = response.clone();
                    caches.open(API_CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return response;
                }).catch(() => {
                    return caches.match(event.request); // Returns offline data!
                })
            );
            return;
        }
    }

    // 2. STOP FREEZING: Fast-fail the SCADA proxy when offline
    if (event.request.url.includes('makari-scada-proxy')) {
        event.respondWith(
            fetch(event.request).catch(() => new Response("Offline", { status: 503 }))
        );
        return;
    }

    // 3. Normal App Files Cache
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                fetch(event.request).then((networkResponse) => {
                    if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse.clone()));
                    }
                }).catch(() => {});
                return cachedResponse;
            }
            return fetch(event.request).then((networkResponse) => {
                if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
                }
                return networkResponse;
            }).catch(() => {});
        })
    );
});