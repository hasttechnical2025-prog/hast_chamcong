// History Module (Lịch sử chấm công)
import { supabaseClient } from './supabaseClient.js';
import { state, getEmployeeName } from './state.js';
import { showPopup } from './gps.js';

export function showHistory(from) {
  const name = getEmployeeName();
  if (!name) { showPopup('Vui lòng xác nhận họ tên trước.'); return; }

  state.historyCalledFrom = from || 'done';

  const now = new Date();
  if (!state.histMonth) {
    state.histMonth = now.getMonth() + 1;
    state.histYear = now.getFullYear();
  }

  const doneEl = document.getElementById('done');
  const mainEl = document.getElementById('main');
  const histEl = document.getElementById('history');

  if (doneEl) doneEl.classList.remove('show');
  if (mainEl) mainEl.classList.add('hide');
  if (histEl) histEl.style.display = 'block';

  document.body.classList.add('viewing-history');
  window.scrollTo(0, 0);

  loadHistory(name);
}

export function showMain() {
  const histEl = document.getElementById('history');
  if (histEl) histEl.style.display = 'none';

  document.body.classList.remove('viewing-history');

  const mainEl = document.getElementById('main');
  const doneEl = document.getElementById('done');

  if (state.historyCalledFrom === 'main') {
    if (mainEl) mainEl.classList.remove('hide');
    if (doneEl) doneEl.classList.remove('show');
  } else {
    if (doneEl) doneEl.classList.add('show');
    if (mainEl) mainEl.classList.add('hide');
  }
}

export function changeMonth(delta) {
  const now = new Date();
  const curIdx = now.getFullYear() * 12 + (now.getMonth() + 1);
  let newM = state.histMonth + delta;
  let newY = state.histYear;

  if (newM > 12) { newM = 1; newY++; }
  if (newM < 1) { newM = 12; newY--; }
  if (newY * 12 + newM > curIdx) return;

  state.histMonth = newM;
  state.histYear = newY;
  window.scrollTo(0, 0);
  loadHistory(getEmployeeName());
}

export function updateMonthNavState() {
  const now = new Date();
  const curIdx = now.getFullYear() * 12 + (now.getMonth() + 1);
  const viewIdx = state.histYear * 12 + state.histMonth;
  const nextBtn = document.getElementById('btn-next-month');
  if (nextBtn) nextBtn.disabled = viewIdx >= curIdx;
}

