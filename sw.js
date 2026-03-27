const CACHE_NAME = 'makarigad-cache-v2'; // Bumped version to force an update

// Use Relative Paths (./) to guarantee it works on GitHub Pages!
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
    // Keep these if you still have them as separate files in your folder
    './plant-data.js',
    './plant-data.css',
    './hourly-log.css',
    './footer.html'
];

// Install Event: Cache the core assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('Caching core assets...');
            // addAll will fail if ANY file returns a 404, so using relative paths is crucial
            return cache.addAll(ASSETS_TO_CACHE);
        }).catch(err => console.error('Cache installation failed:', err))
    );
    self.skipWaiting();
});

// Activate Event: Clean up old caches when you update the CACHE_NAME version
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch Event: Stale-While-Revalidate Strategy
self.addEventListener('fetch', (event) => {
    // 1. DO NOT CACHE SUPABASE DATABASE CALLS
    if (event.request.url.includes('supabase.co')) {
        return; 
    }

    // 2. DO NOT CACHE LIVE SCADA TELEMETRY
    if (event.request.url.includes('makari-scada-proxy')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            // If the file is in the cache, return it immediately (Extremely fast & works offline!)
            if (cachedResponse) {
                // Background update: Fetch the newest version quietly to keep the app updated for next time
                fetch(event.request).then((networkResponse) => {
                    // Allow opaque responses (like Tailwind CSS from CDNs) to be cached
                    if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, networkResponse.clone());
                        });
                    }
                }).catch(() => { /* Ignore network errors in background */ });
                
                return cachedResponse;
            }

            // If not in cache, go to the internet
            return fetch(event.request).then((networkResponse) => {
                // Cache the newly fetched file for next time (allowing CDNs to cache)
                if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch((error) => {
                console.error('Offline and resource not found in cache:', event.request.url);
                // You could optionally return a fallback offline HTML page here if desired
            });
        })
    );
});