const CACHE_VERSION   = 'v9';
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
    './ad-prediction.html',
    './components/header.html',
    './components/footer.html',
    './assets/js/core-app.js',
    './assets/js/index.js',
    './assets/js/plant-data.js',
    './assets/js/hourly-log.js',
    './assets/js/hourly-log-tools.js',
    './assets/js/inventory.js',
    './assets/js/operator-daily.js',
    './assets/js/attendance.js',
    './assets/js/ad-prediction-init.js',
    './assets/js/rainfall.js',
    './assets/css/index.css',
    './assets/css/plant-data.css',
    './assets/css/hourly-log.css',
    './assets/icons/icon.svg',
    './manifest.json',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            cache.addAll(ASSETS_TO_PRECACHE).catch(err => {
                console.warn('[SW] Pre-cache partially failed:', err.message);
            })
        )
    );
    self.skipWaiting();
});

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

self.addEventListener('fetch', (event) => {
    const { request } = event;

    if (request.method !== 'GET' || !request.url.startsWith('http')) return;

    const url = request.url;

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

    if (url.includes('makari-scada-proxy')) {
        event.respondWith(
            fetch(request).catch(() => new Response('Offline', {
                status: 503,
                headers: { 'Content-Type': 'text/plain' }
            }))
        );
        return;
    }

    if (url.includes('cdn.tailwindcss.com') || url.includes('fonts.googleapis.com') ||
        url.includes('cdn.jsdelivr.net') || url.includes('fonts.gstatic.com') || url.includes('unpkg.com') ||
        url.includes('cdnjs.cloudflare.com')) {

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

    event.respondWith(
        caches.match(request).then(cached => {
            const networkFetch = fetch(request).then(res => {
                if (res?.ok || res?.type === 'opaque') {
                    const resClone = res.clone();
                    caches.open(CACHE_NAME).then(c => c.put(request, resClone));
                }
                return res;
            }).catch(() => null);

            if (cached) {
                event.waitUntil(networkFetch);
            }

            return cached ?? networkFetch;
        })
    );
});