export async function loadHistory(name) {
  const label = 'Tháng ' + state.histMonth + '/' + state.histYear;
  const lblEl = document.getElementById('hist-month-label');
  if (lblEl) lblEl.textContent = label;

  updateMonthNavState();

  const contentEl = document.getElementById('hist-content');
  if (contentEl) contentEl.innerHTML = '<div class="hist-loading">⏳ Đang tải dữ liệu...</div>';
  const summaryEl = document.getElementById('hist-summary');
  if (summaryEl) summaryEl.innerHTML = '';

  const padStr = n => n < 10 ? '0' + n : '' + n;
  const startDate = `${state.histYear}-${padStr(state.histMonth)}-01`;
  const endDate = `${state.histYear}-${padStr(state.histMonth)}-${padStr(new Date(state.histYear, state.histMonth, 0).getDate())}`;

  try {
    const { data: hld, error: hldErr } = await supabaseClient
      .from('chamcong_holidays')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDate);

    if (hldErr) throw hldErr;

    const holidaysMap = {};
    if (hld) {
      hld.forEach(h => {
        const parts = h.date.split('-');
        const dateStr = `${parts[2]}/${parts[1]}/${parts[0]}`;
        holidaysMap[dateStr] = h.description;
      });
    }

    const { data: rows, error: rowsErr } = await supabaseClient
      .from('chamcong_attendance_records')
      .select('*')
      .eq('employee_name', name)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });

    if (rowsErr) throw rowsErr;

    // Ngày vào làm: các ngày trước đó coi như "chưa vào làm" -> bỏ qua (không D, không tính)
    let ngayVaoLam = null;
    try {
      const { data: empRow } = await supabaseClient
        .from('chamcong_employees')
        .select('ngay_vao_lam')
        .eq('name', name)
        .maybeSingle();
      if (empRow && empRow.ngay_vao_lam) ngayVaoLam = empRow.ngay_vao_lam;
    } catch (e) { /* bỏ qua nếu lỗi/đọc không được */ }

    let congChuan = 0;
    const daysInMonth = new Date(state.histYear, state.histMonth, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const curD = `${state.histYear}-${padStr(state.histMonth)}-${padStr(d)}`;
      const dow = new Date(state.histYear, state.histMonth - 1, d).getDay();
      if (dow !== 0 && dow !== 6 && !(ngayVaoLam && curD < ngayVaoLam)) congChuan++;
    }

    let congThucTe = 0;
    let congBD = 0;
    let khongCham = 0;

    const nowTime = new Date();
    const todayStr = `${nowTime.getFullYear()}-${padStr(nowTime.getMonth() + 1)}-${padStr(nowTime.getDate())}`;

    const recordMap = {};
    if (rows) {
      rows.forEach(r => {
        recordMap[r.date] = r;
      });
    }

    const days = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const curDateYMD = `${state.histYear}-${padStr(state.histMonth)}-${padStr(d)}`;
      const dateStr = `${padStr(d)}/${padStr(state.histMonth)}/${state.histYear}`;

      // Chưa vào làm -> bỏ qua hẳn ngày này
      if (ngayVaoLam && curDateYMD < ngayVaoLam) continue;

      const isHoliday = !!holidaysMap[dateStr];
      const dow = new Date(curDateYMD).getDay();
      const isWeekend = dow === 0 || dow === 6;
      const isTodayOrBefore = curDateYMD <= todayStr;

      let r = recordMap[curDateYMD];
      let isVirtual = false;

      if (!r && isTodayOrBefore && !isHoliday && !isWeekend) {
        r = {
          date: curDateYMD,
          morning_in: '',
          morning_out: '',
          afternoon_in: '',
          afternoon_out: '',
          grades: 'D,D,D,D',
          note: '',
          justification: '',
          approve_status: ''
        };
        isVirtual = true;
      }

      if (r) {
        const ga = (r.grades || 'D,D,D,D').split(',').map(g => g.trim());
        const hasAbsent = ga.every(g => g === 'D');
        const allOk = ga.every(g => g === 'A');

        if (isTodayOrBefore && !isHoliday && !isWeekend) {
          if (!isVirtual) congThucTe++;
          if (!isVirtual && !allOk) congBD++;
          if (isVirtual) khongCham++;
        }

        days.push({
          date: dateStr,
          morningIn: r.morning_in,
          morningOut: r.morning_out,
          afternoonIn: r.afternoon_in,
          afternoonOut: r.afternoon_out,
          grades: r.grades,
          g1: ga[0] || 'D', g2: ga[1] || 'D', g3: ga[2] || 'D', g4: ga[3] || 'D',
          allOk: allOk,
          hasAbsent: hasAbsent,
          note: r.note || '',
          reason: r.justification || '',
          approve: r.approve_status || '',
          isHoliday: isHoliday,
          holidayLabel: holidaysMap[dateStr] || ''
        });
      }
    }

    const todayLocalStr = new Date().toLocaleDateString('vi-VN');

    renderHistory({
      month: state.histMonth,
      year: state.histYear,
      congChuan: congChuan,
      congThucTe: congThucTe,
      congBD: congBD,
      khongCham: khongCham,
      todayStr: todayLocalStr,
      holidaysMap: holidaysMap,
      days: days
    });

  } catch (e) {
    if (contentEl) {
      contentEl.innerHTML =
        `<div class="hist-loading" style="color:#c5221f;">❌ Lỗi tải dữ liệu: ${e.message}</div>`;
    }
  }
}

function fmtTime(t) {
  if (!t || t === '' || t === ':' || t === ': :' || t === '--:--') {
    return '<span style="color:#ccc;">: :</span>';
  }
  const s = t.toString().trim();
  return s.length >= 5 ? s.substring(0, 5) : s;
}

