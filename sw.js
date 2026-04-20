const CACHE_VERSION   = 'v6'; // 👉 BUMPED TO v6 to force everyone to update
const CACHE_NAME      = `makarigad-cache-${CACHE_VERSION}`;
const API_CACHE_NAME  = 'makarigad-api-cache-v2';

const ASSETS_TO_PRECACHE = [
    './',
    './index.html',
    './signin.html',
    './plant-data.html',
    './hourly-log.html',
    './energy-summary.html',
    './nepali-calendar.html',
    './user-management.html',
    './attendance.html',
    './operator-daily.html',
    './inventory.html',
    './mobile.html',
    './monthly_report.html',
    './components/header.html',
    './components/footer.html',
    './assets/js/core-app.js',
    './assets/js/index.js',
    './assets/js/plant-data.js',
    './assets/js/hourly-log.js',
    './assets/js/hourly-log-tools.js',
    './assets/js/inventory.js',
    './assets/js/operator-daily.js',
    './assets/js/attendance.js', // 👉 ADDED THIS MISSING FILE
    './assets/css/index.css',
    './assets/css/plant-data.css',
    './assets/css/hourly-log.css',
    './manifest.json',
];

// ── Install: pre-cache all app assets ──
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            cache.addAll(ASSETS_TO_PRECACHE).catch(err => {
                // Don't block install on missing optional assets
                console.warn('[SW] Pre-cache partially failed:', err.message);
            })
        )
    );
    self.skipWaiting();
});

// ── Activate: clean up old caches ──
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.map(key => {
                    if (key !== CACHE_NAME && key !== API_CACHE_NAME) {
                        console.info('[SW] Deleting old cache:', key);
                        return caches.delete(key);
                    }
                })
            )
        )
    );
    self.clients.claim();
});

// ── Fetch handler ──
self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Skip non-GET and non-HTTP requests (e.g., chrome-extension://)
    if (request.method !== 'GET' || !request.url.startsWith('http')) return;

    const url = request.url;

    // ── 1. Supabase API calls → network-first with API cache fallback ──
    if (url.includes('supabase.co/rest/v1/') || url.includes('supabase.co/auth/')) {
        event.respondWith(
            fetch(request).then(res => {
                if (res && res.status === 200) {
                    const clone = res.clone();
                    caches.open(API_CACHE_NAME).then(c => c.put(request, clone));
                }
                return res;
            }).catch(() => caches.match(request))
        );
        return;
    }

    // ── 2. SCADA proxy → network only, graceful offline response ──
    if (url.includes('makari-scada-proxy')) {
        event.respondWith(
            fetch(request).catch(() => new Response('Offline', {
                status: 503,
                headers: { 'Content-Type': 'text/plain' }
            }))
        );
        return;
    }

    // ── 3. External CDN resources → cache on first use ──
    // 👉 ADDED unpkg.com so Leaflet maps work offline!
    if (url.includes('cdn.tailwindcss.com') || url.includes('fonts.googleapis.com') ||
        url.includes('cdn.jsdelivr.net') || url.includes('fonts.gstatic.com') || url.includes('unpkg.com')) {
        
        event.respondWith(
            caches.match(request).then(cached => {
                if (cached) return cached;
                return fetch(request).then(res => {
                    if (res?.status === 200) {
                        const resClone = res.clone(); 
                        caches.open(CACHE_NAME).then(c => c.put(request, resClone));
                    }
                    return res;
                }).catch(() => new Response('', { status: 503 }));
            })
        );
        return;
    }

    // ── 4. App assets → stale-while-revalidate ──
    event.respondWith(
        caches.match(request).then(cached => {
            // Return cache immediately, fetch update in background
            const networkFetch = fetch(request).then(res => {
                if (res?.ok || res?.type === 'opaque') {
                    const resClone = res.clone();
                    caches.open(CACHE_NAME).then(c => c.put(request, resClone));
                }
                return res;
            }).catch(() => null);

            // Prevent the service worker from going to sleep before the background update finishes
            if (cached) {
                event.waitUntil(networkFetch);
            }

            return cached ?? networkFetch;
        })
    );
});