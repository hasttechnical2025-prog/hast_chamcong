// Attendance Module (Chấm công)
import { supabaseClient } from './supabaseClient.js';
import { GPS_EXPIRE_MS } from './config.js';
import { state, getEmployeeName } from './state.js';
import { checkOffice, getGPS, setLoc, showPopup } from './gps.js';
import { logAttendance } from './api.js';

// Đọc 2 cờ cấu hình TRỰC TIẾP từ chamcong_system_config lúc chạy -> đổi checkbox ở
// trang quản trị có hiệu lực NGAY trên app CBNV mà không cần deploy lại.
export async function loadSystemFlags() {
  try {
    const { data } = await supabaseClient
      .from('chamcong_system_config')
      .select('key, value')
      .in('key', ['allow_holiday', 'allow_multiple']);
    if (data) {
      data.forEach(r => {
        if (r.key === 'allow_holiday')  state.allowHoliday  = (r.value === 'true');
        if (r.key === 'allow_multiple') state.allowMultiple = (r.value === 'true');
      });
    }
  } catch (e) { /* lỗi mạng -> giữ mặc định trong state */ }
}

export function send() {
  if (!state.gpsCoords) {
    showPopup('Chưa có GPS. Vui lòng xác định vị trí trước.');
    return;
  }
  if (Date.now() - state.gpsTimestamp > GPS_EXPIRE_MS) {
    state.gpsCoords = null;
    state.gpsTimestamp = 0;
    const btnSend = document.getElementById('btn-send');
    if (btnSend) btnSend.style.display = 'none';
    setLoc('warn', '⏱️', 'Vị trí đã hết hạn', [
      'GPS lấy quá 3 phút trước.',
      'Đang tự động xác định lại...'
    ]);
    getGPS();
    return;
  }
  checkAttendanceBeforeSend();
}

export async function checkAttendanceBeforeSend() {
  const name = getEmployeeName();
  if (!name || state.allowMultiple) {
    doSend(state.gpsCoords.latitude, state.gpsCoords.longitude, state.gpsCoords.accuracy);
    return;
  }

  const today = new Date();
  const todayStr = today.toLocaleDateString('vi-VN').split('/').reverse().join('-');

  try {
    const { data: record, error } = await supabaseClient
      .from('chamcong_attendance_records')
      .select('*')
      .eq('employee_name', name)
      .eq('date', todayStr)
      .single();

    if (error || !record) {
      doSend(state.gpsCoords.latitude, state.gpsCoords.longitude, state.gpsCoords.accuracy);
      return;
    }

    const hhmm = today.getHours() * 100 + today.getMinutes();
    let existingTime = '';
    let sessionLabel = '';

    if (hhmm <= 900) {
      if (record.morning_in) { existingTime = record.morning_in; sessionLabel = 'checkin sáng'; }
    } else if (hhmm <= 1245) {
      if (record.morning_out) { existingTime = record.morning_out; sessionLabel = 'checkout sáng'; }
    } else if (hhmm <= 1500) {
      if (record.afternoon_in) { existingTime = record.afternoon_in; sessionLabel = 'checkin chiều'; }
    } else {
      if (record.afternoon_out) { existingTime = record.afternoon_out; sessionLabel = 'checkout chiều'; }
    }

    if (existingTime) {
      const hhmmStr = String(existingTime).substring(0, 5); // hh:mm
      document.getElementById('warn-msg').innerHTML =
        `Bạn đã <b>${sessionLabel}</b> vào lúc <b>${hhmmStr}</b>.`;
      document.getElementById('warn-detail').innerHTML = `Có tiếp tục chấm công?`;
      document.getElementById('checkin-warn-overlay').classList.add('show');
    } else {
      doSend(state.gpsCoords.latitude, state.gpsCoords.longitude, state.gpsCoords.accuracy);
    }
  } catch (e) {
    console.log('Lỗi kiểm tra chấm trùng:', e);
    doSend(state.gpsCoords.latitude, state.gpsCoords.longitude, state.gpsCoords.accuracy);
  }
}

export function confirmOverwrite() {
  document.getElementById('checkin-warn-overlay').classList.remove('show');
  if (state.gpsCoords) {
    doSend(state.gpsCoords.latitude, state.gpsCoords.longitude, state.gpsCoords.accuracy);
  }
}

export function cancelOverwrite() {
  document.getElementById('checkin-warn-overlay').classList.remove('show');
}

