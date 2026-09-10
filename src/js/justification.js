// Justification Module (Giải trình) — nâng cấp: Loại (Nghỉ phép/Ốm/Khác) + Buổi + Nội dung.
import { showPopup } from './gps.js';
import { submitJustification } from './api.js';

const TYPE_LABEL = { phep: 'Nghỉ phép', om: 'Nghỉ ốm', khac: 'Khác' };
const BUOI_LABEL = { ca_ngay: 'cả ngày', sang: 'buổi sáng', chieu: 'buổi chiều' };

let gtDate = '';
let gtType = 'phep';
let gtBuoi = 'ca_ngay';

// Ghép chuỗi lý do hiển thị/lưu: Nghỉ phép/Ốm -> nhãn tự sinh; Khác -> nội dung tự nhập.
function buildReason(type, buoi, content) {
  if (type === 'khac') return content;
  return TYPE_LABEL[type] + ' (' + BUOI_LABEL[buoi] + ')';
}

function setSeg(groupId, value) {
  const g = document.getElementById(groupId);
  if (!g) return;
  g.querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-v') === value);
  });
}

// Nghỉ phép/Ốm -> hiện Buổi, ẩn Nội dung. Khác -> ẩn Buổi, hiện Nội dung.
function applyLoaiUI() {
  const isKhac = (gtType === 'khac');
  const buoiWrap = document.getElementById('gt-buoi-wrap');
  if (buoiWrap) buoiWrap.hidden = isKhac;
  const ndWrap = document.getElementById('gt-nd-wrap');
  if (ndWrap) ndWrap.hidden = !isKhac;
  const err = document.getElementById('gt-err');
  if (err) err.hidden = true;
}

export function openGiaiTrinh(date, opts) {
  opts = opts || {};
  gtDate = date;
  // Tương thích ngược: nếu HTML cũ (chưa có nút Loại — vd tệp /nv chưa deploy lại),
  // ép Loại = 'khac' để submit dùng đúng nội dung ô textarea như cơ chế cũ.
  const hasNewForm = !!document.getElementById('gt-loai');
  gtType = hasNewForm ? (opts.type || 'phep') : 'khac';  // mới -> mặc định Nghỉ phép (cả ngày)
  gtBuoi = opts.buoi || 'ca_ngay';

  setSeg('gt-loai', gtType);
  setSeg('gt-buoi', gtBuoi);
  applyLoaiUI();

  const reasonEl = document.getElementById('gt-reason');
  if (reasonEl) reasonEl.value = (gtType === 'khac' && opts.content) ? opts.content : '';

  const dateLbl = document.getElementById('gt-date-label');
  if (dateLbl) dateLbl.textContent = 'Ngày: ' + date;

  const btn = document.getElementById('btn-gt-submit');
  if (btn) { btn.disabled = false; btn.textContent = '💾 Lưu'; }

  const overlay = document.getElementById('giaitrinh-overlay');
  if (overlay) overlay.classList.add('show');

  setTimeout(() => { if (gtType === 'khac' && reasonEl) reasonEl.focus(); }, 150);
}

export function closeGiaiTrinh() {
  const overlay = document.getElementById('giaitrinh-overlay');
  if (overlay) overlay.classList.remove('show');

  const reasonEl = document.getElementById('gt-reason');
  if (reasonEl) reasonEl.value = '';

  const err = document.getElementById('gt-err');
  if (err) err.hidden = true;

  const btn = document.getElementById('btn-gt-submit');
  if (btn) { btn.disabled = false; btn.textContent = '💾 Lưu'; }
}

export async function submitGiaiTrinh() {
  const reasonEl = document.getElementById('gt-reason');
  const content = reasonEl ? reasonEl.value.trim() : '';

  // Khác -> bắt buộc nhập nội dung.
  if (gtType === 'khac' && !content) {
    const err = document.getElementById('gt-err');
    if (err) err.hidden = false;
    if (reasonEl) reasonEl.focus();
    return;
  }

  const reason = buildReason(gtType, gtBuoi, content);

  const btn = document.getElementById('btn-gt-submit');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang lưu...'; }

  const parts = gtDate.split('/');
  const dateDb = `${parts[2]}-${parts[1]}-${parts[0]}`;

  try {
    const res = await submitJustification(dateDb, reason, gtType, gtBuoi);
    if (res.error) throw new Error(res.error);

    closeGiaiTrinh();

    // Cập nhật ngay ô trên bảng (sẽ đồng bộ đầy đủ khi tải lại tháng).
    document.querySelectorAll('.gt-cell[data-gt="' + gtDate + '"]').forEach(cell => {
      cell.innerHTML = `<span class="gt-text">${reason}</span>`;
    });

    showPopup('✅ Đã gửi giải trình lên TBP!');

  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Lưu'; }
    showPopup('❌ ' + e.message);
  }
}

export function initJustificationEvents() {
  // Chọn Loại (segmented) — Khác thì mở ô Nội dung.
  const loaiG = document.getElementById('gt-loai');
  if (loaiG) loaiG.addEventListener('click', function(e) {
    const b = e.target.closest('button'); if (!b) return;
    gtType = b.getAttribute('data-v');
    setSeg('gt-loai', gtType);
    applyLoaiUI();
  });

  // Chọn Buổi (segmented).
  const buoiG = document.getElementById('gt-buoi');
  if (buoiG) buoiG.addEventListener('click', function(e) {
    const b = e.target.closest('button'); if (!b) return;
    gtBuoi = b.getAttribute('data-v');
    setSeg('gt-buoi', gtBuoi);
  });

  const reasonEl = document.getElementById('gt-reason');
  if (reasonEl) reasonEl.addEventListener('input', function() {
    const err = document.getElementById('gt-err'); if (err) err.hidden = true;
  });

  // Mở form khi bấm ô giải trình. Ô đã KHOÁ (đã duyệt) thì không mở.
  document.addEventListener('click', function(e) {
    const cell = e.target.closest ? e.target.closest('.gt-cell') : null;
    if (!cell) return;
    if (cell.classList.contains('gt-locked')) return;
    const date = cell.getAttribute('data-gt');
    if (!date) return;
    openGiaiTrinh(date, {
      type: cell.getAttribute('data-type') || '',
      buoi: cell.getAttribute('data-buoi') || '',
      content: cell.getAttribute('data-content') || ''
    });
  });
}
