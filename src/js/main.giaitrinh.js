import { supabaseClient } from './supabaseClient.js';
import { SUPABASE_KEY } from './config.js';
import { loginAdmin, approveJustification, adminWrite } from './api.js';
import { setSupabaseToken } from './supabaseClient.js';


// Khởi tạo biến toàn cục
let _pw = '';
let _isAdmin = false;
let _tbpDept = '';

// State module-scope (ES module = strict mode -> bắt buộc khai báo trước khi gán)
let _allItems = [];      // Danh sách mục giải trình đang hiển thị (record thật + ảo)
let _filter = 'all';     // Bộ lọc trạng thái: all | pending | approved | rejected
let _rejectRow = null;   // rowIndex của dòng đang mở popup từ chối

window._isClientReady = false;
window.supabaseClient = supabaseClient;
window.SUPABASE_KEY = SUPABASE_KEY;

// ══════════════════════════════════════════════
// ⚙️ CẤU HÌNH SUPABASE
// ══════════════════════════════════════════════





// Hàm gửi Telegram (dùng chung) — gọi qua Edge Function /send-telegram (xem import sendTelegram)

// ══════════════════════════════════════════════
// AUTH TỪ SUPABASE
// ══════════════════════════════════════════════
async function login() {
  const pw = document.getElementById('pw-input').value.trim();
  if (!pw) return;

  const btn = document.querySelector('.login-btn');
  btn.innerHTML = '<span class="spin"></span> Đang xác thực...';
  btn.disabled  = true;

  try {
    const res = await loginAdmin(null, pw);
    if (res.error) throw new Error(res.error);

    const user = res.user;

    _pw = pw;
    _isAdmin = user.role === 'admin';
    _tbpDept = user.department;

    // Tải cấu hình in từ settings (mở bằng RLS cho mọi authenticated user)
    const { data: settings } = await supabaseClient.from('chamcong_admin_settings').select('*');
    if (settings) applyPrintCfgFromSettings(settings);

    sessionStorage.setItem('hstc_admin_pw', pw);
    sessionStorage.setItem('hstc_admin_is_admin', _isAdmin ? '1' : '0');
    sessionStorage.setItem('hstc_admin_dept', _tbpDept);

    setSupabaseToken(res.access_token);

    showMainScreen();
    loadData();
  } catch (e) {
    const err = document.getElementById('login-err');
    err.textContent = '❌ ' + e.message;
    err.style.display = 'block';
  } finally {
    btn.innerHTML = '🔐 Đăng nhập';
    btn.disabled  = false;
  }
}

function logout() {
  _pw = '';
  sessionStorage.removeItem('hstc_admin_pw');
  sessionStorage.removeItem('hstc_admin_is_admin');
  sessionStorage.removeItem('hstc_admin_dept');
  sessionStorage.removeItem('hstc_month_init'); // Xóa khởi tạo tháng
  sessionStorage.removeItem('hstc_sel_month');
  sessionStorage.removeItem('hstc_sel_year');
  _isAdmin = false;
  _tbpDept = '';
  document.getElementById('main-screen').style.display  = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('pw-input').value = '';
}

function showMainScreen() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('main-screen').style.display  = 'flex';
}

function switchMainTab(tabId) {
  document.querySelectorAll('.htab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tabId).classList.add('active');

  if (tabId === 'gt') {
    document.getElementById('gt-container').style.display = 'flex';
    document.getElementById('nscl-container').style.display = 'none';
  } else {
    document.getElementById('gt-container').style.display = 'none';
    document.getElementById('nscl-container').style.display = 'flex';
    renderNsclTable();
  }
}

// Biến lưu trữ cho NSCL
var _allActiveEmployees = [];
var _holidaysMap = {};

// ══════════════════════════════════════════════
// TẢI DỮ LIỆU TỪ SUPABASE
// ══════════════════════════════════════════════

function onMonthChange() {
  loadData();
}

// Đổi phòng ban (dùng chung) -> render lại tab đang mở (không cần tải lại CSDL)
function onDeptChange() {
  renderTable();
  if (document.getElementById('nscl-container').style.display === 'flex') {
    renderNsclTable();
  }
}

async function loadData() {
  var container = document.getElementById('tbl-container');
  container.innerHTML = '<div class="empty">⏳ Đang tải dữ liệu từ Supabase...</div>';

  var selMonth = document.getElementById('sel-month');
  var selYear  = document.getElementById('sel-year');
  var now = new Date();
  var month = now.getMonth() + 1;
  var year  = now.getFullYear();

  // Kiểm tra đã khởi tạo tháng cho phiên này chưa
  var isInitialized = sessionStorage.getItem('hstc_month_init') === '1';

  if (!isInitialized) {
    // Khi đăng nhập -> mặc định tháng hiện tại
    selMonth.value = month.toString();
    selYear.value  = year.toString();
    sessionStorage.setItem('hstc_month_init', '1');
  } else {
    // Đã khởi tạo: dropdown là nguồn chuẩn (đọc đúng tháng người dùng đang chọn)
    month = parseInt(selMonth.value, 10);
    year  = parseInt(selYear.value, 10);
  }
  // Lưu lại lựa chọn hiện tại để khôi phục khi tải lại trang (F5)
  sessionStorage.setItem('hstc_sel_month', String(month));
  sessionStorage.setItem('hstc_sel_year', String(year));

  const padStr = n => n < 10 ? '0' + n : '' + n;
  const startDate = `${year}-${padStr(month)}-01`;
  const endDate = `${year}-${padStr(month)}-${padStr(new Date(year, month, 0).getDate())}`;

  try {
    // 1. Lấy thông tin phòng ban của tất cả Employees (Thêm điều kiện status active)
    const { data: emps, error: empErr } = await supabaseClient
      .from('chamcong_employees')
      .select('name, department, status, role');

    if (empErr) throw empErr;

    const deptMap = {};
    const depts = new Set();
    const activeEmps = []; // Chỉ lấy nhân viên đang làm việc

    emps.forEach(e => {
      deptMap[e.name.toLowerCase()] = e.department;
      depts.add(e.department);

      const st = e.status ? e.status.toString().trim().toLowerCase() : '';
      const isActive = !st || st.indexOf('đang') !== -1 || st.indexOf('active') !== -1 || st.indexOf('làm việc') !== -1 || st.indexOf('lam viec') !== -1;
      if (isActive) {
        activeEmps.push(e);
      }
    });

    // Cập nhật dropdown phòng ban
    var deptSel = document.getElementById('sel-dept');
    if (deptSel) {
      deptSel.innerHTML = '';
      if (_isAdmin) {
        var allOpt = document.createElement('option');
        allOpt.value = ''; allOpt.textContent = '🏢 Tất cả phòng ban';
        deptSel.appendChild(allOpt);
      }
      depts.forEach(d => {
        var opt = document.createElement('option');
        opt.value = d; opt.textContent = '🏢 ' + d;
        deptSel.appendChild(opt);
      });
      if (_tbpDept) deptSel.value = _tbpDept;

      deptSel.disabled = !_isAdmin;
      deptSel.style.opacity = _isAdmin ? '1' : '0.7';
    }

    // 2. Lấy dữ liệu ngày lễ trong tháng
    const { data: hld, error: hldErr } = await supabaseClient
      .from('chamcong_holidays')
      .select('date')
      .gte('date', startDate)
      .lte('date', endDate);

    if (hldErr) throw hldErr;

    const holidaySet = new Set();
    if (hld) {
      hld.forEach(h => holidaySet.add(h.date));
    }

    // 3. Lấy dữ liệu chấm công tổng hợp trong tháng hiện tại
    const { data: records, error: recErr } = await supabaseClient
      .from('chamcong_attendance_records')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });

    if (recErr) throw recErr;

    // Map records thật từ Supabase
    const recordMap = {};
    records.forEach(r => {
      recordMap[r.employee_name.toLowerCase() + '_' + r.date] = r;
    });

    // 4. Khởi tạo & filter giải trình theo quyền hạn (Kết hợp tạo Record Ảo)
    var items = [];

    // Xác định ngày cuối cùng cần kiểm tra
    const nowTime = new Date();
    // Nếu đang xem tháng hiện tại thì chỉ check đến ngày hôm nay, nếu tháng quá khứ thì check đến hết tháng
    const limitDay = (month === nowTime.getMonth() + 1 && year === nowTime.getFullYear())
                     ? nowTime.getDate()
                     : new Date(year, month, 0).getDate();

    for (let d = 1; d <= limitDay; d++) {
      const curDateYMD = `${year}-${padStr(month)}-${padStr(d)}`;

      // Bỏ qua ngày lễ
      if (holidaySet.has(curDateYMD)) continue;

      // Bỏ qua T7, Chủ Nhật
      const dow = new Date(curDateYMD).getDay();
      if (dow === 0 || dow === 6) continue;

      const dateStr = `${padStr(d)}/${padStr(month)}/${year}`;

      activeEmps.forEach(e => {
        const userDept = e.department || '';

        // TBP: Lọc theo phòng ban TBP quản lý
        if (!_isAdmin && _tbpDept && userDept !== _tbpDept) return;

        const key = e.name.toLowerCase() + '_' + curDateYMD;
        let r = recordMap[key];

        let isVirtual = false;

        if (!r) {
          // Record ẢO: Dành cho những người hoàn toàn không chấm công ngày hôm đó
          r = {
            id: `virtual-${curDateYMD}-${e.name}`,
            employee_name: e.name,
            date: curDateYMD,
            grades: 'D, D, D, D',
            justification: '',
            approve_status: 'Chờ',
            approve_note: '',
            approve_time: null
          };
          isVirtual = true;
        }

        // Chỉ hiển thị các dòng vắng/trễ công (có B hoặc D) HOẶC có giải trình
        const ga = (r.grades || 'D,D,D,D').split(',').map(g => g.trim());
        const hasBD = ga.includes('B') || ga.includes('D');
        const hasReason = !!(r.justification && r.justification.trim());

        if (!hasBD && !hasReason) return;

        items.push({
          rowIndex: r.id, // UUID thật hoặc Chuỗi Ảo
          name: r.employee_name,
          dept: userDept,
          date: dateStr,
          grade: r.grades,
          reason: r.justification || '',
          approve: r.approve_status === 'Chờ' ? '' : r.approve_status,
          approveNote: r.approve_note || '',
          approveTime: r.approve_time ? new Date(r.approve_time).toLocaleString('vi-VN') : '',
          isVirtual: isVirtual // Đánh dấu flag
        });
      });
    }

    _allItems = items;
    _allActiveEmployees = activeEmps;
    _holidaysMap = holidaySet; // lưu lại cho NSCL
    _recordMap = recordMap; // lưu lại cho NSCL

    renderTable();
    updateStats();

    // Nếu đang ở Tab NSCL thì render lại bảng NSCL
    if (document.getElementById('nscl-container').style.display === 'flex') {
      renderNsclTable();
    }

  } catch(e) {
    container.innerHTML = `<div class="empty" style="color:#c5221f;">❌ Lỗi kết nối: ${e.message}</div>`;
  }
}

