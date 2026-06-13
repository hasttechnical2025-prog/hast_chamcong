// Version & Service Worker Registration

export let APP_VERSION = '';

export function initPWA() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('./sw.js')
        .then(function(reg) {
          if (reg.waiting) reg.waiting.postMessage('skipWaiting');
          reg.addEventListener('updatefound', function() {
            const sw = reg.installing;
            sw.addEventListener('statechange', function() {
              if (sw.state === 'installed' && navigator.serviceWorker.controller) {
                sw.postMessage('skipWaiting');
              }
            });
          });
        }).catch(function(e) {
          console.log('[SW]', e);
        });

      // Lắng nghe sự kiện cài app bên ngoài .catch()
      window.addEventListener('beforeinstallprompt', function(e) {
        e.preventDefault();
        window._installPrompt = e;
        const btn = document.getElementById('btn-install');
        if (btn) btn.style.display = 'flex';
      });

      window.addEventListener('appinstalled', function() {
        window._installPrompt = null;
        const btn = document.getElementById('btn-install');
        if (btn) btn.style.display = 'none';
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', function() {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    });
  }

  checkVersion();
}

// Kiểm tra version mới nhất từ sw.js để xoá cache nếu cần
function checkVersion() {
  const base = window.location.href
    .split('?')[0].split('#')[0]
    .replace(/\/nv\/[^\/]+\.html$/, '')   // tệp cá nhân kiểu cũ /nv/<ten>.html
    .replace(/\/nv\/[^\/]+\/?$/, '')      // tệp cá nhân /nv/<token>/ (thư mục) -> về gốc site
    .replace(/\/[^\/]+\.html$/, '')
    .replace(/\/$/, '');

  fetch(base + '/sw.js?t=' + Date.now(), { cache: 'no-store' })
    .then(r => r.text())
    .then(text => {
      const m = text.match(/const VERSION\s*=\s*['"]([^'"]+)['"]/);
      if (!m) return;
      const sv = m[1].trim();

      APP_VERSION = sv;
      const el = document.getElementById('app-ver');
      if (el) el.textContent = sv;

      const lv = localStorage.getItem('hstc_ver');
      localStorage.setItem('hstc_ver', sv);

      if (lv && lv !== sv) {
        console.log('[Ver] Update:', lv, '→', sv);
        if ('caches' in window) {
          caches.keys().then(ks => {
            Promise.all(ks.map(k => caches.delete(k)))
              .then(() => window.location.reload(true));
          });
        } else {
          window.location.reload(true);
        }
      }
    })
    .catch(() => {
      // Offline: dùng version đã lưu trong localStorage
      const cached = localStorage.getItem('hstc_ver');
      if (cached) {
        APP_VERSION = cached;
        const el = document.getElementById('app-ver');
        if (el) el.textContent = cached;
      }
    });
}