export async function doSend(lat, lng, accuracy) {
  const email = getEmployeeName();
  const btnSend = document.getElementById('btn-send');
  const btnGps = document.getElementById('btn-gps');

  if (btnSend) {
    btnSend.disabled = true;
    btnSend.innerHTML = '<span class="spin"></span> Đang xử lý...';
  }
  if (btnGps) btnGps.disabled = true;

  const { office, dist: minDist, inside: isAllowed } = checkOffice(lat, lng);

  try {
    let addressStr = 'Không xác định';
    try {
      const geoUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=vi`;
      const geoRes = await fetch(geoUrl, {
        headers: { 'User-Agent': 'HAST_Attendance_App' }
      });
      if (geoRes.ok) {
        const geoText = await geoRes.text();
        const geoData = JSON.parse(geoText);
        addressStr = geoData.display_name || 'Không xác định';
      }
    } catch (e) {
      console.log('Lỗi reverse geocode:', e);
    }

    const res = await logAttendance({
      latitude: lat,
      longitude: lng,
      accuracy: Math.round(accuracy),
      nearest_office: office ? office.name : 'Không xác định',
      distance: Math.round(minDist),
      status: isAllowed ? '✓ Hợp lệ' : '✗ Ngoài phạm vi',
      address: addressStr,
      note: document.getElementById('note').value.trim()
    });

    if (res.error) throw new Error(res.error);

    if (btnSend) {
      btnSend.disabled = false;
      btnSend.innerHTML = '✅ Chấm công';
    }
    if (btnGps) btnGps.disabled = false;

    const now = new Date();
    const timeStr = now.toLocaleDateString('vi-VN') + ' ' + now.toLocaleTimeString('vi-VN');

    showDone({
      success: true,
      time: timeStr,
      location: office ? office.name : 'Không xác định',
      distance: minDist < 99999 ? Math.round(minDist) : null,
      isAllowed: isAllowed,
      address: addressStr
    }, email);

  } catch (e) {
    if (btnSend) {
      btnSend.disabled = false;
      btnSend.innerHTML = '✅ Chấm công';
    }
    if (btnGps) btnGps.disabled = false;
    showPopup('Lỗi kết nối: ' + e.message, 'Có lỗi xảy ra');
  }
}

export function showDone(r, email) {
  document.getElementById('main').classList.add('hide');
  document.getElementById('done').classList.add('show');
  if (r.success) {
    document.getElementById('r-emoji').textContent = r.isAllowed ? '✅' : '⚠️';
    document.getElementById('r-title').textContent = 'Hoàn thành chấm công';
    document.getElementById('r-rows').innerHTML = `
      <div class="row"><span class="l">🕐 Thời gian</span><span class="v">${r.time}</span></div>
      <div class="row"><span class="l">👤 Họ tên</span><span class="v">${email}</span></div>
      <div class="row"><span class="l">📍 Checkin</span><span class="v">${r.location}</span></div>
      ${r.distance != null ? `<div class="row"><span class="l">📏 Khoảng cách</span><span class="v">${r.distance} m</span></div>` : ''}
      ${r.address ? `<div class="row" style="flex-direction:column;align-items:flex-start;gap:2px;"><span class="l">🗺 Vị trí chấm công</span><span class="v" style="text-align:left;">${r.address}</span></div>` : ''}
      <div class="row"><span class="l">✔ Trạng thái</span>
        <span class="v">${r.isAllowed ? '✅ Hợp lệ' : '⚠️ Ngoài phạm vi'}</span></div>`;
  } else {
    document.getElementById('r-emoji').textContent = '❌';
    document.getElementById('r-title').textContent = 'Có lỗi xảy ra';
    document.getElementById('r-rows').innerHTML =
      `<div class="row"><span class="v" style="color:#c5221f">${r.error}</span></div>`;
  }
}

export function resetForm() {
  state.gpsCoords = null;
  state.gpsTimestamp = 0;
  document.getElementById('done').classList.remove('show');
  document.getElementById('main').classList.remove('hide');
  document.getElementById('history').style.display = 'none';

  const noteEl = document.getElementById('note');
  noteEl.value = '';
  if (!state.isHolidayToday) {
    noteEl.disabled = false;
    noteEl.placeholder = "Công tác, đi muộn, lý do khác...";
    noteEl.style.backgroundColor = "white";
  }

  document.getElementById('btn-send').style.display = 'none';
  document.getElementById('btn-history-main').style.display = 'none';
  const btnGps = document.getElementById('btn-gps');
  btnGps.style.display = 'flex';
  btnGps.disabled = false;
  btnGps.innerHTML = '📡 Xác định vị trí';
  setLoc('idle', '📡', 'Đang xác định vị trí...', ['Vui lòng chờ']);
  getGPS();
}

export async function checkTodayHoliday() {
  if (state.allowHoliday) return;

  const today = new Date();
  const dow = today.getDay();
  const todayStr = today.toLocaleDateString('vi-VN').split('/').reverse().join('-');

  let isHoliday = false;
  let reason = '';

  if (dow === 0) {
    isHoliday = true;
    reason = 'Hôm nay là Chủ Nhật — ngày nghỉ theo quy định.';
  } else if (dow === 6) {
    isHoliday = true;
    reason = 'Hôm nay là Thứ 7 — ngày nghỉ theo quy định.';
  } else {
    try {
      const { data, error } = await supabaseClient
        .from('chamcong_holidays')
        .select('*')
        .eq('date', todayStr)
        .single();

      if (data) {
        isHoliday = true;
        reason = `Hôm nay là ${data.description} — ngày nghỉ lễ.`;
      }
    } catch (e) {
      console.log('Lỗi tải ngày lễ:', e);
    }
  }

  if (isHoliday) {
    state.isHolidayToday = true;

    const btnGps = document.getElementById('btn-gps');
    if (btnGps) btnGps.style.display = 'none';
    const btnSend = document.getElementById('btn-send');
    if (btnSend) btnSend.style.display = 'none';

    const noteEl = document.getElementById('note');
    if (noteEl) {
      noteEl.disabled = true;
      noteEl.placeholder = "🔒 Hôm nay là Ngày nghỉ. Hãy tận hưởng nhé!";
      noteEl.style.backgroundColor = "#f1f3f4";
    }

    setLoc('idle', '🌴', 'Hôm nay là Ngày Nghỉ', [reason]);

    const btnHistMain = document.getElementById('btn-history-main');
    if (btnHistMain) btnHistMain.style.display = 'flex';
  }
}