// ══════════════════════════════════════════════
// RENDER BẢNG
// ══════════════════════════════════════════════
function setFilterFromSelect() {
  _filter = document.getElementById('sel-status').value || 'all';
  renderTable();
}

function setFilter(f) {
  _filter = f;
  var sel = document.getElementById('sel-status');
  if (sel) sel.value = f;
  renderTable();
}

function getFilteredItems() {
  if (!_isAdmin) {
    return _allItems.slice();
  }
  var selDept = (document.getElementById('sel-dept') || {}).value || '';
  return _allItems.filter(function(item) {
    if (selDept && item.dept !== selDept) return false;
    return true;
  });
}

function getDisplayItems() {
  var items = getFilteredItems();
  var filtered = items.filter(function(item) {
    if (_filter === 'pending')  return !item.approve;
    if (_filter === 'approved') return item.approve === 'Đồng ý';
    if (_filter === 'rejected') return item.approve === 'Từ chối';
    return true;
  });
  // Sắp xếp theo Tên (Họ tên) tiếng Việt để nhóm nhân viên lại với nhau
  filtered.sort(function(a, b) {
    return a.name.localeCompare(b.name, 'vi');
  });
  return filtered;
}

function renderTable() {
  var items = getDisplayItems();

  // Reset highlight tổng hợp batch bar luôn (trước khi có thể bị return sớm)
  var bcTitle = document.getElementById('batch-count-title');
  var bcSub   = document.getElementById('batch-count-sub');
  if (bcTitle) {
    var pending  = items.filter(function(i){ return !i.approve; }).length;
    var approved = items.filter(function(i){ return i.approve === 'Đồng ý'; }).length;
    var rejected = items.filter(function(i){ return i.approve === 'Từ chối'; }).length;
    bcTitle.textContent = items.length + ' mục hiển thị';
    bcSub.textContent   = '⏳ ' + pending + '  ✅ ' + approved + '  ❌ ' + rejected;
  }
  updateStats(); // Reset số liệu của block stats luôn

  if (items.length === 0) {
    document.getElementById('tbl-container').innerHTML =
      '<div class="empty">📭 Không có giải trình nào' +
      (_filter !== 'all' ? ' trong bộ lọc này' : ' trong tháng này') + '.</div>';
    return;
  }

  var html = '<table class="tbl"><thead><tr>'
    + '<th>Họ tên</th><th>Ngày</th><th>Đánh giá</th>'
    + '<th>Lý do giải trình</th><th>Trạng thái</th>'
    + '<th>Ghi chú TBP</th><th>Thao tác</th>'
    + '</tr></thead><tbody>';

  items.forEach(function(item) {
    var gradeHtml = item.grade.split(',').map(function(g){
      g = g.trim();
      var cls = g==='A'?'grade-a':g==='B'?'grade-b':'grade-d';
      return '<span class="'+cls+'">'+g+'</span>';
    }).join(' ');

    var statusBadge = !item.approve
      ? '<span class="badge badge-pending">⏳ Chờ duyệt</span>'
      : item.approve === 'Đồng ý'
        ? '<span class="badge badge-approved">✅ Đồng ý</span>'
        : '<span class="badge badge-rejected">❌ Từ chối</span>';

    var _canApprove = hasJustification(item);
    var actionHtml = !item.approve
      ? (_canApprove
          ? `<button class="btn-approve" data-action="doApprove" data-args="'${item.rowIndex}'">✅ Đồng ý</button>`
          : `<button class="btn-approve" style="background:#c4c7c5;cursor:not-allowed;" title="Chưa có lý do giải trình" data-action="warnNoReason" data-args="">✅ Đồng ý</button>`)
        + `<button class="btn-reject"  onclick="openReject('${item.rowIndex}','${escHtml(item.name)}','${item.date}')">❌ Từ chối</button>`
      : `<button class="btn-undo" data-action="undoApprove" data-args="'${item.rowIndex}'" title="Hủy duyệt">↩ Hủy</button>`;

    html += '<tr>'
      + '<td class="name">' + escHtml(item.name) + '</td>'
      + '<td class="date">' + item.date + '</td>'
      + '<td class="grade">' + gradeHtml + '</td>'
      + '<td class="reason">' + escHtml(item.reason) + '</td>'
      + '<td>' + statusBadge + '</td>'
      + '<td style="font-size:12px;color:#666;">' + escHtml(item.approveNote || '') + '</td>'
      + '<td class="actions">' + actionHtml + '</td>'
      + '</tr>';
  });

  html += '</tbody></table>';
  document.getElementById('tbl-container').innerHTML = html;
}