export function renderHistory(data) {
  const days = data.days || [];
  const todayStr = data.todayStr || '';
  const holidaysMap = data.holidaysMap || {};

  const labelEl = document.getElementById('hist-month-label');
  if (labelEl) labelEl.textContent = 'Tháng ' + data.month + '/' + data.year;
  updateMonthNavState();

  const daysToShow = days.filter(d => compareDateClient(d.date, todayStr) <= 0);

  const summaryEl = document.getElementById('hist-summary');
  if (summaryEl) {
    summaryEl.innerHTML =
      `<div class="hist-stat"><div class="val">${data.congChuan || 0}</div><div class="lbl">Công chuẩn</div></div>` +
      `<div class="hist-stat"><div class="val" style="color:#137333;">${data.congThucTe || 0}</div><div class="lbl">Công thực</div></div>` +
      `<div class="hist-stat"><div class="val" style="color:#b45309;">${data.congBD || 0}</div><div class="lbl">Công B,D</div></div>` +
      `<div class="hist-stat"><div class="val" style="color:#c5221f;">${data.khongCham || 0}</div><div class="lbl">Không chấm</div></div>`;
  }

  const contentEl = document.getElementById('hist-content');
  if (!contentEl) return;

  if (daysToShow.length === 0) {
    contentEl.innerHTML = '<div class="hist-loading">Chưa có dữ liệu.</div>';
    return;
  }

  const DOW_LABEL = ['CN', '2', '3', '4', '5', '6', '7'];

  function getDayOfWeek(dateStr) {
    const p = dateStr.split('/');
    return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0])).getDay();
  }

  function gradeSpan(g) {
    const cls = g === 'A' ? 'grade-a' : g === 'B' ? 'grade-b' : 'grade-d';
    return `<span class="${cls}">${g}</span>`;
  }

  let tableHtml = '<table class="hist-table"><thead><tr>'
    + '<th>Ngày</th><th>Thứ</th>'
    + '<th>Sáng IN</th><th>Sáng OUT</th>'
    + '<th>Chiều IN</th><th>Chiều OUT</th>'
    + '<th>Đánh giá</th><th>Lý do</th>'
    + '<th>Duyệt</th>'
    + '</tr></thead><tbody>';

  daysToShow.forEach(d => {
    const dow = getDayOfWeek(d.date);
    const isWeekend = dow === 0 || dow === 6;

    let isHoliday = !!holidaysMap[d.date] || d.isHoliday === true;
    let holidayLabel = holidaysMap[d.date] || d.holidayLabel || '';

    if (!isHoliday && d.hasAbsent) {
      const reasonLower = (d.reason || '').toLowerCase().replace(/\|+/g, '').trim();
      if (reasonLower.indexOf('nghỉ lễ') !== -1 || reasonLower.indexOf('nghỉ tết') !== -1) {
        isHoliday = true;
        holidayLabel = (d.reason || '').replace(/\|+/g, '').trim() || 'Nghỉ lễ';
      }
    }

    const reasonRaw = (d.reason || '').trim();
    const reasonClean = reasonRaw.replace(/\|+$/, '').trim();
    let reasonDisplay = (!reasonClean || /^\|+$/.test(reasonClean)) ? '' : reasonClean;

    if (isHoliday && !reasonDisplay) reasonDisplay = holidayLabel;

    const rowClass = isHoliday ? 'holiday'
      : isWeekend ? 'weekend'
        : d.hasAbsent ? 'absent'
          : d.allOk ? 'all-ok'
            : 'partial';

    const noReasonClass = reasonDisplay === '' ? ' no-reason' : '';
    const dowStyle = isWeekend || isHoliday ? 'font-weight:700;' : 'color:#888;';
    const dowLabel = dow === 0 ? 'CN' : 'T' + DOW_LABEL[dow];

    tableHtml += `<tr class="${rowClass}${noReasonClass}">`
      + `<td>${d.date}</td>`
      + `<td style="${dowStyle}">${dowLabel}</td>`
      + `<td>${fmtTime(d.morningIn)}</td>`
      + `<td>${fmtTime(d.morningOut)}</td>`
      + `<td>${fmtTime(d.afternoonIn)}</td>`
      + `<td>${fmtTime(d.afternoonOut)}</td>`
      + `<td style="white-space:nowrap;">`
      + (isWeekend || isHoliday ? '' :
        gradeSpan(d.g1) + ' ' + gradeSpan(d.g2) + ' ' + gradeSpan(d.g3) + ' ' + gradeSpan(d.g4))
      + '</td>'
      + (isWeekend || isHoliday
        ? `<td>${reasonDisplay}</td><td></td>`
        : (d.allOk && !reasonDisplay
          ? '<td></td><td></td>'
          : `<td class="gt-cell" data-gt="${d.date}">`
          + (reasonDisplay
            ? `<span class="gt-text">${reasonDisplay}</span>`
            : `<span class="gt-hint">+ Giải trình</span>`)
          + `</td>`
          + `<td>${!reasonDisplay ? '' : (
            d.approve === 'Đồng ý' ? '<span class="badge-approve badge-dongY">✅ Đồng ý</span>'
              : d.approve === 'Từ chối' ? '<span class="badge-approve badge-tuChoi">❌ Từ chối</span>'
                : '<span class="badge-approve badge-choDuyet">⏳ Chờ</span>'
          )}</td>`
        ))
      + '</tr>';
  });

  tableHtml += '</tbody></table>';
  contentEl.innerHTML = tableHtml;
}

export function compareDateClient(a, b) {
  const n = s => {
    const p = s.split('/');
    return parseInt(p[2]) * 10000 + parseInt(p[1]) * 100 + parseInt(p[0]);
  };
  const na = n(a), nb = n(b);
  return na < nb ? -1 : na > nb ? 1 : 0;
}
