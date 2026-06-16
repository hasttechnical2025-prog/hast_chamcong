const VERSION = 'v2026.06.16_11636';
const CACHE_NAME = `hast-attendance-${VERSION}`;

// Liệt kê tài nguyên tĩnh cần precache
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './quantri/index.html',
  './giaitrinh/index.html',
  './src/css/base.css',
  './src/css/components.css',
  './src/css/history.css',
  './src/css/guide.css',
  './src/js/config.js',
  './src/js/supabaseClient.js',
  './src/js/api.js',
  './src/js/telegram.js',
  './src/js/pwa.js',
  './src/js/clock.js',
  './src/js/gps.js',
  './src/js/attendance.js',
  './src/js/history.js',
  './src/js/justification.js',
  './src/js/guide.js',
  './src/js/main.index.js',
  './src/js/main.quantri.js',
  './src/js/main.giaitrinh.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Clearing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Bỏ qua các yêu cầu đến Supabase API hoặc OSM Nominatim
  if (event.request.url.includes('supabase.co') || event.request.url.includes('nominatim.openstreetmap.org')) {
    return;
  }

  // Chiến lược: Network-first, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Nếu response hợp lệ, lưu vào cache và trả về
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Nếu offline, lấy từ cache
        return caches.match(event.request).then(response => {
          if (response) return response;
          // Nếu không có trong cache, trả về trang chủ nếu là điều hướng HTML
          if (event.request.headers.get('accept').includes('text/html')) {
            return caches.match('./index.html');
          }
        });
      })
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