function updateStats() {
  var base     = getFilteredItems();
  var pending  = base.filter(function(i){ return !i.approve; }).length;
  var approved = base.filter(function(i){ return i.approve === 'Đồng ý'; }).length;
  var rejected = base.filter(function(i){ return i.approve === 'Từ chối'; }).length;
  document.getElementById('cnt-pending').textContent  = pending;
  document.getElementById('cnt-approved').textContent = approved;
  document.getElementById('cnt-rejected').textContent = rejected;
}

// ══════════════════════════════════════════════
// DUYỆT / TỪ CHỐI QUA SUPABASE API
// ══════════════════════════════════════════════
// Có lý do giải trình thực sự hay không (bỏ qua khoảng trắng và ký tự |)
function hasJustification(item) {
  var r = (item && item.reason ? String(item.reason) : '').replace(/\|/g, '').trim();
  return r.length > 0;
}
// Cảnh báo khi bấm Đồng ý ở dòng chưa có lý do
function warnNoReason() {
  showToast('⚠️ Chưa có lý do giải trình nên không thể duyệt. CBNV cần gửi giải trình trước.', 'error');
}

function doApprove(id) {
  var item = _allItems.find(function(i){ return i.rowIndex === id; });
  if (item && !hasJustification(item)) {
    showToast('⚠️ Không thể duyệt: trường hợp này chưa có lý do giải trình.', 'error');
    return;
  }
  sendApproval(id, 'Đồng ý', '');
}

function openReject(id, name, date) {
  _rejectRow = id;
  document.getElementById('reject-sub').textContent = name + ' — ' + date;
  document.getElementById('reject-note').value = '';
  document.getElementById('reject-overlay').classList.add('show');
  setTimeout(function(){ document.getElementById('reject-note').focus(); }, 150);
}

function closeReject() {
  _rejectRow = null;
  document.getElementById('reject-overlay').classList.remove('show');
}

function confirmReject() {
  if (!_rejectRow) return;
  var note = document.getElementById('reject-note').value.trim();
  sendApproval(_rejectRow, 'Từ chối', note);
  closeReject();
}

var _undoRow = null;

function undoApprove(id) {
  _undoRow = id;
  var item = _allItems.find(function(i){ return i.rowIndex === id; });
  var sub  = item ? (item.name + ' — ' + item.date + ' — ' + item.approve) : '';
  document.getElementById('undo-sub').textContent = sub;
  var el = document.getElementById('undo-overlay');
  el.style.display = 'flex';
}

function closeUndo() {
  _undoRow = null;
  document.getElementById('undo-overlay').style.display = 'none';
}

function confirmUndo() {
  if (!_undoRow) return;
  var id = _undoRow;
  closeUndo();
  sendApproval(id, 'Chờ', ''); // Chờ -> Mở khóa duyệt
}

async function sendApproval(id, approveStatus, note) {
  try {
    var item = _allItems.find(function(i){ return i.rowIndex === id; });
    if (!item) return;
    const dbDate = item.date.split('/').reverse().join('-');

    const res = await approveJustification({
      employee_name: item.name,
      date: dbDate,
      approve_status: approveStatus,
      approve_note: note || ''
    });

    if (res.error) throw new Error(res.error);

    // Cập nhật local
    item.approve     = approveStatus === 'Chờ' ? '' : approveStatus;
    item.approveNote = note;
    item.approveTime = approveStatus === 'Chờ' ? '' : new Date().toLocaleString('vi-VN');

    renderTable();
    updateStats();

    var msg = approveStatus === 'Đồng ý'
      ? '✅ Đã đồng ý giải trình thành công'
      : approveStatus === 'Từ chối'
        ? '❌ Đã từ chối giải trình thành công'
        : '↩️ Đã hủy duyệt';

    showToast(msg, approveStatus === 'Đồng ý' ? 'success' : '');

  } catch(e) {
    showToast('❌ Lỗi kết nối: ' + e.message, 'error');
  }
}

// ══════════════════════════════════════════════
// BATCH DUYỆT HÀNG LOẠT SIÊU TỐC
// ══════════════════════════════════════════════
var _batchAction = '';
var _batchApproveList = [];

function openBatch(action) {
  var pending = getDisplayItems().filter(function(i){ return !i.approve; });
  if (pending.length === 0) {
    showToast('Không có mục nào cần duyệt', '');
    return;
  }
  _batchAction = action;
  var icon  = action === 'Đồng ý' ? '✅' : '❌';
  var color = action === 'Đồng ý' ? '#137333' : '#c5221f';
  document.getElementById('batch-title').innerHTML = icon + ' ' + action + ' toàn bộ';
  document.getElementById('batch-title').style.color = color;

  var descEl     = document.getElementById('batch-desc');
  var confirmBtn = document.getElementById('btn-confirm-batch');

  if (action === 'Đồng ý') {
    // CHỈ duyệt những dòng CÓ lý do giải trình
    var withReason = pending.filter(hasJustification);
    var noReason   = pending.filter(function(i){ return !hasJustification(i); });
    _batchApproveList = withReason;

    var html = '';
    if (withReason.length === 0) {
      html = '⚠️ Không có trường hợp nào có lý do giải trình để đồng ý.';
      confirmBtn.style.display = 'none';
    } else {
      html = 'Sẽ <b style="color:#137333;">ĐỒNG Ý ' + withReason.length + '</b> giải trình có lý do.';
      confirmBtn.style.display = '';
    }
    if (noReason.length > 0) {
      html += '<br><br>⚠️ <b style="color:#c5221f;">' + noReason.length +
        ' trường hợp chưa có lý do</b> sẽ KHÔNG được duyệt:' +
        '<div style="max-height:140px;overflow:auto;margin-top:6px;border:1px solid #eee;' +
        'border-radius:8px;padding:6px 8px;font-size:12px;color:#666;text-align:left;">' +
        noReason.map(function(i){ return '• ' + escHtml(i.name) + ' — ' + i.date; }).join('<br>') +
        '</div>';
    }
    descEl.innerHTML = html;
  } else {
    // Từ chối toàn bộ: áp dụng cho tất cả mục đang chờ (như cũ)
    _batchApproveList = pending;
    confirmBtn.style.display = '';
    descEl.textContent = 'Sẽ từ chối ' + pending.length + ' giải trình đang hiển thị (chưa duyệt).';
  }

  document.getElementById('progress-wrap').style.display  = 'none';
  document.getElementById('progress-label').style.display = 'none';
  document.getElementById('batch-actions').style.display  = 'flex';
  confirmBtn.style.background = action === 'Đồng ý' ? '#34a853' : '#ea4335';
  confirmBtn.textContent = 'Xác nhận';
  document.getElementById('batch-overlay').classList.add('show');
}

function closeBatch() {
  document.getElementById('batch-overlay').classList.remove('show');
  document.getElementById('btn-confirm-batch').style.display = '';
  _batchAction = '';
  _batchApproveList = [];
}

