// GPS Module
import { OFFICES, MAX_DISTANCE } from './config.js';
import { state, getEmployeeName } from './state.js';

export function haversine(a, b, c, d) {
  const R = 6371000;
  const r = x => x * Math.PI / 180;
  const da = r(c - a);
  const db = r(d - b);
  const e = Math.sin(da / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(db / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(e), Math.sqrt(1 - e));
}

export function checkOffice(lat, lng) {
  let best = null, min = Infinity;
  OFFICES.forEach(o => {
    const d = haversine(lat, lng, o.lat, o.lng);
    if (d < min) { min = d; best = o; }
  });
  return { office: best, dist: min, inside: best && min <= best.radius };
}

export function setLoc(type, icon, title, lines) {
  const el = document.getElementById('loc');
  if (!el) return;
  el.className = 'loc ' + type;
  let spans = '';
  for (let i = 0; i < lines.length; i++) {
    spans += `<span>${lines[i]}</span>`;
  }
  el.innerHTML = `<span class="li">${icon}</span><div class="lb"><strong>${title}</strong>${spans}</div>`;
}

// Show standard custom popup
export function showPopup(msg, title = 'HAST Chấm công') {
  const tEl = document.getElementById('popup-title');
  const mEl = document.getElementById('popup-msg');
  const oEl = document.getElementById('popup-overlay');
  if (tEl) tEl.textContent = title;
  if (mEl) mEl.textContent = msg;
  if (oEl) oEl.classList.add('show');
}

export function getGPS() {
  if (state.isHolidayToday) return; // Chặn nếu là ngày nghỉ

  const email = getEmployeeName();
  if (!email) {
    showPopup('Vui lòng nhập và xác nhận họ tên trước.');
    return;
  }

  // Tự động kiểm tra quyền GPS, nếu đã cho phép thì gọi luôn
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' }).then(result => {
      if (result.state === 'granted') {
        acceptGPSPrompt(); // Đã cấp quyền -> Gọi luôn
      } else if (result.state === 'prompt') {
        document.getElementById('gps-prompt-overlay').classList.add('show');
      } else {
        acceptGPSPrompt(); // Bị từ chối -> Vẫn gọi để nó kích hoạt lỗi
      }
    }).catch(() => {
      // Dành cho Safari iOS đời cũ
      if (localStorage.getItem('gps_authorized') === '1') {
        acceptGPSPrompt();
      } else {
        document.getElementById('gps-prompt-overlay').classList.add('show');
      }
    });
  } else {
    if (localStorage.getItem('gps_authorized') === '1') {
      acceptGPSPrompt();
    } else {
      document.getElementById('gps-prompt-overlay').classList.add('show');
    }
  }
}

export function closeGPSPrompt() {
  const overlay = document.getElementById('gps-prompt-overlay');
  if (overlay) overlay.classList.remove('show');

  const btn = document.getElementById('btn-gps');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '📡 Xác định vị trí';
  }

  setLoc('idle', '📍', 'Chưa xác định vị trí', ['Bấm nút bên dưới để xác định vị trí']);
}

export function acceptGPSPrompt() {
  const overlay = document.getElementById('gps-prompt-overlay');
  if (overlay) overlay.classList.remove('show');

  const btn = document.getElementById('btn-gps');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Đang xác định vị trí...';
  }

  const btnSend = document.getElementById('btn-send');
  if (btnSend) btnSend.style.display = 'none';

  setLoc('idle', '📡', 'Đang xác định vị trí...', ['Nếu hỏi quyền → bấm Cho phép']);

  navigator.geolocation.getCurrentPosition(
    pos => {
      localStorage.setItem('gps_authorized', '1');

      state.gpsCoords = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };
      state.gpsTimestamp = Date.now();

      const lat = state.gpsCoords.latitude;
      const lng = state.gpsCoords.longitude;
      const acc = state.gpsCoords.accuracy;
      const { office, dist, inside } = checkOffice(lat, lng);

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '🔄 Xác định lại vị trí';
      }

      const overMax = MAX_DISTANCE > 0 && dist > MAX_DISTANCE;
      const distKm = (dist / 1000).toFixed(1);
      const maxKm = (MAX_DISTANCE / 1000).toFixed(1);

      if (overMax) {
        setLoc('err', '🚫', 'Không thể chấm công', [
          `📏 Bạn đang cách Công ty <b>${distKm} km</b>`,
          `⛔ Giới hạn cho phép: ${maxKm} km`,
          '👉 Vui lòng đến gần Công ty hơn để chấm công.'
        ]);
      } else if (inside) {
        setLoc('ok', '✅', `Trong phạm vi: ${office.name}`, [
          `📏 Khoảng cách: ${Math.round(dist)} m`,
          `🎯 Độ chính xác: ±${Math.round(acc)} m`
        ]);
        if (btnSend) btnSend.style.display = 'flex';
      } else {
        setLoc('warn', '⚠️', 'Ngoài phạm vi Công ty', [
          `📏 Cách ${office ? office.name : 'VP'}: ${Math.round(dist)} m`,
          `🎯 Độ chính xác: ±${Math.round(acc)} m`,
          '🙅‍♀️ Dữ liệu chấm công vẫn được ghi nhận. Lưu ý vị trí lần chấm công tiếp theo!'
        ]);
        if (btnSend) btnSend.style.display = 'flex';
      }
    },
    err => {
      state.gpsCoords = null;
      if (btn) {
        btn.style.display = 'flex';
        btn.disabled = false;
        btn.innerHTML = '🔄 Thử lại GPS';
      }
      const m = {
        1: '🔒 Cần BẬT Định vị (Location) cho trình duyệt: vào Cài đặt → Quyền riêng tư → Dịch vụ định vị → bật cho Safari/Chrome, rồi bấm Thử lại.',
        2: '📡 Không bắt được tín hiệu định vị. Hãy bật Định vị + ra chỗ thoáng, rồi Thử lại.',
        3: '⏱️ Hết thời gian chờ định vị. Kiểm tra đã bật Định vị chưa rồi Thử lại.'
      };
      setLoc('err', '❌', 'Chưa lấy được vị trí — Không thể chấm công', [
        m[err.code] || 'Lỗi định vị không xác định.',
        '⛔ Bắt buộc phải có Định vị (GPS) để chấm công.'
      ]);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}