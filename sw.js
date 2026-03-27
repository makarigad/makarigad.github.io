const CACHE_NAME = 'makarigad-cache-v1';

// Add all the files your app needs to load visually
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/plant-data.html',
    '/plant-data.js',
    '/plant-data.css',
    '/hourly-log.html',
    '/hourly-log.js',
    '/hourly-log.css',
    '/energy-summary.html',
    '/signin.html',
    '/header.html',
    '/footer.html',
    '/core-app.js'
];

// Install Event: Cache the core assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

// Activate Event: Clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch Event: Serve from Cache, Fallback to Network (Cache-First Strategy for UI)
self.addEventListener('fetch', (event) => {
    // We only want to cache page assets, NOT database API calls to Supabase
    if (event.request.url.includes('supabase.co')) {
        return; // Let the browser handle database calls normally
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            // If the file is in the cache, return it immediately (works offline!)
            if (cachedResponse) {
                // Fetch the newest version in the background to keep the app updated
                fetch(event.request).then((networkResponse) => {
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, networkResponse.clone());
                    });
                }).catch(() => { /* Ignore network errors */ });
                
                return cachedResponse;
            }

            // If not in cache, go to the network
            return fetch(event.request).then((networkResponse) => {
                // If it's a valid response from an external CDN (like Tailwind or Chart.js), cache it for next time
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            });
        })
    );
});