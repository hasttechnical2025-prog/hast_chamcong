// ============================================================
// SERVICE WORKER — HSTC Chấm Công
// Đổi VERSION mỗi khi deploy file mới lên GitHub
// ============================================================
const VERSION = 'v2026.05.16'; //SỬA Ở ĐÂY
const CACHE   = 'hstc-cc-' + VERSION;

// File cần cache để dùng offline
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './huongdan.html',
];

// ── Cài đặt: cache file tĩnh ─────────────────────────────
self.addEventListener('install', function(e) {
  console.log('[SW] Install', VERSION);
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(PRECACHE.map(function(url) {
        return new Request(url, { cache: 'reload' });
      }));
    }).then(function() {
      return self.skipWaiting(); // Kích hoạt ngay, không chờ tab cũ đóng
    })
  );
});

// ── Activate: xóa cache cũ ───────────────────────────────
self.addEventListener('activate', function(e) {
  console.log('[SW] Activate', VERSION);
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key.startsWith('hstc-cc-') && key !== CACHE;
        }).map(function(key) {
          console.log('[SW] Delete old cache:', key);
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim(); // Kiểm soát ngay tất cả tab
    })
  );
});

// ── Fetch: Network first, fallback cache ─────────────────
self.addEventListener('fetch', function(e) {
  // Chỉ xử lý GET request
  if (e.request.method !== 'GET') return;

  var url = e.request.url;

  // Bỏ qua request đến API Google Apps Script
  if (url.includes('script.google.com') ||
      url.includes('googleapis.com') ||
      url.includes('api.telegram.org')) {
    return;
  }

  e.respondWith(
    fetch(e.request.clone(), { cache: 'no-store' })
      .then(function(response) {
        // Fetch thành công → cập nhật cache và trả về
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE).then(function(cache) {
            cache.put(e.request, clone);
          });
        }
        return response;
      })
      .catch(function() {
        // Offline → dùng cache
        return caches.match(e.request);
      })
  );
});

// ── Nhận message từ trang ─────────────────────────────────
self.addEventListener('message', function(e) {
  if (e.data === 'skipWaiting') {
    self.skipWaiting();
  }
  // Trả lời version hiện tại
  if (e.data === 'getVersion') {
    e.ports[0].postMessage(VERSION);
  }
});