async function confirmBatch() {
  var items    = (_batchApproveList || []).slice();
  var actLabel = _batchAction;
  if (items.length === 0) { closeBatch(); return; }

  document.getElementById('batch-actions').style.display  = 'none';
  document.getElementById('progress-wrap').style.display  = 'block';
  document.getElementById('progress-label').style.display = 'block';
  document.getElementById('progress-label').textContent   = 'Đang xử lý trên Supabase...';

  try {
    // Chạy song song N lần duyệt lên Supabase qua Promise.all.
    // Dùng /approve (approveJustification) cho cả bản ghi ảo lẫn thật: endpoint tự
    // insert-if-missing với bản ghi ảo, giữ kiểm tra phòng ban cho TBP và gửi Telegram
    // kết quả server-side (không còn vòng lặp Telegram phía client).
    const promises = items.map(item => {
      const dbDate = item.date.split('/').reverse().join('-');
      return approveJustification({
        employee_name: item.name,
        date: dbDate,
        approve_status: _batchAction,
        approve_note: ''
      });
    });

    await Promise.all(promises);

    // Lưu ý nhỏ: Khi duyệt batch thành công, do ta không lấy id mới của các bản ghi insert trả về (để tiết kiệm code),
    // Giải pháp tốt nhất là buộc trang tải lại dữ liệu mới từ Server để lấy đúng id thật cho các nút Hủy duyệt.
    document.getElementById('progress-bar').style.width = '100%';
    document.getElementById('progress-label').textContent = `✅ Đã ${actLabel.toLowerCase()} ${items.length} mục! Đang tải lại...`;

    setTimeout(function() {
      closeBatch();
      loadData(); // Gọi lại loadData để đảm bảo các record ảo vừa insert được load id thật
      showToast(`✅ Đã ${actLabel.toLowerCase()} ${items.length} mục!`, 'success');
    }, 1200);

  } catch (e) {
    document.getElementById('progress-label').textContent = '❌ Lỗi: ' + e.message;
    setTimeout(function() {
      document.getElementById('batch-actions').style.display = 'flex';
      document.getElementById('btn-confirm-batch').textContent = 'Thử lại';
    }, 1500);
  }
}

// ══════════════════════════════════════════════
// BẢNG ĐIỂM NSCL
// ══════════════════════════════════════════════
var _recordMap = {}; // Lưu map của loadData

