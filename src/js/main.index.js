// Main Entry Point for CBNV (index.html)
import { initPWA } from './pwa.js';
import { initClock } from './clock.js';
import { getGPS, closeGPSPrompt, acceptGPSPrompt, setLoc } from './gps.js';
import { send, confirmOverwrite, cancelOverwrite, resetForm, checkTodayHoliday } from './attendance.js';
import { showHistory, showMain, changeMonth } from './history.js';
import { openGuide, closeGuide, showPage } from './guide.js';
import { submitGiaiTrinh, initJustificationEvents } from './justification.js';
import { state, setEmployeeName, getEmployeeName } from './state.js';
import { GPS_EXPIRE_MS } from './config.js';
import { verifyQRToken } from './api.js';
import { setSupabaseToken } from './supabaseClient.js';

async function initEmail() {
  const params = new URLSearchParams(window.location.search);
  let nameFromUrl = params.get('name') || '';
  nameFromUrl = decodeURIComponent(nameFromUrl).trim();

  let tokenFromUrl = params.get('t') || window.employeeToken || '';

  // 1. Quét QR có chứa token định danh (VD: ?t=uuid)
  if (tokenFromUrl) {
    try {
      const res = await verifyQRToken(tokenFromUrl);
      if (res.access_token && res.employee_name) {
        setSupabaseToken(res.access_token);
        localStorage.setItem('hstc_token', tokenFromUrl);
        localStorage.setItem('chamcong_name', res.employee_name);
        sessionStorage.setItem('chamcong_name', res.employee_name);
        setEmployeeName(res.employee_name);

        document.getElementById('name-display').textContent = res.employee_name;
        const nameHint = document.getElementById('name-hint');
        if (nameHint) nameHint.textContent = '';

        // Xoá token khỏi URL để tránh copy link gửi cho người khác
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (e) {
      setEmployeeName('');
      document.getElementById('name-display').textContent = '⚠️ Token không hợp lệ';
      const nameHint = document.getElementById('name-hint');
      if (nameHint) nameHint.textContent = e.message || 'Mã QR đã hết hạn hoặc không tồn tại.';
      document.getElementById('name-display').style.color = '#c5221f';
      const btnGps = document.getElementById('btn-gps');
      if (btnGps) btnGps.disabled = true;
      return;
    }
  }
  // 2. Fallback cho chế độ test (chỉ khi có param ?name=test)
  else if (nameFromUrl === 'test') {
    localStorage.setItem('chamcong_name', nameFromUrl);
    setEmployeeName(nameFromUrl);
    document.getElementById('name-display').textContent = nameFromUrl;
  }
  // 3. Khôi phục từ phiên làm việc trước (từ localStorage)
  else {
    const savedToken = localStorage.getItem('hstc_token');
    const savedJwt = localStorage.getItem('hstc_jwt');
    const savedName = localStorage.getItem('chamcong_name');

    if (savedToken && savedName) {
      // Nếu đã có token và JWT, chỉ cần load lại tên
      setEmployeeName(savedName);
      document.getElementById('name-display').textContent = savedName;
      const nameHint = document.getElementById('name-hint');
      if (nameHint) nameHint.textContent = '';

      // Có thể JWT đã hết hạn sau 30 ngày, tự động refresh âm thầm
      verifyQRToken(savedToken).then(res => {
        if (res.access_token) {
          setSupabaseToken(res.access_token);
        }
      }).catch(e => {
        console.warn('Không thể refresh JWT:', e);
      });

    } else {
      // Chưa từng quét QR -> Khóa chức năng
      setEmployeeName('');
      document.getElementById('name-display').textContent = '⚠️ Link không hợp lệ';
      const nameHint = document.getElementById('name-hint');
      if (nameHint) nameHint.textContent = 'Vui lòng quét mã QR định danh cá nhân của bạn để sử dụng app.';
      document.getElementById('name-display').style.color = '#c5221f';
      const btnGps = document.getElementById('btn-gps');
      if (btnGps) btnGps.disabled = true;
    }
  }

  // Chạy GPS nếu đã xác định được nhân viên
  const currentName = getEmployeeName();
  if (currentName) {
    checkTodayHoliday().then(() => {
      if (!state.isHolidayToday) {
        getGPS();
      }
    });
  }
}

// Gán các hàm cần cho HTML nếu có liên quan
window.closePopup = function() {
  const overlay = document.getElementById('popup-overlay');
  if (overlay) overlay.classList.remove('show');
};

window.resetForm = resetForm; // Cần thiết để các popup kết quả gọi lại

document.addEventListener('DOMContentLoaded', () => {
  // 1. Init PWA và Clock
  initPWA();
  initClock();

  // 2. Load và xác thực tên nhân viên qua Token
  initEmail();

  // 4. Gán sự kiện cho các nút bấm (Loại bỏ hoàn toàn onclick inline)
  const btnGps = document.getElementById('btn-gps');
  if (btnGps) btnGps.addEventListener('click', getGPS);

  const btnSend = document.getElementById('btn-send');
  if (btnSend) btnSend.addEventListener('click', send);

  const btnHistoryMain = document.getElementById('btn-history-main');
  if (btnHistoryMain) btnHistoryMain.addEventListener('click', () => showHistory('main'));

  const btnHistoryDone = document.getElementById('btn-history-done');
  if (btnHistoryDone) btnHistoryDone.addEventListener('click', () => showHistory('done'));

  const btnPrevMonth = document.getElementById('btn-prev-month');
  if (btnPrevMonth) btnPrevMonth.addEventListener('click', () => changeMonth(-1));

  const btnNextMonth = document.getElementById('btn-next-month');
  if (btnNextMonth) btnNextMonth.addEventListener('click', () => changeMonth(1));

  const btnCloseHist = document.getElementById('btn-close-hist');
  if (btnCloseHist) btnCloseHist.addEventListener('click', showMain);

  const btnClosePopup = document.getElementById('btn-close-popup');
  if (btnClosePopup) btnClosePopup.addEventListener('click', window.closePopup);

  const btnCloseConfirm = document.getElementById('btn-close-confirm');
  if (btnCloseConfirm) btnCloseConfirm.addEventListener('click', cancelOverwrite);

  const btnConfirmOk = document.getElementById('btn-confirm-ok');
  if (btnConfirmOk) btnConfirmOk.addEventListener('click', confirmOverwrite);

  const btnCloseGuide = document.getElementById('btn-close-guide');
  if (btnCloseGuide) btnCloseGuide.addEventListener('click', closeGuide);

  const btnPromptCancel = document.querySelector('.btn-prompt-cancel');
  if (btnPromptCancel) btnPromptCancel.addEventListener('click', closeGPSPrompt);

  const btnPromptContinue = document.querySelector('.btn-prompt-continue');
  if (btnPromptContinue) btnPromptContinue.addEventListener('click', acceptGPSPrompt);

  const btnGtSubmit = document.getElementById('btn-gt-submit');
  if (btnGtSubmit) btnGtSubmit.addEventListener('click', submitGiaiTrinh);

  const btnGtCancel = document.querySelector('.btn-gt-cancel');
  if (btnGtCancel) btnGtCancel.addEventListener('click', closeGiaiTrinh);

  const btnInstall = document.getElementById('btn-install');
  if (btnInstall) {
    btnInstall.addEventListener('click', () => {
      const promptEvent = window._installPrompt;
      if (!promptEvent) return;
      promptEvent.prompt();
      promptEvent.userChoice.then(choiceResult => {
        if (choiceResult.outcome === 'accepted') {
          console.log('User accepted the install prompt');
        }
        window._installPrompt = null;
        btnInstall.style.display = 'none';
      });
    });
  }

  // Bind các tab trong hướng dẫn sử dụng
  const guideLink = document.querySelector('a[title="Hướng dẫn sử dụng"]');
  if (guideLink) {
    guideLink.addEventListener('click', (e) => {
      e.preventDefault();
      openGuide(e);
    });
  }

  const tab1 = document.getElementById('tab1');
  if (tab1) tab1.addEventListener('click', () => showPage('p1', tab1));
  const tab2 = document.getElementById('tab2');
  if (tab2) tab2.addEventListener('click', () => showPage('p2', tab2));
  const tab3 = document.getElementById('tab3');
  if (tab3) tab3.addEventListener('click', () => showPage('p3', tab3));
  const tab4 = document.getElementById('tab4');
  if (tab4) tab4.addEventListener('click', () => showPage('p4', tab4));

  // Giao diện hướng dẫn cũng có các tab inline
  const guideOverlay = document.getElementById('guide-overlay');
  if (guideOverlay) {
    const navTabs = guideOverlay.querySelectorAll('.nav-tab');
    if (navTabs.length >= 4) {
      navTabs[0].addEventListener('click', function() { showPage('p1', this); });
      navTabs[1].addEventListener('click', function() { showPage('p2', this); });
      navTabs[2].addEventListener('click', function() { showPage('p3', this); });
      navTabs[3].addEventListener('click', function() { showPage('p4', this); });
    }
  }

  // Init event delegation cho các ô Giải Trình trong bảng lịch sử
  initJustificationEvents();

  // Đè setLoc gốc để hiển thị nút Lịch sử ở màn hình chính khi GPS trả kết quả
  const origSetLoc = setLoc;
  window.setLoc = function(type, icon, title, lines) {
    origSetLoc(type, icon, title, lines);
    const btn = document.getElementById('btn-history-main');
    if (btn) btn.style.display = (type === 'ok' || type === 'warn') ? 'flex' : 'none';
  };
});

// Khi người dùng quay lại app (từ background)
document.addEventListener('visibilitychange', () => {
  if (state.isHolidayToday) return;

  if (document.visibilityState === 'visible' && state.gpsCoords) {
    if (Date.now() - state.gpsTimestamp > GPS_EXPIRE_MS) {
      state.gpsCoords = null;
      state.gpsTimestamp = 0;
      const btnSend = document.getElementById('btn-send');
      if (btnSend) btnSend.style.display = 'none';
      setLoc('warn', '⏱️', 'Vị trí cần cập nhật', [
        'Đang xác định lại vị trí...'
      ]);
      const currentName = getEmployeeName();
      if (currentName) getGPS();
    }
  }
});
