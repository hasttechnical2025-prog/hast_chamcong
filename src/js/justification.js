// Justification Module (Giải trình)
import { showPopup } from './gps.js';
import { submitJustification } from './api.js';

let gtName = '';
let gtDate = '';

export function openGiaiTrinh(date, currentReason) {
  const reasonEl = document.getElementById('gt-reason');
  if (reasonEl) {
    reasonEl.value = (currentReason && !/^\|+$/.test(currentReason)) ? currentReason : '';
  }

  gtDate = date;

  const dateLbl = document.getElementById('gt-date-label');
  if (dateLbl) dateLbl.textContent = 'Ngày: ' + date;

  const btn = document.getElementById('btn-gt-submit');
  if (btn) {
    btn.disabled = false;
    btn.textContent = '💾 Lưu';
  }

  const overlay = document.getElementById('giaitrinh-overlay');
  if (overlay) overlay.classList.add('show');

  setTimeout(() => { if (reasonEl) reasonEl.focus(); }, 150);
}

export function closeGiaiTrinh() {
  const overlay = document.getElementById('giaitrinh-overlay');
  if (overlay) overlay.classList.remove('show');

  const reasonEl = document.getElementById('gt-reason');
  if (reasonEl) reasonEl.value = '';

  const btn = document.getElementById('btn-gt-submit');
  if (btn) {
    btn.disabled = false;
    btn.textContent = '💾 Lưu';
  }
}

export async function submitGiaiTrinh() {
  const reasonEl = document.getElementById('gt-reason');
  const reason = reasonEl ? reasonEl.value.trim() : '';

  if (!reason) {
    if (reasonEl) reasonEl.focus();
    return;
  }

  const btn = document.getElementById('btn-gt-submit');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Đang lưu...';
  }

  const parts = gtDate.split('/');
  const dateDb = `${parts[2]}-${parts[1]}-${parts[0]}`;

  try {
    const res = await submitJustification(dateDb, reason);
    if (res.error) throw new Error(res.error);

    closeGiaiTrinh();

    document.querySelectorAll('.gt-cell[data-gt="' + gtDate + '"]')
      .forEach(cell => {
        cell.innerHTML = `<span class="gt-text">${reason}</span>`;
      });

    showPopup('✅ Đã gửi giải trình lên TBP!');

  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💾 Lưu';
    }
    showPopup('❌ Lỗi lưu dữ liệu: ' + e.message);
  }
}

export function initJustificationEvents() {
  document.addEventListener('click', function(e) {
    const cell = e.target.closest ? e.target.closest('.gt-cell') : null;
    if (!cell) return;
    const date = cell.getAttribute('data-gt');
    if (!date) return;
    const textEl = cell.querySelector('.gt-text');
    openGiaiTrinh(date, textEl ? textEl.textContent.trim() : '');
  });
}