function renderNsclTable() {
  const container = document.getElementById('tbl-nscl-container');
  const selMonth = parseInt(document.getElementById('sel-month').value, 10);
  const selYear = parseInt(document.getElementById('sel-year').value, 10);
  const padStr = n => n < 10 ? '0' + n : '' + n;

  // Cập nhật tiêu đề tháng/năm để TBP biết đang chấm điểm cho tháng nào
  const _titleEl = document.getElementById('nscl-title');
  if (_titleEl) _titleEl.textContent =
    `BẢNG CHẤM CÔNG & CHẤM ĐIỂM NSCL THÁNG ${padStr(selMonth)} NĂM ${selYear}`;

  const daysInMonth = new Date(selYear, selMonth, 0).getDate();

  // Lọc nhân viên theo phòng ban được chọn
  let empsToShow = _allActiveEmployees;
  if (!_isAdmin) {
    empsToShow = empsToShow.filter(e => e.department === _tbpDept);
  } else {
    const selDept = document.getElementById('sel-dept').value;
    if (selDept) empsToShow = empsToShow.filter(e => e.department === selDept);
  }

  // Sắp xếp: TBP lên đầu, sau đó xếp theo bảng chữ cái
  empsToShow.sort((a,b) => {
    const aRole = (a.role || '').toUpperCase();
    const bRole = (b.role || '').toUpperCase();
    if (aRole === 'TBP' && bRole !== 'TBP') return -1;
    if (aRole !== 'TBP' && bRole === 'TBP') return 1;
    return a.name.localeCompare(b.name, 'vi');
  });

  if (empsToShow.length === 0) {
    container.innerHTML = '<div class="empty">Không có CBNV phù hợp.</div>';
    return;
  }

  // Khởi tạo HTML Table (sử dụng colgroup để cố định chiều rộng cột tuyệt đối trong fixed table layout)
  let colgroupHtml = `
    <colgroup>
      <col style="width: 35px;"> <!-- Cột TT -->
      <col style="width: 140px;"> <!-- Cột Họ tên -->
  `;
  for (let d = 1; d <= daysInMonth; d++) {
    colgroupHtml += `  <col style="width: 38px;">\n`; // 31 Cột ngày
  }
  colgroupHtml += `
      <col style="width: 38px;"> <!-- Cột Điểm +/- -->
      <col style="width: 40px;"> <!-- Điểm -->
      <col style="width: 38px;"> <!-- Trực -->
      <col style="width: 38px;"> <!-- Phép -->
      <col style="width: 38px;"> <!-- CĐ -->
      <col style="width: 38px;"> <!-- Ốm -->
      <col style="width: 25px;"> <!-- B -->
      <col style="width: 25px;"> <!-- C -->
      <col style="width: 25px;"> <!-- D -->
      <col style="width: 25px;"> <!-- E -->
      <col style="width: 25px;"> <!-- Y -->
    </colgroup>
  `;

  let html = `<table class="tbl tbl-nscl">
    ${colgroupHtml}
    <thead>
      <tr>
        <th rowspan="2" class="sticky-tt">TT</th>
        <th rowspan="2" class="sticky-name">Họ tên</th>
        <th colspan="${daysInMonth}">Ngày/tháng</th>
        <th rowspan="2" style="writing-mode: vertical-rl; transform: rotate(180deg); font-size:10px;">Điểm +/-</th>
        <th colspan="10">TỔNG HỢP CÔNG ĐIỂM/THÁNG</th>
      </tr>
      <tr>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const curDateYMD = `${selYear}-${padStr(selMonth)}-${padStr(d)}`;
    const dow = new Date(curDateYMD).getDay();
    let thClass = '';
    if (_holidaysMap && _holidaysMap.has(curDateYMD)) thClass = 'le';
    else if (dow === 6) thClass = 't7';
    else if (dow === 0) thClass = 'cn';
    html += `<th class="${thClass}">${padStr(d)}</th>`;
  }

  html += `
        <th>Điểm</th>
        <th style="font-size:10px; writing-mode: vertical-rl; transform: rotate(180deg);">Trực</th>
        <th style="font-size:10px; writing-mode: vertical-rl; transform: rotate(180deg);">Phép</th>
        <th style="font-size:10px; writing-mode: vertical-rl; transform: rotate(180deg);">CĐ</th>
        <th style="font-size:10px; writing-mode: vertical-rl; transform: rotate(180deg);">Ốm</th>
        <th>B</th><th>C</th><th>D</th><th>E</th><th>Y</th>
      </tr>
    </thead>
    <tbody>`;

  let totalDiem = 0;
  let totalPhep = 0;
  let totalOm = 0;

  empsToShow.forEach((emp, index) => {
    html += `<tr>
      <td class="sticky-tt">${index + 1}</td>
      <td class="sticky-name">${emp.name}</td>`;

    let sumDiem = 0;
    let sumPhep = 0;
    let sumOm = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const curDateYMD = `${selYear}-${padStr(selMonth)}-${padStr(d)}`;
      const dow = new Date(curDateYMD).getDay();
      let tdClass = '';
      let readonly = '';
      let isHoliday = false;
      if (_holidaysMap && _holidaysMap.has(curDateYMD)) { tdClass = 'le'; readonly = 'readonly'; isHoliday = true; }
      else if (dow === 6) { tdClass = 't7'; readonly = 'readonly'; }
      else if (dow === 0) { tdClass = 'cn'; readonly = 'readonly'; }

      const r = _recordMap[emp.name.toLowerCase() + '_' + curDateYMD];
      let val = (r && r.nscl_score) ? String(r.nscl_score).trim() : '';

      // Chuẩn hóa hiển thị IN HOA cho P, Ô, N
      const up = val.toUpperCase();
      if (up === 'P') val = 'P';
      else if (up === 'Ô' || up === 'O') val = 'Ô';
      else if (up === 'N') val = 'N';

      // Ngày lễ/tết -> hiển thị N (không sửa, không tính điểm)
      if (isHoliday) val = 'N';

      // Tính toán tổng hợp
      if (val === 'P') sumPhep += 1;
      else if (up === 'P/2') sumPhep += 0.5;          // dữ liệu cũ (đã bỏ)
      else if (val === 'Ô') sumOm += 1;
      else if (val === 'N') { /* nghỉ lễ - bỏ qua */ }
      else {
        const nv = parseFloat(val);
        if (!isNaN(nv)) { sumDiem += nv; if (nv === 5) sumPhep += 0.5; } // điểm 5 = 0.5 ngày phép
      }

      const inputDisabled = readonly ? 'disabled tabindex="-1"' : '';
      const oninput = readonly ? '' : 'oninput="sanitizeDayInput(this)"';
      html += `<td class="${tdClass}"><input type="text" class="nscl-input" ${readonly} ${inputDisabled} value="${val}" data-emp="${emp.name}" data-date="${curDateYMD}" ${oninput} onblur="saveNsclScore(this)"></td>`;
    }

    // Điểm +/- (lưu trên bản ghi ngày 01, cộng thẳng vào cột Điểm tổng)
    const adjRec = _recordMap[emp.name.toLowerCase() + '_' + `${selYear}-${padStr(selMonth)}-01`];
    const adjVal = (adjRec && adjRec.nscl_adjust != null && adjRec.nscl_adjust !== '') ? String(adjRec.nscl_adjust) : '';
    const adjNum = parseFloat(adjVal);
    const rowDiem = sumDiem + (isNaN(adjNum) ? 0 : adjNum);

    totalDiem += rowDiem;
    totalPhep += sumPhep;
    totalOm   += sumOm;

    html += `
      <td class="col-pm"><input type="text" class="nscl-input pm-input" value="${adjVal}" data-emp="${emp.name}" data-month="${selYear}-${padStr(selMonth)}" oninput="sanitizeAdjustInput(this)" onblur="saveNsclAdjust(this)"></td>
      <td class="col-sum" id="sum-diem-${index}">${rowDiem || '-'}</td>
      <td>-</td>
      <td id="sum-phep-${index}">${sumPhep || '-'}</td>
      <td>-</td>
      <td id="sum-om-${index}">${sumOm || '-'}</td>
      <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
    </tr>`;
  });

  html += `
    <tr style="background:#f8f9fa; font-weight:bold;">
      <td colspan="2" class="sticky-total" style="text-align:right;">CỘNG:</td>
      <td colspan="${daysInMonth + 1}"></td>
      <td class="col-sum">${totalDiem || '-'}</td>
      <td>-</td>
      <td>${totalPhep || '-'}</td>
      <td>-</td>
      <td>${totalOm || '-'}</td>
      <td colspan="5"></td>
    </tr>
  </tbody></table>`;

  container.innerHTML = html;
}

// Tính lại Realtime sau khi nhập xong
function recalcNsclRow(empName) {
  // Lấy ra tất cả các ô input của người này, tính lại là xong
  // (Hoặc render lại cả bảng là nhanh nhất)
  renderNsclTable();
}

// ── Kiểm soát ký tự nhập ──
// Ô ngày: chỉ cho số nguyên 1..15, P (phép), Ô (ốm). Tự động IN HOA p->P, o/ô->Ô.
function sanitizeDayInput(el) {
  let v = (el.value || '').trim();
  if (v === '') { el.value = ''; return; }
  const first = v.charAt(v.length - 1) || v.charAt(0); // ưu tiên ký tự vừa gõ
  // Nếu có chữ cái -> chấp nhận P (phép), Ô (ốm) hoặc N (nghỉ)
  if (/[pP]/.test(v)) { el.value = 'P'; return; }
  if (/[oôOÔ]/.test(v)) { el.value = 'Ô'; return; }
  if (/[nN]/.test(v)) { el.value = 'N'; return; }
  // Còn lại: chỉ giữ chữ số
  let digits = v.replace(/[^0-9]/g, '');
  if (digits === '') { el.value = ''; return; }
  let n = parseInt(digits, 10);
  if (isNaN(n) || n < 1) { el.value = ''; return; }
  if (n > 15) n = 15;
  el.value = String(n);
}

// Ô Điểm +/-: chỉ số nguyên 1..15
function sanitizeAdjustInput(el) {
  let digits = (el.value || '').replace(/[^0-9]/g, '');
  if (digits === '') { el.value = ''; return; }
  let n = parseInt(digits, 10);
  if (isNaN(n) || n < 1) { el.value = ''; return; }
  if (n > 15) n = 15;
  el.value = String(n);
}

// Giá trị ngày hợp lệ: rỗng | 1..15 | P | Ô | N
function isValidDayValue(v) {
  if (v === '' || v === 'P' || v === 'Ô' || v === 'N') return true;
  return /^\d+$/.test(v) && +v >= 1 && +v <= 15;
}

// Blur -> Lưu DB
async function saveNsclScore(inputEl) {
  const empName = inputEl.getAttribute('data-emp');
  const dateYMD = inputEl.getAttribute('data-date');
  let val = inputEl.value.trim();

  // Chuẩn hóa IN HOA
  const up = val.toUpperCase();
  if (up === 'P') val = 'P';
  else if (up === 'Ô' || up === 'O') val = 'Ô';
  else if (up === 'N') val = 'N';

  const key = empName.toLowerCase() + '_' + dateYMD;
  let r = _recordMap[key];

  // Chặn giá trị không hợp lệ -> khôi phục giá trị cũ
  if (!isValidDayValue(val)) {
    inputEl.value = (r && r.nscl_score) ? r.nscl_score : '';
    showToast('⚠️ Chỉ được nhập số 1–15, P (phép) hoặc Ô (ốm).', 'error');
    return;
  }
  inputEl.value = val;

  // Nếu giá trị không đổi so với DB thì bỏ qua
  if (r && (r.nscl_score || '') === val) return;
  if (!r && val === '') return;

  try {
    if (!r) {
      const res = await adminWrite('chamcong_attendance_records', 'insert', [{
        employee_name: empName,
        date: dateYMD,
        grades: 'D, D, D, D',
        approve_status: 'Chờ',
        nscl_score: val
      }]);
      if (res && res.data && res.data.length > 0) {
        _recordMap[key] = res.data[0]; // Ghi nhận vào RAM
      }
    } else {
      await adminWrite('chamcong_attendance_records', 'update', { nscl_score: val }, 'id', r.id);
      r.nscl_score = val; // Ghi nhận vào RAM
    }

    inputEl.style.backgroundColor = '#e6f4ea';
    setTimeout(() => { inputEl.style.backgroundColor = ''; }, 500);

    recalcNsclRow(empName);

  } catch(e) {
    showToast('❌ Lỗi lưu điểm NSCL: ' + e.message, 'error');
    inputEl.style.backgroundColor = '#fce8e6';
  }
}

// Blur ô Điểm +/- -> Lưu vào cột nscl_adjust trên bản ghi ngày 01 của tháng
async function saveNsclAdjust(inputEl) {
  const empName = inputEl.getAttribute('data-emp');
  const ym = inputEl.getAttribute('data-month'); // YYYY-MM
  let val = (inputEl.value || '').trim();
  if (val !== '' && !(/^\d+$/.test(val) && +val >= 1 && +val <= 15)) {
    inputEl.value = '';
    showToast('⚠️ Điểm +/- chỉ nhận số 1–15.', 'error');
    return;
  }

  const dateYMD = ym + '-01';
  const key = empName.toLowerCase() + '_' + dateYMD;
  let r = _recordMap[key];

  // Cột nscl_adjust kiểu numeric: ô trống phải gửi NULL (không phải '')
  const dbVal = (val === '') ? null : Number(val);

  // Không đổi so với hiện tại thì bỏ qua
  const curStr = (r && r.nscl_adjust != null) ? String(r.nscl_adjust) : '';
  if (r && curStr === val) return;
  if (!r && val === '') return; // chưa có bản ghi mà cũng để trống -> khỏi tạo

  try {
    if (!r) {
      const res = await adminWrite('chamcong_attendance_records', 'insert', [{
        employee_name: empName,
        date: dateYMD,
        grades: 'D, D, D, D',
        approve_status: 'Chờ',
        nscl_score: '',
        nscl_adjust: dbVal
      }]);
      if (res && res.data && res.data.length > 0) _recordMap[key] = res.data[0];
    } else {
      await adminWrite('chamcong_attendance_records', 'update', { nscl_adjust: dbVal }, 'id', r.id);
      r.nscl_adjust = dbVal;
    }
    inputEl.style.backgroundColor = '#e6f4ea';
    setTimeout(() => { inputEl.style.backgroundColor = ''; }, 500);
    recalcNsclRow(empName);
  } catch(e) {
    // Có thể bảng chưa có cột nscl_adjust -> vẫn giữ giá trị trong phiên để tính/in
    if (!r) {
      _recordMap[key] = { employee_name: empName, date: dateYMD, nscl_adjust: dbVal };
    } else {
      r.nscl_adjust = dbVal;
    }
    recalcNsclRow(empName);
    showToast('⚠️ Điểm +/- chưa lưu được vào CSDL (cần cột "nscl_adjust"). Vẫn áp dụng trong phiên này.', 'error');
  }
}

// Điền nhanh 10
async function autofillPoints10() {
  if (!confirm('Bạn có chắc muốn tự động điền 10 điểm vào TẤT CẢ các ngày làm việc trống của nhân sự đang hiển thị?\n(Sẽ KHÔNG điền vào những ngày trong tương lai.)')) return;

  // Mốc "hôm nay" theo lịch địa phương (YYYY-MM-DD) để so sánh chuỗi
  const _t = new Date();
  const _pad = n => n < 10 ? '0' + n : '' + n;
  const todayStr = `${_t.getFullYear()}-${_pad(_t.getMonth() + 1)}-${_pad(_t.getDate())}`;

  // Chỉ lấy ô chấm điểm ngày (có data-date), KHÔNG đụng tới ô Điểm +/- (pm-input)
  const inputs = document.querySelectorAll('.nscl-input[data-date]');
  let count = 0, skippedFuture = 0;
  showToast('⏳ Đang tự động rải điểm 10...');

  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i];
    if (inp.classList.contains('pm-input')) continue; // bỏ qua cột Điểm +/-
    if (inp.readOnly) continue; // Ngày lễ
    // Bỏ qua nếu là T7/CN
    const parentCls = inp.parentElement.className;
    if (parentCls.includes('t7') || parentCls.includes('cn')) continue;

    // Bỏ qua ngày trong tương lai (chỉ điền đến hết ngày hôm nay)
    const dateStr = inp.getAttribute('data-date') || '';
    if (dateStr > todayStr) { skippedFuture++; continue; }

    if (inp.value === '') {
      inp.value = '10';
      await saveNsclScore(inp);
      count++;
    }
  }
  let msg = `✅ Đã rải tự động thành công ${count} điểm 10!`;
  if (skippedFuture > 0) msg += ` (Bỏ qua ${skippedFuture} ô của những ngày chưa tới.)`;
  showToast(msg, 'success');
}

// Cấu hình bản in NSCL (có thể chỉnh từ admin_new.html, lưu ở admin_settings)
var _nsclPrintCfg = {
  fontName: 11,           // cỡ chữ tên CBNV, điểm tổng
  fontData: 11,           // cỡ chữ điểm chấm & số ngày
  rowHeight: 30,          // độ cao dòng (px)
  colorSat: '#BFBFBF',    // Thứ 7  (Excel: White, Darker 25%)
  colorSun: '#A6A6A6',    // Chủ nhật (Excel: White, Darker 35%)
  colorHoliday: '#D9D9D9' // Ngày lễ (Excel: White, Darker 15%)
};

// Đọc cấu hình bản in từ mảng admin_settings (lưu JSON ở cột password, key='nscl_print_config')
function applyPrintCfgFromSettings(settings){
  try {
    const row = (settings || []).find(s => s.key === 'nscl_print_config');
    if (row && row.password) {
      const c = JSON.parse(row.password);
      _nsclPrintCfg = Object.assign({}, _nsclPrintCfg, c);
    }
  } catch (e) { /* lỗi parse -> dùng mặc định */ }
}

// Tải cấu hình bản in (dùng khi khôi phục phiên / F5)
async function loadPrintConfig(){
  try {
    const { data } = await supabaseClient.from('chamcong_admin_settings').select('*');
    applyPrintCfgFromSettings(data);
  } catch (e) { /* dùng mặc định */ }
}


// In Bảng — dựng bảng in sạch trực tiếp từ dữ liệu (không clone bảng màn hình)
function printNsclReport() {
  const cfg = Object.assign({
    fontName: 11, fontData: 11, rowHeight: 30,
    colorSat: '#BFBFBF', colorSun: '#A6A6A6', colorHoliday: '#D9D9D9'
  }, _nsclPrintCfg || {});
  const selMonth = parseInt(document.getElementById('sel-month').value, 10);
  const selYear  = parseInt(document.getElementById('sel-year').value, 10);
  const pad = n => n < 10 ? '0' + n : '' + n;
  const daysInMonth = new Date(selYear, selMonth, 0).getDate();

  // Lọc nhân viên đúng như bảng đang hiển thị
  let emps = (_allActiveEmployees || []).slice();
  if (!_isAdmin) {
    emps = emps.filter(e => e.department === _tbpDept);
  } else {
    const selDept = (document.getElementById('sel-dept') || {}).value || '';
    if (selDept) emps = emps.filter(e => e.department === selDept);
  }
  emps.sort((a, b) => {
    const ar = (a.role || '').toUpperCase(), br = (b.role || '').toUpperCase();
    if (ar === 'TBP' && br !== 'TBP') return -1;
    if (ar !== 'TBP' && br === 'TBP') return 1;
    return a.name.localeCompare(b.name, 'vi');
  });

  if (emps.length === 0) {
    showToast('⚠️ Không có CBNV để in.', 'error');
    return;
  }

  const deptName = (!_isAdmin && _tbpDept)
    ? _tbpDept
    : ((document.getElementById('sel-dept') || {}).value || 'Toàn Công Ty');

  // Người lập = TBP của phòng (nếu có)
  const tbp = emps.find(e => (e.role || '').toUpperCase() === 'TBP');
  const nguoiLap = tbp ? tbp.name : '';

  // Xác định loại ngày: lễ ('le') / Thứ 7 ('t7') / Chủ nhật ('cn')
  function dayClass(d) {
    const ymd = selYear + '-' + pad(selMonth) + '-' + pad(d);
    if (_holidaysMap && _holidaysMap.has && _holidaysMap.has(ymd)) return 'le';
    const dow = new Date(selYear, selMonth - 1, d).getDay();
    if (dow === 6) return 't7';
    if (dow === 0) return 'cn';
    return '';
  }

  // colgroup cố định độ rộng (cột ngày để trống -> tự chia đều phần còn lại)
  let colgroup = '<col class="c-tt"><col class="c-name">';
  for (let d = 1; d <= daysInMonth; d++) colgroup += '<col class="c-day">';
  colgroup += '<col class="c-pm">'
    + '<col class="c-diem"><col class="c-sum"><col class="c-sum"><col class="c-sum"><col class="c-sum">'
    + '<col class="c-sm"><col class="c-sm"><col class="c-sm"><col class="c-sm"><col class="c-sm">';

  // Header hàng 2: số ngày
  let dayHeads = '';
  for (let d = 1; d <= daysInMonth; d++) dayHeads += '<th class="' + dayClass(d) + '">' + pad(d) + '</th>';

  // Thân bảng
  let body = '';
  let totDiem = 0, totPhep = 0, totOm = 0;
  emps.forEach((emp, i) => {
    let diem = 0, phep = 0, om = 0, dayCells = '';
    for (let d = 1; d <= daysInMonth; d++) {
      const ymd = selYear + '-' + pad(selMonth) + '-' + pad(d);
      const cls = dayClass(d);
      const r = _recordMap[emp.name.toLowerCase() + '_' + ymd];
      let v = (r && r.nscl_score) ? String(r.nscl_score).trim() : '';
      const u = v.toUpperCase();
      if (u === 'P') v = 'P';
      else if (u === 'Ô' || u === 'O') v = 'Ô';
      else if (u === 'N') v = 'N';
      // Ngày lễ/tết -> N
      if (cls === 'le') v = 'N';

      if (v === 'P') phep += 1;
      else if (u === 'P/2') phep += 0.5;          // dữ liệu cũ
      else if (v === 'Ô') om += 1;
      else if (v === 'N') { /* nghỉ lễ */ }
      else { const nv = parseFloat(v); if (!isNaN(nv)) { diem += nv; if (nv === 5) phep += 0.5; } }

      dayCells += '<td class="' + cls + '">' + escHtml(v) + '</td>';
    }
    // Điểm +/- (lưu ở bản ghi ngày 01)
    const adjRec = _recordMap[emp.name.toLowerCase() + '_' + (selYear + '-' + pad(selMonth) + '-01')];
    const adjVal = (adjRec && adjRec.nscl_adjust != null && adjRec.nscl_adjust !== '') ? String(adjRec.nscl_adjust) : '';
    const adjNum = parseFloat(adjVal);
    const rowDiem = diem + (isNaN(adjNum) ? 0 : adjNum);

    totDiem += rowDiem; totPhep += phep; totOm += om;
    body += '<tr>'
      + '<td class="c-tt">' + (i + 1) + '</td>'
      + '<td class="c-name">' + escHtml(emp.name) + '</td>'
      + dayCells
      + '<td>' + (adjVal || '-') + '</td>'
      + '<td class="c-diem">' + (rowDiem || '-') + '</td>'
      + '<td>-</td>'
      + '<td>' + (phep || '-') + '</td>'
      + '<td>-</td>'
      + '<td>' + (om || '-') + '</td>'
      + '<td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>'
      + '</tr>';
  });

  const congRow = '<tr class="cong">'
    + '<td colspan="2" style="text-align:right;padding-right:4px;">CỘNG</td>'
    + '<td colspan="' + (daysInMonth + 1) + '"></td>'
    + '<td class="c-diem">' + (totDiem || '-') + '</td>'
    + '<td>-</td>'
    + '<td>' + (totPhep || '-') + '</td>'
    + '<td>-</td>'
    + '<td>' + (totOm || '-') + '</td>'
    + '<td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>'
    + '</tr>';

  const today = new Date();
  const dateLine = 'Hà Nội, ngày ' + pad(today.getDate()) + ' tháng ' + pad(today.getMonth() + 1) + ' năm ' + today.getFullYear();

  const w = window.open('', '_blank');
  w.document.write(`
    <html>
    <head>
    <meta charset="UTF-8">
    <title>In Bảng Điểm NSCL - Tháng ${pad(selMonth)}/${selYear}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family:'Times New Roman',Times,serif; color:#000; margin:0; padding:6mm 8mm;
        -webkit-print-color-adjust:exact; print-color-adjust:exact; }

      /* ── Letterhead (dùng ảnh letterhead.png) ── */
      .lh { width:100%; margin-bottom:4px; }
      .lh-img { display:block; width:100%; height:auto; object-fit:contain; }
      .lh-fallback { display:none; font-weight:bold; font-size:15px; color:#c0392b;
        border-bottom:2px solid #c0392b; padding-bottom:6px; }

      .sub { display:flex; justify-content:space-between; align-items:center; margin-top:7px; }
      .phong { font-weight:bold; font-size:12px; text-transform:uppercase; }
      .bm { border:1px solid #000; padding:2px 10px; font-size:11px; font-weight:bold; white-space:nowrap; }

      .title { text-align:center; margin:8px 0 6px; }
      .title h2 { font-size:14px; font-weight:bold; text-transform:uppercase; margin:0; }

      /* ── Bảng ── */
      table.nscl { width:100%; border-collapse:collapse; table-layout:fixed; border:1.4px solid #000;
        -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      table.nscl th, table.nscl td { border-right:1px solid #000; border-bottom:1px dashed #9a9a9a;
        text-align:center; vertical-align:middle; font-size:${cfg.fontData}px; padding:3px 2px; overflow:hidden;
        white-space:nowrap; height:${cfg.rowHeight}px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      /* Đầu bảng: nền xám nhạt, kẻ ngang đậm liền dưới tiêu đề */
      table.nscl thead th { background:#e9e9e9; font-weight:bold; border-bottom:1.4px solid #000; }
      table.nscl td { background:#fff; }
      table.nscl td.c-name { text-align:left; padding-left:6px; font-size:${cfg.fontName}px; }
      table.nscl th.c-tt, table.nscl th.c-name { font-size:${cfg.fontName}px; }
      td.c-diem { font-weight:bold; font-size:${cfg.fontName}px; }
      .vtxt { writing-mode:vertical-rl; transform:rotate(180deg); white-space:nowrap;
        display:inline-block; line-height:1; font-size:9px; }

      /* Độ rộng cột */
      col.c-tt  { width:26px; }
      col.c-name{ width:132px; }
      col.c-pm  { width:24px; }
      col.c-diem{ width:42px; }
      col.c-sum { width:24px; }
      col.c-sm  { width:20px; }
      /* col.c-day không đặt width -> chia đều phần còn lại */

      /* Tô màu cuối tuần / ngày lễ theo cấu hình (mã màu Excel).
         Tô đều cả ô tiêu đề và ô dữ liệu; số ngày in đậm đen nên không bị che. */
      table.nscl thead th.t7, table.nscl td.t7 { background:${cfg.colorSat}; color:#000; }
      table.nscl thead th.cn, table.nscl td.cn { background:${cfg.colorSun}; color:#000; }
      table.nscl thead th.le, table.nscl td.le { background:${cfg.colorHoliday}; color:#000; }
      tr.cong td { font-weight:bold; background:#e9e9e9; border-top:1.4px solid #000;
        border-bottom:1px solid #000; }

      /* ── Ghi chú (ô có viền, đủ rộng để ghi tay) ── */
      .note-box { border:1px solid #000; min-height:64px; margin-top:10px; padding:6px 8px; }
      .note-box .note-label { font-weight:bold; font-size:11px; }
      .footer { display:flex; justify-content:space-between; margin-top:14px; padding:0 6%; }
      .fbox { text-align:center; width:40%; }
      .fbox .role { font-weight:bold; font-size:13px; }
      .fbox .date { font-style:italic; font-size:12px; margin-bottom:2px; }
      .fbox .gap  { height:56px; }
      .fbox .signer { font-weight:bold; font-style:italic; font-size:13px; }

      @page { size: A4 landscape; margin: 7mm; }
      @media print { body { padding:0; } }
    </style>
    </head>
    <body onload="setTimeout(function(){window.print();window.close();},500);">

      <div class="lh">
        <img src="letterhead.png" class="lh-img"
          onerror="this.style.display='none';this.nextElementSibling.style.display='block';">
        <div class="lh-fallback">CÔNG TY CP SIÊU THANH HÀ NỘI</div>
      </div>

      <div class="sub">
        <div class="phong">PHÒNG: ${escHtml(deptName.toUpperCase())}</div>
        <div class="bm">BM11-HCNS.01</div>
      </div>

      <div class="title">
        <h2>BẢNG CHẤM CÔNG &amp; CHẤM ĐIỂM NSCL THÁNG ${pad(selMonth)} NĂM ${selYear}</h2>
      </div>

      <table class="nscl">
        <colgroup>${colgroup}</colgroup>
        <thead>
          <tr>
            <th class="c-tt"   rowspan="2">TT</th>
            <th class="c-name" rowspan="2">Họ tên</th>
            <th colspan="${daysInMonth}">Ngày/tháng</th>
            <th rowspan="2"><span class="vtxt">Điểm +/-</span></th>
            <th colspan="10">TỔNG HỢP CÔNG ĐIỂM/THÁNG</th>
          </tr>
          <tr>
            ${dayHeads}
            <th>Điểm</th>
            <th><span class="vtxt">Trực</span></th>
            <th><span class="vtxt">Phép</span></th>
            <th><span class="vtxt">CĐ</span></th>
            <th><span class="vtxt">Ốm</span></th>
            <th>B</th><th>C</th><th>D</th><th>E</th><th>Y</th>
          </tr>
        </thead>
        <tbody>
          ${body}
          ${congRow}
        </tbody>
      </table>

      <div class="note-box"><div class="note-label">Ghi chú:</div></div>

      <div class="footer">
        <div class="fbox">
          <div class="role">PHÒNG KT-HC</div>
          <div class="gap"></div>
        </div>
        <div class="fbox">
          <div class="date">${dateLine}</div>
          <div class="role">NGƯỜI LẬP</div>
          <div class="gap"></div>
          <div class="signer">${escHtml(nguoiLap)}</div>
        </div>
      </div>

    </body>
    </html>
  `);
  w.document.close();
}

// ══════════════════════════════════════════════
// TIỆN ÍCH HỖ TRỢ
// ══════════════════════════════════════════════
function escHtml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg, type) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'show' + (type ? ' ' + type : '');
  setTimeout(function(){
    t.className = type || '';
  }, 3000);
}
// Event Delegation
document.addEventListener('click', function(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;

  const action = target.getAttribute('data-action');

  if (action === 'stopPropagation') {
    e.stopPropagation();
    return;
  }
  if (action === 'closeLogModalOverlay') {
    if (e.target === target) closeLogModal();
    return;
  }
  if (action === 'closeQRModalOverlay') {
    if (e.target === target) closeQRModal();
    return;
  }

  const argsRaw = target.getAttribute('data-args');
  let args = [];
  if (argsRaw) {
    // Phân tích arguments đơn giản: xóa dấu ngoặc kép và quote
    args = argsRaw.split(',').map(s => {
      let val = s.trim();
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      return val;
    });
  }

  // Fallback to calling the function globally if it exists inside this module scope.
  // Vì chúng ta xài module, các hàm không nằm trên window. Ta dùng eval gián tiếp qua hàm wrap,
  // hoặc gọi trực tiếp vì ta biết tên hàm.
  const fnMap = {
    switchTab: () => switchTab(args[0]),
    startDeployTestProcess: () => startDeployTestProcess(),
    startDeployProcess: () => startDeployProcess(),
    clearConsole: () => clearConsole(),
    printAllQRCodes: () => printAllQRCodes(),
    saveEmployee: () => saveEmployee(),
    cancelEmployeeEdit: () => cancelEmployeeEdit(),
    addHoliday: () => addHoliday(),
    saveShiftConfig: () => saveShiftConfig(),
    cancelShiftEdit: () => cancelShiftEdit(),
    saveGuideContent: () => saveGuideContent(),
    cancelGuideEdit: () => cancelGuideEdit(),
    uploadImageToGithub: () => uploadImageToGithub(),
    updatePassword: () => updatePassword(args[0], args[1]),
    saveNsclPrintCfg: () => saveNsclPrintCfg(),
    resetNsclPrintCfg: () => resetNsclPrintCfg(),
    saveSystemConfig: () => saveSystemConfig(),
    loadAttendanceLogs: () => loadAttendanceLogs(),
    closeLogModal: () => closeLogModal(),
    saveLogEdit: () => saveLogEdit(),
    deleteLog: () => deleteLog(),
    printQRCode: () => printQRCode(),
    closeQRModal: () => closeQRModal(),
    editEmployee: () => editEmployee(args[0]),
    openQRModal: () => openQRModal(args[0]),
    exportPrintReport: () => exportPrintReport(args[0], args[1]),
    deleteHoliday: () => deleteHoliday(args[0]),
    editShiftConfig: () => editShiftConfig(args[0]),
    editGuideContent: () => editGuideContent(args[0]),
    openLogEdit: () => openLogEdit(args[0]),

    // Giaitrinh functions
    login: () => login(),
    logout: () => logout(),
    switchMainTab: () => switchMainTab(args[0]),
    loadData: () => loadData(),
    openBatch: () => openBatch(),
    autofillPoints10: () => autofillPoints10(),
    printNsclReport: () => printNsclReport(),
    closeUndo: () => closeUndo(),
    confirmUndo: () => confirmUndo(),
    closeReject: () => closeReject(),
    confirmReject: () => confirmReject(),
    closeBatch: () => closeBatch(),
    confirmBatch: () => confirmBatch(),
    doApprove: () => doApprove(args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7], args[8]),
    warnNoReason: () => warnNoReason(),
    openReject: () => openReject(args[0], args[1]),
    undoApprove: () => undoApprove(args[0], args[1])
  };

  if (fnMap[action]) {
    fnMap[action]();
  }
});

// Bắt sự kiện phím Enter trên ô mật khẩu (Chạy trực tiếp vì ES Module đã defer)
{
  const pwInput = document.getElementById('pw-input');
  if (pwInput) {
    pwInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        login();
      }
    });
  }
}

// Expose các hàm được gọi từ inline handler (onchange/onclick/oninput/onblur trong HTML
// tĩnh & HTML do JS sinh ra) ra global scope — ES module không tự đặt hàm lên window.
Object.assign(window, {
  onMonthChange, onDeptChange, setFilterFromSelect,
  openReject, sanitizeDayInput, saveNsclScore, sanitizeAdjustInput, saveNsclAdjust
});
