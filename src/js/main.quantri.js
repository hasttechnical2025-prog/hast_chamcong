import { supabaseClient, recreateSupabaseClient } from './supabaseClient.js';
import { SUPABASE_KEY } from './config.js';
import { adminWrite, loginAdmin, adminAccount } from './api.js';
import { setSupabaseToken } from './supabaseClient.js';


// Khởi tạo biến toàn cục
let _isClientReady = false;
window.supabaseClient = supabaseClient;
window.SUPABASE_KEY = SUPABASE_KEY;

// ============================================================
// GLOBAL STATE CẤU HÌNH CA LÀM VIỆC (ĐỌC TỪ DB)
// ============================================================
let globalShiftTypes = {
  "tieu_chuan": "Ca Tiêu chuẩn",
  "ngoai_le_1": "Ngoại lệ 1 (In 8:30)",
  "ngoai_le_2": "Ngoại lệ 2 (In 9:00/Out 16:00)"
};

async function loadShiftTypesConfig() {
  try {
    const { data, error } = await supabaseClient
      .from('chamcong_system_config')
      .select('value')
      .eq('key', 'shift_types')
      .single();
    if (data && data.value) {
      globalShiftTypes = JSON.parse(data.value);
    }
  } catch (e) {
    console.log('Lấy cấu hình ca thất bại, dùng mặc định:', e);
  }
  populateShiftDropdowns();
}

function populateShiftDropdowns() {
  const empShift = document.getElementById('emp-shift');
  const filterShift = document.getElementById('filter-shift');
  if (empShift) {
    empShift.innerHTML = '';
    for (let key in globalShiftTypes) {
      empShift.innerHTML += `<option value="${key}">${globalShiftTypes[key]}</option>`;
    }
  }
  if (filterShift) {
    filterShift.innerHTML = '<option value="all">⏱️ Tất cả loại ca</option>';
    for (let key in globalShiftTypes) {
      filterShift.innerHTML += `<option value="${key}">${globalShiftTypes[key]}</option>`;
    }
  }
}

// ============================================================
// HỆ THỐNG GLOBAL STATE & KẾT NỐI
// ============================================================


function initSupabase() {
  const url = document.getElementById('supaUrl').value.trim();
  const key = document.getElementById('supaKey').value.trim();
  if (url && key) {
    try {
      recreateSupabaseClient(url, key);
      _isClientReady = true;
      updateDeployStatusCard();
    } catch(e) {
      console.log('Lỗi Init Supabase Client:', e);
      _isClientReady = false;
    }
  } else {
    _isClientReady = false;
  }
}

// ============================================================
// ĐĂNG NHẬP QUẢN TRỊ (Admin) — xác thực qua Edge Function, lấy JWT
// ============================================================
async function adminLogin() {
  const pwEl  = document.getElementById('admin-pw-input');
  const errEl = document.getElementById('login-err');
  const btn   = document.getElementById('btn-admin-login');
  const pw = (pwEl ? pwEl.value : '').trim();
  if (!pw) return;

  if (errEl) errEl.style.display = 'none';
  const _label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang xác thực...'; }

  try {
    // Trang quản trị chỉ dùng mật khẩu (username = null -> nhánh password-only ở backend)
    const res = await loginAdmin(null, pw);
    if (res.error) throw new Error(res.error);

    const user = res.user;
    // Cổng quản trị: chỉ tài khoản role 'admin' mới được vào (TBP dùng trang giải trình)
    if (!user || user.role !== 'admin') {
      throw new Error('Tài khoản không có quyền quản trị hệ thống.');
    }

    // Đính JWT vào Supabase client (cho các thao tác ĐỌC theo RLS) và vào header API ghi
    setSupabaseToken(res.access_token);
    _isClientReady = true;

    // Tải cấu hình ca động từ database
    await loadShiftTypesConfig();

    // Ẩn lớp đăng nhập, hiển thị portal
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.style.display = 'none';

    updateDeployStatusCard();
  } catch (e) {
    if (errEl) {
      errEl.textContent = '❌ ' + e.message;
      errEl.style.display = 'block';
    } else {
      alert('❌ ' + e.message);
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = _label || '🔐 Đăng nhập'; }
  }
}

// Chuyển đổi các tab giao diện
function switchTab(tabId, tabElement) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

  // Active tab mới
  const targetTab = tabElement || document.querySelector(`.nav-tab[data-tab="${tabId}"]`);
  if (targetTab) targetTab.classList.add('active');
  document.getElementById('panel-' + tabId).classList.add('active');

  // Tải dữ liệu tương ứng của tab đó nếu Supabase đã sẵn sàng
  if (_isClientReady) {
    if (tabId === 'employees') loadEmployees();
    if (tabId === 'attendance') loadAttendanceLogs();
    if (tabId === 'holidays') loadHolidays();
    if (tabId === 'shifts') loadShifts();
    if (tabId === 'guide') loadGuideContent();
  } else {
    if (tabId !== 'config' && tabId !== 'deploy') {
      alert('Vui lòng kết nối cấu hình Supabase ở tab "Cấu Hình Hệ Thống" trước khi truy cập dữ liệu!');
      switchTab('config');
      document.querySelectorAll('.nav-tab').forEach(t => {
        if(t.textContent.includes('Cấu Hình')) t.classList.add('active');
        else t.classList.remove('active');
      });
    }
  }
}

// Ghi log deploy
function log(msg, type = 'info') {
  const c = document.getElementById('console');
  const d = new Date().toLocaleTimeString('vi-VN');
  c.innerHTML += `<div class="log-line log-${type}">[${d}] ${msg}</div>`;
  c.scrollTop = c.scrollHeight;
}
function clearConsole() {
  document.getElementById('console').innerHTML = '<div class="log-line">Log đã được xóa. Sẵn sàng...</div>';
}

// Lưu & Tải Cấu hình
async function saveSystemConfig() {
  const config = {
    supaUrl: document.getElementById('supaUrl').value.trim(),
    companyName: document.getElementById('companyName').value.trim(),
    officeName: document.getElementById('officeName').value.trim(),
    companyAddress: document.getElementById('companyAddress').value.trim(),
    officeLat: document.getElementById('officeLat').value.trim(),
    officeLng: document.getElementById('officeLng').value.trim(),
    officeRadius: document.getElementById('officeRadius').value.trim(),
    maxDistance: document.getElementById('maxDistance').value.trim(),
    allowHoliday: document.getElementById('allowHoliday').checked,
    allowMultiple: document.getElementById('allowMultiple').checked,
    ghUser: document.getElementById('ghUser').value.trim(),
    ghRepo: document.getElementById('ghRepo').value.trim(),
    ghBranch: document.getElementById('ghBranch').value.trim()
    // Không lưu supaKey và ghToken vào localStorage vì lý do bảo mật
  };
  localStorage.setItem('hstc_admin_config', JSON.stringify(config));
  initSupabase();

  // Đồng bộ lên Supabase chamcong_system_config để GitHub Actions đọc được
  try {
    const keys = {
      'company_name': config.companyName,
      'office_name': config.officeName,
      'company_address': config.companyAddress,
      'office_lat': config.officeLat,
      'office_lng': config.officeLng,
      'office_radius': config.officeRadius,
      'max_distance': config.maxDistance,
      'allow_holiday': config.allowHoliday ? 'true' : 'false',
      'allow_multiple': config.allowMultiple ? 'true' : 'false'
    };

    // Upsert: chèn nếu chưa có dòng key đó (trước dùng update -> no-op khi thiếu dòng
    // allow_holiday/allow_multiple nên 2 checkbox không lưu được).
    const promises = Object.entries(keys).map(([k, v]) =>
      adminWrite('chamcong_system_config', 'upsert', [{ key: k, value: String(v), updated_at: new Date().toISOString() }])
    );

    await Promise.all(promises);
    alert('💾 Đã lưu cấu hình và đồng bộ lên Supabase thành công!');
  } catch (e) {
    alert('⚠️ Đã lưu cấu hình ở trình duyệt nhưng lỗi đồng bộ lên Supabase: ' + e.message);
  }
}

function loadSavedConfig() {
  const saved = localStorage.getItem('hstc_admin_config');
  if (saved) {
    const config = JSON.parse(saved);

    // Xoá bỏ các khoá nhạy cảm nếu đã lỡ lưu từ trước
    let needsUpdate = false;
    if (config.supaKey !== undefined) {
      delete config.supaKey;
      needsUpdate = true;
    }
    if (config.ghToken !== undefined) {
      delete config.ghToken;
      needsUpdate = true;
    }
    if (needsUpdate) {
      localStorage.setItem('hstc_admin_config', JSON.stringify(config));
    }

    document.getElementById('supaUrl').value = config.supaUrl || '';
    document.getElementById('supaKey').value = ''; // Yêu cầu nhập thủ công
    document.getElementById('companyName').value = config.companyName || 'CHẤM CÔNG CBNV';
    document.getElementById('officeName').value = config.officeName || 'Siêu Thanh Hà Nội';
    document.getElementById('companyAddress').value = config.companyAddress || 'Số 5 Nguyễn Ngọc Vũ, Phường Thanh Xuân, TP Hà Nội';
    document.getElementById('officeLat').value = config.officeLat || '21.00861322599807';
    document.getElementById('officeLng').value = config.officeLng || '105.81294998643875';
    document.getElementById('officeRadius').value = config.officeRadius || '200';
    document.getElementById('maxDistance').value = config.maxDistance || '15000';
    document.getElementById('allowHoliday').checked = !!config.allowHoliday;
    document.getElementById('allowMultiple').checked = !!config.allowMultiple;
    document.getElementById('ghUser').value = config.ghUser || '';
    document.getElementById('ghRepo').value = config.ghRepo || '';
    document.getElementById('ghBranch').value = config.ghBranch || 'main';
    document.getElementById('ghToken').value = ''; // Yêu cầu nhập thủ công
    initSupabase();
    if (_isClientReady) { loadNsclPrintCfg(); loadAccounts(); }
    _pcfgBindColorSync();
  }
}

async function loadAdminPasswords() {
  // Vì mật khẩu đã được băm bảo mật trên server, không thể tải về hiển thị dạng plaintext.
  document.getElementById('pw-tbp-kd').value = '';
  document.getElementById('pw-tbp-kd').placeholder = 'Nhập mật khẩu mới để đổi...';
  document.getElementById('pw-tbp-kt').value = '';
  document.getElementById('pw-tbp-kt').placeholder = 'Nhập mật khẩu mới để đổi...';
  document.getElementById('pw-admin').value = '';
  document.getElementById('pw-admin').placeholder = 'Nhập mật khẩu mới để đổi...';
}

async function updatePassword(key, inputId) {
  const newPw = document.getElementById(inputId).value.trim();
  if (!newPw) { alert('Mật khẩu không được để trống!'); return; }
  try {
    // Gọi RPC chamcong_update_password để băm mật khẩu trên server
    const { data, error } = await supabaseClient.rpc('chamcong_update_password', { p_username: key, p_password: newPw });
    if (error) throw error;
    if (!data) throw new Error('Không thể tìm thấy tài khoản để cập nhật');
    alert('✅ Đã cập nhật mật khẩu thành công!');
    document.getElementById(inputId).value = ''; // Xóa trường nhập sau khi đổi thành công
  } catch (e) {
    alert('❌ Lỗi cập nhật mật khẩu: ' + e.message);
  }
}

// ============================================================
// QUẢN LÝ TÀI KHOẢN TBP / PHÒNG BAN (#2) — qua RPC SECURITY DEFINER
// ============================================================
async function loadAccounts() {
  const el = document.getElementById('acc-list');
  if (!el) return;
  try {
    const res = await adminAccount('list');
    const data = res.data;
    if (!data || !data.length) { el.innerHTML = '<i style="color:#888;">Chưa có tài khoản nào.</i>'; return; }
    el.innerHTML = '<table class="data-table" style="font-size:12px;"><thead><tr>'
      + '<th>Username</th><th>Vai trò</th><th>Phòng ban</th><th style="text-align:center;">Xóa</th></tr></thead><tbody>'
      + data.map(a =>
          '<tr><td>' + escHtmlA(a.username) + '</td><td>' + escHtmlA(a.role || '') + '</td><td>' + escHtmlA(a.department || '') + '</td>'
          + '<td style="text-align:center;"><button class="btn btn-gray" style="padding:2px 8px; font-size:11px;" '
          + 'data-action="deleteAccount" data-args="\'' + a.id + '\',\'' + escHtmlA(a.username) + '\'">🗑</button></td></tr>'
        ).join('')
      + '</tbody></table>';
  } catch (e) {
    el.innerHTML = '<span style="color:#c5221f;">❌ Lỗi tải tài khoản: ' + e.message
      + ' (cần chạy SQL tạo các hàm chamcong_list_accounts/upsert/delete).</span>';
  }
}

async function saveAccount() {
  const username = document.getElementById('acc-username').value.trim();
  const dept = document.getElementById('acc-dept').value.trim();
  const role = document.getElementById('acc-role').value;
  const password = document.getElementById('acc-password').value;

  if (!username) { alert('Vui lòng nhập Username!'); return; }
  if (role === 'TBP' && !dept) { alert('Tài khoản TBP cần điền Phòng ban!'); return; }

  try {
    await adminAccount('save', { username: username, password: password, role: role, department: dept || null });
    alert('✅ Đã lưu tài khoản "' + username + '"!');
    document.getElementById('acc-username').value = '';
    document.getElementById('acc-dept').value = '';
    document.getElementById('acc-password').value = '';
    loadAccounts();
  } catch (e) {
    alert('❌ Lỗi lưu tài khoản: ' + e.message);
  }
}

async function deleteAccount(id, username) {
  if (!confirm('Xóa tài khoản "' + username + '"? (Tài khoản này sẽ không đăng nhập được nữa)')) return;
  try {
    await adminAccount('delete', { id: parseInt(id, 10) });
    loadAccounts();
  } catch (e) {
    alert('❌ Lỗi xóa tài khoản: ' + e.message);
  }
}

// ============================================================
// CẤU HÌNH BẢN IN NSCL (lưu ở admin_settings, key='nscl_print_config')
// ============================================================
const PCFG_DEFAULTS = { fontName:11, fontData:11, rowHeight:30, colorSat:'#BFBFBF', colorSun:'#A6A6A6', colorHoliday:'#D9D9D9' };

function _pcfgSet(c){
  document.getElementById('pcfg-fontName').value = c.fontName;
  document.getElementById('pcfg-fontData').value = c.fontData;
  document.getElementById('pcfg-rowHeight').value = c.rowHeight;
  ['Sat','Sun','Holiday'].forEach(k => {
    const v = (c['color'+k] || '').toUpperCase();
    const cEl = document.getElementById('pcfg-color'+k);
    const hEl = document.getElementById('pcfg-color'+k+'Hex');
    if(cEl) cEl.value = v; if(hEl) hEl.value = v;
  });
}

function _normHex(v, fb){
  v = (v || '').trim().replace(/^#/, '');
  if(/^[0-9a-fA-F]{6}$/.test(v)) return ('#' + v).toUpperCase();
  return fb;
}

async function loadNsclPrintCfg(){
  try {
    const { data, error } = await supabaseClient.from('chamcong_admin_settings').select('*').eq('key','nscl_print_config');
    if(error) throw error;
    let c = Object.assign({}, PCFG_DEFAULTS);
    if(data && data.length && data[0].password){
      try { c = Object.assign(c, JSON.parse(data[0].password)); } catch(e){}
    }
    _pcfgSet(c);
  } catch(e){ _pcfgSet(PCFG_DEFAULTS); }
}

function resetNsclPrintCfg(){ _pcfgSet(PCFG_DEFAULTS); }

async function saveNsclPrintCfg(){
  if(!_isClientReady){ alert('Chưa kết nối Supabase!'); return; }
  const cfg = {
    fontName:  Math.min(16, Math.max(8,  parseInt(document.getElementById('pcfg-fontName').value,10)  || 11)),
    fontData:  Math.min(16, Math.max(8,  parseInt(document.getElementById('pcfg-fontData').value,10)  || 11)),
    rowHeight: Math.min(48, Math.max(20, parseInt(document.getElementById('pcfg-rowHeight').value,10) || 30)),
    colorSat:     _normHex(document.getElementById('pcfg-colorSatHex').value, '#BFBFBF'),
    colorSun:     _normHex(document.getElementById('pcfg-colorSunHex').value, '#A6A6A6'),
    colorHoliday: _normHex(document.getElementById('pcfg-colorHolidayHex').value, '#D9D9D9')
  };
  const json = JSON.stringify(cfg);
  try {
    // 1) Thử UPDATE (RLS thường cho phép update)
    const { data: upd, error: e1 } = await adminWrite('chamcong_admin_settings', 'update', { password: json, updated_at: new Date().toISOString() }, 'key', 'nscl_print_config');
    if(e1) throw e1;

    if(upd && upd.length > 0){
      _pcfgSet(cfg);
      alert('✅ Đã lưu cấu hình bản in NSCL.\nTrang Duyệt Giải Trình sẽ áp dụng ở lần đăng nhập/tải lại tiếp theo.');
      return;
    }

    // 2) Chưa có dòng -> thử INSERT
    const { error: e2 } = await adminWrite('chamcong_admin_settings', 'insert', [{ key:'nscl_print_config', password: json, updated_at: new Date().toISOString() }]);
    if(!e2){
      _pcfgSet(cfg);
      alert('✅ Đã lưu cấu hình bản in NSCL.\nTrang Duyệt Giải Trình sẽ áp dụng ở lần đăng nhập/tải lại tiếp theo.');
      return;
    }

    // 3) INSERT bị RLS chặn -> hướng dẫn chạy SQL 1 lần (đã kèm cấu hình hiện tại)
    const sql = "insert into public.chamcong_admin_settings (key, password)\n"
      + "values ('nscl_print_config', '" + json.replace(/'/g, "''") + "');";
    window.prompt(
      '⚠️ Bảng admin_settings chưa cho phép tạo dòng mới (RLS).\n' +
      'Hãy COPY câu lệnh SQL bên dưới, dán vào Supabase → SQL Editor → Run (chạy 1 lần duy nhất).\n' +
      'Sau đó cấu hình đã được lưu; các lần sau bấm “Lưu” sẽ cập nhật bình thường.',
      sql
    );
  } catch(e){ alert('❌ Lỗi lưu cấu hình: ' + e.message); }
}

function _pcfgBindColorSync(){
  ['Sat','Sun','Holiday'].forEach(k => {
    const c = document.getElementById('pcfg-color'+k);
    const h = document.getElementById('pcfg-color'+k+'Hex');
    if(c && h && !c.dataset.bound){
      c.addEventListener('input', () => { h.value = c.value.toUpperCase(); });
      h.addEventListener('input', () => { const v = _normHex(h.value, null); if(v) c.value = v; });
      c.dataset.bound = '1';
    }
  });
}

function updateDeployStatusCard() {
  const statusEl = document.getElementById('deploy-cfg-status');
  if (_isClientReady) {
    statusEl.innerHTML = `
      <div style="margin-bottom:8px;">🟢 <b>Supabase:</b> Đã kết nối thành công</div>
      <div style="margin-bottom:8px;">📦 <b>GitHub Repo:</b> ${document.getElementById('ghUser').value}/${document.getElementById('ghRepo').value}</div>
      <div style="margin-bottom:8px;">📍 <b>Tên văn phòng:</b> ${document.getElementById('companyName').value}</div>
      <div style="margin-bottom:8px;">📏 <b>Bán kính hợp lệ:</b> ${document.getElementById('officeRadius').value} m</div>
      <div>🎯 <b>Tọa độ:</b> ${document.getElementById('officeLat').value}, ${document.getElementById('officeLng').value}</div>
    `;
  } else {
    statusEl.innerHTML = '<span style="color:#ea4335;">🔴 Vui lòng điền và lưu cấu hình Supabase tại tab Cấu Hình.</span>';
  }
}

window.onload = function() {
  loadSavedConfig();
};

// ============================================================
// TAB 2: QUẢN LÝ NHÂN VIÊN
// ============================================================
let allEmployees = [];

async function loadEmployees() {
  try {
    const { data, error } = await supabaseClient
      .from('chamcong_employees')
      .select('*')
      .order('name');

    if (error) throw error;
    allEmployees = data || [];
    renderEmployeeTable();
  } catch(e) {
    document.getElementById('emp-table-body').innerHTML = `<tr><td colspan="6" style="text-align:center;color:#c5221f;">❌ Lỗi: ${e.message}</td></tr>`;
  }
}

function renderEmployeeTable() {
  const tbody = document.getElementById('emp-table-body');
  if (allEmployees.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#888;">📭 Danh sách trống. Hãy thêm nhân viên mới ở panel bên phải!</td></tr>';
    return;
  }

  // Đọc giá trị bộ lọc
  const filterDept = document.getElementById('filter-dept').value;
  const filterShift = document.getElementById('filter-shift').value;

  // Lọc dữ liệu local cực nhanh
  const filtered = allEmployees.filter(e => {
    // 1. Lọc theo Phòng ban
    if (filterDept !== 'all' && e.department !== filterDept) return false;

    // 2. Lọc theo Loại ca
    if (filterShift !== 'all') {
      let lc = e.loai_ca ? e.loai_ca.toString().trim().toLowerCase() : 'tieu_chuan';
      // Normalize legacy data
      if (lc.indexOf('1') !== -1 && lc !== 'ngoai_le_1') lc = 'ngoai_le_1';
      else if (lc.indexOf('2') !== -1 && lc !== 'ngoai_le_2') lc = 'ngoai_le_2';
      else if (lc === '') lc = 'tieu_chuan';

      if (lc !== filterShift) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#888;">📭 Không tìm thấy cán bộ nhân viên phù hợp bộ lọc.</td></tr>';
    return;
  }

  let html = '';
  filtered.forEach(e => {
    // Nhận diện trạng thái
    const st = e.status ? e.status.toString().trim().toLowerCase() : '';
    const isActive = !st || st.indexOf('đang') !== -1 || st.indexOf('active') !== -1 || st.indexOf('làm việc') !== -1 || st.indexOf('lam viec') !== -1;
    const statusBadge = isActive
      ? '<span class="badge badge-success">Active</span>'
      : '<span class="badge badge-danger">Nghỉ việc</span>';

    // Nhận diện loại ca & Tô màu Badge ca làm việc sinh động
    let lc = e.loai_ca ? e.loai_ca.toString().trim().toLowerCase() : 'tieu_chuan';
    if (lc === '' || lc.indexOf('tiêu chuẩn') !== -1 || lc.indexOf('tieu chuan') !== -1) lc = 'tieu_chuan';
    else if (lc.indexOf('1') !== -1 && lc !== 'ngoai_le_1') lc = 'ngoai_le_1';
    else if (lc.indexOf('2') !== -1 && lc !== 'ngoai_le_2') lc = 'ngoai_le_2';

    let shiftBadge = '';
    const shiftName = globalShiftTypes[lc] || lc;
    let badgeClass = 'badge-primary';
    if (lc === 'ngoai_le_1') badgeClass = 'badge-orange';
    else if (lc === 'ngoai_le_2') badgeClass = 'badge-purple';
    else if (lc !== 'tieu_chuan') badgeClass = 'badge-warning';
    shiftBadge = `<span class="badge ${badgeClass}">${shiftName}</span>`;

    const roleBadge = e.role === 'TBP'
      ? '<span class="badge badge-warning">TBP</span>'
      : '<span class="badge badge-primary">CBNV</span>';

    html += `
      <tr>
        <td style="padding: 10px 8px;">
          <div style="font-weight: 600; color: #202124; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <span>${e.name}</span>
            ${roleBadge}
            ${statusBadge}
          </div>
          <div style="display: flex; gap: 4px; margin-top: 6px; flex-wrap: nowrap; white-space: nowrap;">
            <button class="btn btn-gray" style="padding: 3px 6px; font-size:11px;" data-action="editEmployee" data-args="'${e.id}'">✏️ Sửa</button>
            <button class="btn btn-blue" style="padding: 3px 6px; font-size:11px; background:#34a853;" data-action="openQRModal" data-args="'${e.name}'">📱 Mã QR</button>
            <button class="btn btn-blue" style="padding: 3px 6px; font-size:11px; background:#e65100;" data-action="exportPrintReport" data-args="'${e.name}', '${e.id}'">🖨️ In BC</button>
          </div>
        </td>
        <td style="vertical-align: middle;">🏢 ${e.department}</td>
        <td style="font-family:monospace; vertical-align: middle;">${e.telegram_chat_id || 'NULL'}</td>
        <td style="vertical-align: middle;">${shiftBadge}</td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

async function saveEmployee() {
  const id = document.getElementById('emp-id').value;
  const name = document.getElementById('emp-name').value.trim();
  const department = document.getElementById('emp-dept').value;
  const role = document.getElementById('emp-role').value;
  const loai_ca = document.getElementById('emp-shift').value;
  const status = document.getElementById('emp-status').value;
  const telegram = document.getElementById('emp-telegram').value.trim();
  const ngayVaoLam = document.getElementById('emp-startdate').value || null;

  if (!name) { alert('Vui lòng điền họ và tên nhân viên!'); return; }

  const payload = {
    name: name,
    department: department,
    role: role,
    loai_ca: loai_ca,
    status: status,
    telegram_chat_id: telegram ? parseInt(telegram) : null,
    ngay_vao_lam: ngayVaoLam
  };

  try {
    if (id) {
      // Edit nhân viên
      const { error } = await adminWrite('chamcong_employees', 'update', payload, 'id', id);
      if (error) throw error;
      alert('✅ Đã cập nhật nhân viên thành công!');
    } else {
      // Add nhân viên mới
      const { error } = await adminWrite('chamcong_employees', 'insert', [payload]);
      if (error) throw error;
      alert('✅ Đã thêm nhân viên mới thành công!');
    }
    cancelEmployeeEdit();
    loadEmployees();
  } catch(e) {
    alert('❌ Lỗi lưu dữ liệu: ' + e.message);
  }
}

function editEmployee(id) {
  const emp = allEmployees.find(e => e.id.toString() === id.toString());
  if (!emp) return;

  document.getElementById('emp-id').value = emp.id;
  document.getElementById('emp-name').value = emp.name;
  document.getElementById('emp-dept').value = emp.department;
  document.getElementById('emp-role').value = emp.role || 'CBNV';

  // Ánh xạ Loại ca cũ/mới vào Select Option
  const lc = emp.loai_ca ? emp.loai_ca.toString().trim().toLowerCase() : '';
  const shiftVal = (lc === 'ngoai_le_1' || lc.indexOf('1') !== -1) ? 'ngoai_le_1'
    : (lc === 'ngoai_le_2' || lc.indexOf('2') !== -1) ? 'ngoai_le_2'
    : 'tieu_chuan';
  document.getElementById('emp-shift').value = shiftVal;

  // Ánh xạ trạng thái cũ/mới vào Select Option
  const st = emp.status ? emp.status.toString().trim().toLowerCase() : '';
  const isActive = !st ||
                   st.indexOf('đang') !== -1 ||
                   st.indexOf('active') !== -1 ||
                   st.indexOf('làm việc') !== -1 ||
                   st.indexOf('lam viec') !== -1;
  document.getElementById('emp-status').value = isActive ? 'active' : 'inactive';

  document.getElementById('emp-telegram').value = emp.telegram_chat_id || '';
  document.getElementById('emp-startdate').value = emp.ngay_vao_lam || '';

  document.getElementById('emp-form-title').textContent = '📝 Chỉnh sửa thông tin nhân viên';
  document.getElementById('btn-emp-cancel').style.display = 'inline-flex';
}

function cancelEmployeeEdit() {
  document.getElementById('emp-id').value = '';
  document.getElementById('emp-name').value = '';
  document.getElementById('emp-dept').value = '';
  document.getElementById('emp-role').selectedIndex = 0;
  document.getElementById('emp-shift').selectedIndex = 0;
  document.getElementById('emp-status').selectedIndex = 0;
  document.getElementById('emp-telegram').value = '';
  document.getElementById('emp-startdate').value = '';

  document.getElementById('emp-form-title').textContent = '👤 Thêm nhân viên mới';
  document.getElementById('btn-emp-cancel').style.display = 'none';
}

// --- TÍNH NĂNG IN BÁO CÁO CHẤM CÔNG CÁ NHÂN ---

// CSS bản in (dùng chung cho in 1 người và in toàn bộ)
const _REPORT_PRINT_STYLE = `<style>
  * { box-sizing: border-box; }
  body { font-family: 'Times New Roman', Times, serif; color:#000; margin:0; padding:4mm 6mm;
    -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .header-print { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:1px; }
  .header-left { font-weight:bold; font-size:12px; text-transform:uppercase; }
  .header-right { font-style:italic; font-size:10px; }
  .title-print { text-align:center; margin:2px 0 6px; }
  .title-print h2 { font-size:14px; font-weight:bold; text-transform:uppercase; margin:0; }
  table.tbl-print { width:100%; border-collapse:collapse; border:0.7px solid #000; font-size:11px; table-layout:fixed; }
  table.tbl-print th, table.tbl-print td { border:0.7px solid #000; padding:1px 5px; line-height:1.4; overflow:hidden; vertical-align:middle; text-align:center; }
  table.tbl-print td:nth-child(2), table.tbl-print td:nth-child(10) { text-align:left; }
  table.tbl-print thead th { background:#e0e0e0; font-weight:bold; text-align:center; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  tr.weekend td, tr.sunday td, tr.holiday td { background:#f2f2f2; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  tr { page-break-inside: avoid; }
  .report-section { page-break-after: always; }
  .report-section:last-child { page-break-after: auto; }
  @page { size: A4 landscape; margin: 6mm; }
  @media print { body { padding:0; } }
</style>`;

// Dựng các dòng ngày của 1 nhân viên (trả về HTML <tr>...)
function _buildReportRows(name, employeeId, ngayVaoLam, recordsMap, holidaysMap, month, year, daysInMonth, padStr) {
    let rowsHtml = '';
    for (let day = 1; day <= daysInMonth; day++) {
      const currentDateStr = `${year}-${padStr(month)}-${padStr(day)}`;
      const displayDateStr = `${padStr(day)}/${padStr(month)}/${year}`;
      const dateObj = new Date(year, month - 1, day);
      const dow = dateObj.getDay();
      const isWeekend = (dow === 0 || dow === 6);
      const dowLabel = isWeekend ? `<b>Thứ ${dow === 0 ? '7' : '7'}</b>` : `Thứ ${dow + 1}`; // DOW_LABEL match

      const record = recordsMap[currentDateStr] || {};
      const isHoliday = !!holidaysMap[displayDateStr];
      const holidayLabel = holidaysMap[displayDateStr] || '';

      // Tách điểm ca
      const ga = (record.grades || 'D,D,D,D').split(',').map(g => g.trim());
      const g1 = ga[0] || 'D', g2 = ga[1] || 'D', g3 = ga[2] || 'D', g4 = ga[3] || 'D';

      // Định dạng giờ rỗng
      const fmt = t => (t && t !== ':') ? t.substring(0, 5) : ': :';

      let rowClass = '';
      let displayGrades = '';
      // Ghi chú: chỉ để nhãn ngày (Thứ 7/Nghỉ lễ). Lý do/Giải trình: gộp giải trình
      // HOẶC ghi chú lúc chấm (vd "Lỗi app") — vì cả hai đều là lý do của CBNV.
      let displayNote = '';
      let displayReason = record.justification || record.note || '';
      let displayApprove = record.approve_status || '';
      let displayName = name;

      const hasMissing = g1 !== 'A' || g2 !== 'A' || g3 !== 'A' || g4 !== 'A';
      const gradesStyle = hasMissing ? 'font-weight:bold;' : 'font-weight:normal;';

      // Định nghĩa các biến giờ hiển thị
      let mIn = fmt(record.morning_in);
      let mOut = fmt(record.morning_out);
      let aIn = fmt(record.afternoon_in);
      let aOut = fmt(record.afternoon_out);

      if (ngayVaoLam && currentDateStr < ngayVaoLam) {
        // Chưa vào làm: để trống toàn bộ, KHÔNG tính D, không cần giải trình
        displayGrades = ''; displayReason = ''; displayNote = '';
        mIn = ''; mOut = ''; aIn = ''; aOut = ''; displayName = '';
      } else if (isHoliday) {
        rowClass = 'class="holiday"';
        displayReason = `Nghỉ lễ: ${holidayLabel}`;
        displayGrades = ''; // Ẩn đánh giá công vào ngày Lễ
        mIn = ''; mOut = ''; aIn = ''; aOut = ''; // Ẩn giờ In/Out vào ngày Lễ
        displayName = ''; // Ẩn tên CBNV vào ngày Lễ
      } else if (dow === 0) { // Chủ Nhật
        rowClass = 'class="sunday"';
        displayNote = '';
        displayGrades = ''; // Ẩn đánh giá công vào Chủ Nhật
        mIn = ''; mOut = ''; aIn = ''; aOut = ''; // Ẩn giờ In/Out vào Chủ Nhật
        displayName = ''; // Ẩn tên CBNV vào Chủ nhật
      } else if (dow === 6) { // Thứ Bảy
        rowClass = 'class="weekend"';
        displayNote = 'Thứ 7';
        displayGrades = 'D, D, D, D';
        mIn = ': :'; mOut = ': :'; aIn = ': :'; aOut = ': :'; // Thứ Bảy giữ nguyên ký tự : :
      } else {
        displayGrades = `${g1}, ${g2}, ${g3}, ${g4}`;
      }

      rowsHtml += `
        <tr ${rowClass}>
          <td style="text-align:center;">${employeeId || '3'}</td>
          <td>${displayName}</td>
          <td style="text-align:center;">${displayDateStr}</td>
          <td style="text-align:center; font-family:monospace;">${mIn}</td>
          <td style="text-align:center; font-family:monospace;">${mOut}</td>
          <td style="text-align:center; font-family:monospace;">${aIn}</td>
          <td style="text-align:center; font-family:monospace;">${aOut}</td>
          <td style="text-align:center; ${gradesStyle}">${displayGrades}</td>
          <td style="font-size:11px;">${displayNote}</td>
          <td style="font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${displayReason}</td>
          <td style="text-align:center;">${record.justification ? (displayApprove === 'Đồng ý' ? 'Đồng ý' : (displayApprove === 'Từ chối' ? 'Từ chối' : '')) : ''}</td>
        </tr>
      `;
    }
    return rowsHtml;
}

// Dựng 1 section báo cáo (header + tiêu đề + bảng) cho 1 nhân viên
function _buildReportSection(name, employeeId, ngayVaoLam, recordsMap, holidaysMap, month, year, daysInMonth, padStr, nowDateStr) {
  const rowsHtml = _buildReportRows(name, employeeId, ngayVaoLam, recordsMap, holidaysMap, month, year, daysInMonth, padStr);
  return `
    <div class="report-section">
      <div class="header-print">
        <div class="header-left">CÔNG TY CỔ PHẦN SIÊU THANH HÀ NỘI</div>
        <div class="header-right">Ngày in: ${nowDateStr}</div>
      </div>
      <div class="title-print"><h2>DỮ LIỆU CHẤM CÔNG CBNV THÁNG ${month} NĂM ${year}</h2></div>
      <table class="tbl-print">
        <thead><tr>
          <th style="width:3%;">ID</th><th style="width:14%;">Họ tên</th><th style="width:7%;">Ngày</th>
          <th style="width:6%;">Sáng IN</th><th style="width:6%;">Sáng OUT</th><th style="width:6%;">Chiều IN</th><th style="width:6%;">Chiều OUT</th>
          <th style="width:9%;">Đánh giá công</th><th style="width:7%;">Ghi chú</th><th style="width:28%;">Lý do / Giải trình</th><th style="width:8%;">Xác nhận</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
}

// Tải records (1 người hoặc tất cả) + holidays của 1 tháng
async function _fetchMonthData(startDate, endDate, name) {
  let q = supabaseClient.from('chamcong_attendance_records').select('*').gte('date', startDate).lte('date', endDate);
  if (name) q = q.eq('employee_name', name);
  const { data: records, error: recErr } = await q;
  if (recErr) throw recErr;
  const { data: hld, error: hldErr } = await supabaseClient.from('chamcong_holidays').select('*').gte('date', startDate).lte('date', endDate);
  if (hldErr) throw hldErr;
  const holidaysMap = {};
  if (hld) hld.forEach(h => { const p = h.date.split('-'); holidaysMap[`${p[2]}/${p[1]}/${p[0]}`] = h.description; });
  return { records: records || [], holidaysMap };
}

async function exportPrintReport(name, employeeId) {
  const now = new Date();
  const month = now.getMonth() + 1, year = now.getFullYear();
  const padStr = n => n < 10 ? '0' + n : '' + n;
  const startDate = `${year}-${padStr(month)}-01`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const endDate = `${year}-${padStr(month)}-${padStr(daysInMonth)}`;
  const nowDateStr = `${padStr(now.getDate())}/${padStr(month)}/${year}`;
  const _empRec = (allEmployees || []).find(e => e.name === name);
  const ngayVaoLam = (_empRec && _empRec.ngay_vao_lam) ? _empRec.ngay_vao_lam : null;
  try {
    const { records, holidaysMap } = await _fetchMonthData(startDate, endDate, name);
    const recordsMap = {};
    records.forEach(r => { recordsMap[r.date] = r; });
    const section = _buildReportSection(name, employeeId, ngayVaoLam, recordsMap, holidaysMap, month, year, daysInMonth, padStr, nowDateStr);
    const w = window.open('', '_blank');
    w.document.write(`<html><head><meta charset="UTF-8"><title>Báo cáo chấm công - ${name}</title>${_REPORT_PRINT_STYLE}</head><body onload="window.print(); window.close();">${section}</body></html>`);
    w.document.close();
  } catch(e) {
    alert('❌ Lỗi xuất báo cáo in ấn: ' + e.message);
  }
}

// In TOÀN BỘ báo cáo của các nhân viên đang hiển thị (mỗi người 1 trang)
async function exportPrintReportAll() {
  const filterDept = (document.getElementById('filter-dept') || {}).value || 'all';
  const filterShift = (document.getElementById('filter-shift') || {}).value || 'all';
  let emps = (allEmployees || []).filter(e => {
    const st = e.status ? e.status.toString().trim().toLowerCase() : '';
    const isActive = !st || st.indexOf('đang') !== -1 || st.indexOf('active') !== -1 || st.indexOf('làm') !== -1 || st.indexOf('lam') !== -1;
    if (!isActive) return false;
    if (filterDept !== 'all' && e.department !== filterDept) return false;
    if (filterShift !== 'all') {
      let lc = e.loai_ca ? e.loai_ca.toString().trim().toLowerCase() : 'tieu_chuan';
      // Normalize legacy data
      if (lc.indexOf('1') !== -1 && lc !== 'ngoai_le_1') lc = 'ngoai_le_1';
      else if (lc.indexOf('2') !== -1 && lc !== 'ngoai_le_2') lc = 'ngoai_le_2';
      else if (lc === '') lc = 'tieu_chuan';

      if (lc !== filterShift) return false;
    }
    return true;
  });
  if (!emps.length) { alert('Không có nhân viên nào phù hợp bộ lọc để in!'); return; }
  emps.sort((a, b) => (a.department || '').localeCompare(b.department || '', 'vi') || a.name.localeCompare(b.name, 'vi'));

  const now = new Date();
  const month = now.getMonth() + 1, year = now.getFullYear();
  const padStr = n => n < 10 ? '0' + n : '' + n;
  const startDate = `${year}-${padStr(month)}-01`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const endDate = `${year}-${padStr(month)}-${padStr(daysInMonth)}`;
  const nowDateStr = `${padStr(now.getDate())}/${padStr(month)}/${year}`;
  try {
    const { records, holidaysMap } = await _fetchMonthData(startDate, endDate, null);
    const byEmp = {};
    records.forEach(r => { (byEmp[r.employee_name] = byEmp[r.employee_name] || {})[r.date] = r; });
    let allSections = '';
    emps.forEach(e => {
      allSections += _buildReportSection(e.name, e.id, e.ngay_vao_lam || null, byEmp[e.name] || {}, holidaysMap, month, year, daysInMonth, padStr, nowDateStr);
    });
    const w = window.open('', '_blank');
    w.document.write(`<html><head><meta charset="UTF-8"><title>Báo cáo chấm công toàn bộ - Tháng ${month}/${year}</title>${_REPORT_PRINT_STYLE}</head><body onload="window.print(); window.close();">${allSections}</body></html>`);
    w.document.close();
  } catch(e) {
    alert('❌ Lỗi in toàn bộ: ' + e.message);
  }
}

// --- TÍNH NĂNG SINH MÃ QRCODE CHẤM CÔNG (link ?t=<token>) ---
// URL gốc của app, suy ra từ chính địa chỉ trang quản trị (bỏ phần "quantri/...").
// Nhờ vậy QR luôn đúng host/repo hiện tại, KHÔNG phụ thuộc ghUser/ghRepo (chỉ lưu
// localStorage từng máy, dễ trống -> sinh URL "https://.github.io//..." hỏng).
function appBaseUrl() {
  return window.location.href.split('#')[0].split('?')[0].replace(/quantri\/[^/]*$/, '');
}

function openQRModal(name) {
  // Định danh bằng TOKEN ngẫu nhiên (không dùng tên).
  const emp = (allEmployees || []).find(e => e.name === name);
  if (!emp || !emp.token) {
    alert('⚠️ Nhân viên này chưa có token định danh trong CSDL. Liên hệ kỹ thuật để sinh token trước khi tạo mã QR.');
    return;
  }

  // Trỏ tới tệp cá nhân /nv/<token>/ (do "Deploy PWA" sinh, token baked sẵn) — bền cho
  // cả iOS (Add-to-Home-Screen không mất định danh) lẫn Android.
  // LƯU Ý: thêm nhân viên mới phải chạy lại "Deploy PWA" để sinh tệp /nv/<token>/ cho họ.
  const linkUrl = `${appBaseUrl()}nv/${emp.token}/`;

  document.getElementById('qr-title-name').textContent = `Mã QR Chấm Công — ${name}`;
  document.getElementById('qr-url-text').textContent = linkUrl;

  // Dùng API mở miễn phí tạo QRCode
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(linkUrl)}`;
  document.getElementById('qr-img-src').src = qrApiUrl;

  document.getElementById('qr-modal').classList.add('show');
}

function closeQRModal() {
  document.getElementById('qr-modal').classList.remove('show');
}

function printQRCode() {
  const printWindow = window.open('', '_blank');
  const imgUrl = document.getElementById('qr-img-src').src;
  const name = document.getElementById('qr-title-name').textContent;
  const link = document.getElementById('qr-url-text').textContent;

  printWindow.document.write(`
    <html>
      <head>
        <title>Mã QR Chấm Công</title>
        
      </head>
      <body onload="window.print(); window.close();">
        <div class="container">
          <h2>${name}</h2>
          <img src="${imgUrl}" />
          <p><b>Link:</b> ${link}</p>
          <p style="font-size:11px; color:#aaa; margin-top:20px;">Quét mã này trên Safari iPhone ➔ Bấm nút Chia sẻ ➔ Chọn "Thêm vào MH chính" để cài đặt.</p>
        </div>
      </body>
    </html>
  `);
  printWindow.document.close();
}

function printAllQRCodes() {
  if (!allEmployees || allEmployees.length === 0) {
    alert('Không có danh sách nhân viên để in!');
    return;
  }

  // Đọc giá trị bộ lọc hiện tại để chỉ in những người đang hiển thị
  const filterDept = document.getElementById('filter-dept').value;
  const filterShift = document.getElementById('filter-shift').value;
  const filtered = allEmployees.filter(e => {
    if (filterDept !== 'all' && e.department !== filterDept) return false;
    if (filterShift !== 'all') {
      let lc = e.loai_ca ? e.loai_ca.toString().trim().toLowerCase() : 'tieu_chuan';
      if (lc.indexOf('1') !== -1 && lc !== 'ngoai_le_1') lc = 'ngoai_le_1';
      else if (lc.indexOf('2') !== -1 && lc !== 'ngoai_le_2') lc = 'ngoai_le_2';
      else if (lc === '') lc = 'tieu_chuan';
      if (lc !== filterShift) return false;
    }
    const st = e.status ? e.status.toString().trim().toLowerCase() : '';
    const isActive = !st || st.indexOf('đang') !== -1 || st.indexOf('active') !== -1 || st.indexOf('làm việc') !== -1 || st.indexOf('lam viec') !== -1;
    if (!isActive) return false; // Không in cho người đã nghỉ việc
    return true;
  });

  if (filtered.length === 0) {
    alert('Không có nhân viên nào phù hợp với bộ lọc hiện tại để in!');
    return;
  }

  const printWindow = window.open('', '_blank');
  let cardsHtml = '';

  filtered.forEach((e, index) => {
    if (!e.token) return; // Bỏ qua nhân viên chưa có token — tránh QR hỏng
    const linkUrl = `${appBaseUrl()}nv/${e.token}/`;
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(linkUrl)}`;

    cardsHtml += `
      <div class="qr-card">
        <h2>${e.name}</h2>
        <div class="dept">🏢 ${e.department || ''}</div>
        <img src="${qrApiUrl}" />
        <p><b>Link:</b> ${linkUrl}</p>
        <p class="guide">Quét mã này trên Safari iPhone ➔ Bấm nút Chia sẻ ➔ Chọn "Thêm vào MH chính" để cài đặt.</p>
      </div>
    `;

    // Ngắt trang sau mỗi 2 QR (hoặc 4 tùy bạn, ở đây 2 thẻ sẽ vừa 1 trang A4)
    if ((index + 1) % 2 === 0 && index !== filtered.length - 1) {
      cardsHtml += `<div class="page-break"></div>`;
    }
  });

  printWindow.document.write(`
    <html>
      <head>
        <title>In Hàng Loạt Mã QR Chấm Công</title>
        
      </head>
      <body>
        <h1 style="margin-bottom: 30px; color: #333;">MÃ QR CÀI ĐẶT APP CHẤM CÔNG</h1>
        ${cardsHtml}
        <!-- Dùng timeout nhỏ để đảm bảo API QR load xong hình ảnh trước khi gọi lệnh print -->
        <script>
          setTimeout(function() {
            window.print();
            window.close();
          }, 1500);
        <\/script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

// ============================================================
// TAB 3: QUẢN LÝ NGÀY NGHỈ LỄ
// ============================================================
async function loadHolidays() {
  const tbody = document.getElementById('holiday-table-body');
  tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">⏳ Đang tải dữ liệu ngày lễ...</td></tr>';

  try {
    const { data, error } = await supabaseClient
      .from('chamcong_holidays')
      .select('*')
      .order('date', { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#888;">📭 Danh sách trống. Hãy thêm ngày nghỉ lễ ở cột bên phải!</td></tr>';
      return;
    }

    let html = '';
    data.forEach(h => {
      const parts = h.date.split('-');
      const dateFmt = `${parts[2]}/${parts[1]}/${parts[0]}`;
      html += `
        <tr>
          <td style="font-weight:700; color:#c5221f;">📅 ${dateFmt}</td>
          <td style="font-weight:600; color:#3c4043;">🎉 ${h.description}</td>
          <td style="text-align: center;">
            <button class="btn btn-red" style="padding: 4px 8px; font-size:11px;" data-action="deleteHoliday" data-args="'${h.date}'">🗑️ Xóa</button>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:#c5221f;">❌ Lỗi: ${e.message}</td></tr>`;
  }
}

async function addHoliday() {
  const date = document.getElementById('hld-date').value;
  const desc = document.getElementById('hld-desc').value.trim();

  if (!date || !desc) { alert('Vui lòng chọn ngày và điền mô tả ngày lễ!'); return; }

  try {
    const { error } = await adminWrite('chamcong_holidays', 'insert', [{ date: date, description: desc }]);

    if (error) throw error;
    alert('✅ Đã thêm ngày nghỉ lễ thành công!');
    document.getElementById('hld-date').value = '';
    document.getElementById('hld-desc').value = '';
    loadHolidays();
  } catch(e) {
    alert('❌ Lỗi thêm ngày lễ: ' + e.message);
  }
}

async function deleteHoliday(date) {
  if (!confirm('Bạn có chắc chắn muốn xóa ngày nghỉ lễ ' + date + ' không?')) return;
  try {
    const { error } = await adminWrite('chamcong_holidays', 'delete', null, 'date', date);
    if (error) throw error;
    alert('🗑️ Đã xóa ngày nghỉ lễ thành công!');
    loadHolidays();
  } catch(e) {
    alert('❌ Lỗi khi xóa ngày lễ: ' + e.message);
  }
}

// ============================================================
// TAB 4: CÀI ĐẶT MỐC GIỜ CA LÀM VIỆC
// ============================================================
let allShifts = [];

async function loadShifts() {
  const tbody = document.getElementById('shift-table-body');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">⏳ Đang tải dữ liệu cấu hình ca...</td></tr>';

  try {
    const { data, error } = await supabaseClient
      .from('chamcong_shift_config')
      .select('*')
      .order('shift_type');

    if (error) throw error;
    allShifts = data || [];

    let html = '';
    allShifts.forEach(s => {
      const typeLabel = globalShiftTypes[s.shift_type] || s.shift_type;

      const sessionLabel = s.session === 'morning_in' ? '☀️ Sáng IN'
        : s.session === 'morning_out' ? '☀️ Sáng OUT'
        : s.session === 'afternoon_in' ? '🌤️ Chiều IN' : '🌤️ Chiều OUT';

      const fmtTime = t => t ? t.substring(0, 5) : '';
      let ruleLabel = '';
      if (s.session === 'morning_in' || s.session === 'afternoon_in') {
        const aVal = fmtTime(s.a_end);
        const bVal = fmtTime(s.b_end);
        ruleLabel = `Hợp lệ: ≤ <b>${aVal || 'N/A'}</b> [A] ${bVal ? `| Trễ: ≤ <b>${bVal}</b> [B]` : ''} | Đi muộn/Vắng: [D]`;
      } else if (s.session === 'morning_out') {
        const aStart = fmtTime(s.a_start);
        const aEnd2 = fmtTime(s.a_end2);
        ruleLabel = `Về sớm: < <b>${aStart || 'N/A'}</b> [B] | Về đúng: <b>${aStart || 'N/A'} ~ ${aEnd2 || 'N/A'}</b> [A] | Khác: [D]`;
      } else if (s.session === 'afternoon_out') {
        const aVal = fmtTime(s.a_end);
        ruleLabel = `Về sớm: < <b>${aVal || 'N/A'}</b> [B] | Về đúng: ≥ <b>${aVal || 'N/A'}</b> [A]`;
      }

      html += `
        <tr>
          <td style="font-weight:600;">${typeLabel}</td>
          <td style="font-weight:600;color:var(--primary);">${sessionLabel}</td>
          <td>${ruleLabel}</td>
          <td style="text-align: center;">
            <button class="btn btn-gray" style="padding: 4px 8px; font-size:11px;" data-action="editShiftConfig" data-args="'${s.id}'">✏️ Sửa mốc</button>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#c5221f;">❌ Lỗi: ${e.message}</td></tr>`;
  }
}

function editShiftConfig(id) {
  const shift = allShifts.find(s => s.id.toString() === id.toString());
  if (!shift) return;

  document.getElementById('shift-id').value = shift.id;
  document.getElementById('shift-type').value = shift.shift_type;
  document.getElementById('shift-session').value = shift.session;

  document.getElementById('shift-a-start').value = shift.a_start ? shift.a_start.substring(0, 5) : '';
  document.getElementById('shift-a-end').value = shift.a_end ? shift.a_end.substring(0, 5) : '';
  document.getElementById('shift-a-end2').value = shift.a_end2 ? shift.a_end2.substring(0, 5) : '';
  document.getElementById('shift-b-end').value = shift.b_end ? shift.b_end.substring(0, 5) : '';

  // Cấu hình nhãn động và ẩn/hiện các trường phù hợp với từng ca nhỏ
  const grpStart = document.getElementById('grp-shift-a-start');
  const grpEnd = document.getElementById('grp-shift-a-end');
  const grpEnd2 = document.getElementById('grp-shift-a-end2');
  const grpBEnd = document.getElementById('grp-shift-b-end');

  const lblStart = document.getElementById('lbl-shift-a-start');
  const lblEnd = document.getElementById('lbl-shift-a-end');
  const lblEnd2 = document.getElementById('lbl-shift-a-end2');
  const lblBEnd = document.getElementById('lbl-shift-b-end');

  if (grpStart) grpStart.style.display = 'none';
  if (grpEnd) grpEnd.style.display = 'none';
  if (grpEnd2) grpEnd2.style.display = 'none';
  if (grpBEnd) grpBEnd.style.display = 'none';

  if (shift.session === 'morning_in' || shift.session === 'afternoon_in') {
    if (grpEnd) { grpEnd.style.display = 'block'; lblEnd.textContent = 'Mốc đi đúng giờ (A)'; }
    if (grpBEnd) { grpBEnd.style.display = 'block'; lblBEnd.textContent = 'Mốc đi trễ tối đa (B)'; }
  } else if (shift.session === 'morning_out') {
    if (grpStart) { grpStart.style.display = 'block'; lblStart.textContent = 'Bắt đầu mốc về đúng (a_start)'; }
    if (grpEnd2) { grpEnd2.style.display = 'block'; lblEnd2.textContent = 'Kết thúc mốc về đúng (a_end2)'; }
  } else if (shift.session === 'afternoon_out') {
    if (grpEnd) { grpEnd.style.display = 'block'; lblEnd.textContent = 'Mốc bắt đầu về đúng (A)'; }
  }

  document.getElementById('btn-shift-save').disabled = false;
  document.getElementById('btn-shift-cancel').style.display = 'inline-flex';
  const delContainer = document.getElementById('delete-shift-container');
  if (delContainer) delContainer.style.display = 'block';
}

async function saveShiftConfig() {
  const id = document.getElementById('shift-id').value;
  const session = document.getElementById('shift-session').value;
  const a_start = document.getElementById('shift-a-start').value || null;
  const a_end = document.getElementById('shift-a-end').value || null;
  const a_end2 = document.getElementById('shift-a-end2').value || null;
  const b_end = document.getElementById('shift-b-end').value || null;

  // Validation
  if (session === 'morning_in' || session === 'afternoon_in') {
    if (a_end && b_end && a_end >= b_end) {
      alert('❌ Mốc Kết thúc B (đi trễ) phải lớn hơn mốc Kết thúc A (đi đúng giờ)!');
      return;
    }
  } else if (session === 'morning_out') {
    if (a_start && a_end2 && a_start >= a_end2) {
      alert('❌ Mốc Kết thúc 2 A phải lớn hơn mốc Bắt đầu A!');
      return;
    }
  } else if (session === 'afternoon_out') {
    if (a_end && a_end < '15:00') {
      alert('❌ Mốc Kết thúc A (về đúng giờ) của ca chiều thường phải >= 15:00!');
      return;
    }
  }

  try {
    const { error } = await adminWrite('chamcong_shift_config', 'update', {
        a_start: a_start ? a_start + ':00' : null,
        a_end: a_end ? a_end + ':00' : null,
        a_end2: a_end2 ? a_end2 + ':00' : null,
        b_end: b_end ? b_end + ':00' : null,
        updated_at: new Date().toISOString()
      }, 'id', id);

    if (error) throw error;
    alert('✅ Đã cập nhật mốc giờ ca thành công!');
    cancelShiftEdit();
    loadShifts();
  } catch(e) {
    alert('❌ Lỗi cập nhật ca: ' + e.message);
  }
}

function cancelShiftEdit() {
  document.getElementById('shift-id').value = '';
  document.getElementById('shift-type').value = '';
  document.getElementById('shift-session').value = '';
  document.getElementById('shift-a-start').value = '';
  document.getElementById('shift-a-end').value = '';
  document.getElementById('shift-a-end2').value = '';
  document.getElementById('shift-b-end').value = '';

  const grps = ['grp-shift-a-start', 'grp-shift-a-end', 'grp-shift-a-end2', 'grp-shift-b-end'];
  grps.forEach(g => {
    const el = document.getElementById(g);
    if (el) el.style.display = 'none';
  });

  document.getElementById('btn-shift-save').disabled = true;
  document.getElementById('btn-shift-cancel').style.display = 'none';
  const delContainer = document.getElementById('delete-shift-container');
  if (delContainer) delContainer.style.display = 'none';
}

async function addNewShift() {
  const typeId = document.getElementById('new-shift-type').value.trim();
  const typeName = document.getElementById('new-shift-name').value.trim();

  if (!typeId || !typeName) {
    alert('❌ Vui lòng nhập đầy đủ Mã ca và Tên ca!');
    return;
  }
  if (!/^[a-z0-9_]+$/.test(typeId)) {
    alert('❌ Mã ca chỉ được chứa chữ cái thường, số và dấu gạch dưới (VD: ca_trua)!');
    return;
  }
  if (globalShiftTypes[typeId]) {
    alert('❌ Mã ca này đã tồn tại!');
    return;
  }

  try {
    // 1. Cập nhật JSON cấu hình
    globalShiftTypes[typeId] = typeName;
    const { error: cfgErr } = await adminWrite('chamcong_system_config', 'upsert', {
      key: 'shift_types',
      value: JSON.stringify(globalShiftTypes),
      updated_at: new Date().toISOString()
    });
    if (cfgErr) throw cfgErr;

    // 2. Insert 4 dòng vào chamcong_shift_config
    const rows = ['morning_in', 'morning_out', 'afternoon_in', 'afternoon_out'].map(sess => ({
      shift_type: typeId,
      session: sess,
      a_start: null, a_end: null, a_end2: null, b_end: null
    }));

    // adminWrite 'insert' API expects array of objects
    const { error: insErr } = await adminWrite('chamcong_shift_config', 'insert', rows);
    if (insErr) throw insErr;

    alert('✅ Đã thêm ca làm việc mới thành công! Hãy điền các mốc giờ cho ca này.');
    document.getElementById('new-shift-type').value = '';
    document.getElementById('new-shift-name').value = '';

    populateShiftDropdowns(); // Update dropdowns
    loadShifts(); // Reload table
  } catch(e) {
    alert('❌ Lỗi thêm ca mới: ' + e.message);
  }
}

async function deleteShift() {
  const shiftType = document.getElementById('shift-type').value;
  if (!shiftType) return;
  if (shiftType === 'tieu_chuan') {
    alert('❌ Không thể xóa Ca Tiêu chuẩn (ca mặc định của hệ thống)!');
    return;
  }

  // Kiểm tra xem có nhân viên nào đang dùng ca này không
  const { data: emps, error: empErr } = await supabaseClient
    .from('chamcong_employees')
    .select('name')
    .eq('loai_ca', shiftType)
    .limit(1);

  if (empErr) {
    alert('❌ Lỗi kiểm tra nhân viên: ' + empErr.message);
    return;
  }
  if (emps && emps.length > 0) {
    alert('❌ Không thể xóa! Đang có nhân viên được gán ca này. Hãy đổi ca cho nhân viên trước.');
    return;
  }

  if (!confirm(`Bạn có chắc chắn muốn xóa TOÀN BỘ cấu hình của ca "${globalShiftTypes[shiftType] || shiftType}" không?`)) return;

  try {
    // 1. Xóa 4 dòng trong chamcong_shift_config
    const { error: delErr } = await adminWrite('chamcong_shift_config', 'delete', null, 'shift_type', shiftType);
    if (delErr) throw delErr;

    // 2. Cập nhật JSON cấu hình
    delete globalShiftTypes[shiftType];
    const { error: cfgErr } = await adminWrite('chamcong_system_config', 'upsert', {
      key: 'shift_types',
      value: JSON.stringify(globalShiftTypes),
      updated_at: new Date().toISOString()
    });
    if (cfgErr) throw cfgErr;

    alert('✅ Đã xóa ca làm việc thành công!');
    cancelShiftEdit();
    populateShiftDropdowns();
    loadShifts();
  } catch(e) {
    alert('❌ Lỗi xóa ca: ' + e.message);
  }
}

// ============================================================
// TAB 5: QUẢN LÝ HƯỚNG DẪN APP
// ============================================================
let allGuides = [];

async function loadGuideContent() {
  const tbody = document.getElementById('guide-table-body');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">⏳ Đang tải bài hướng dẫn...</td></tr>';

  try {
    const { data, error } = await supabaseClient
      .from('chamcong_guide_content')
      .select('*')
      .order('id');

    if (error) throw error;
    allGuides = data || [];

    if (allGuides.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#888;">📭 Danh sách hướng dẫn trống. Vui lòng chạy SQL tạo bảng.</td></tr>';
      return;
    }

    let html = '';
    allGuides.forEach(g => {
      const updatedDate = g.updated_at ? new Date(g.updated_at).toLocaleString('vi-VN') : '';
      html += `
        <tr>
          <td style="font-weight:700;color:var(--primary);">${g.id}</td>
          <td style="font-weight:600;">${g.title}</td>
          <td style="color:#666; font-size:12px;">${updatedDate}</td>
          <td style="text-align: center;">
            <button class="btn btn-gray" style="padding: 4px 12px; font-size:11px;" data-action="editGuideContent" data-args="'${g.id}'">✏️ Sửa bài viết</button>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#c5221f;">❌ Lỗi: ${e.message}</td></tr>`;
  }
}

function editGuideContent(id) {
  const guide = allGuides.find(g => g.id === id);
  if (!guide) return;

  document.getElementById('guide-id').value = guide.id;
  document.getElementById('guide-title').value = guide.title;
  document.getElementById('guide-content').value = guide.content || '';

  document.getElementById('guide-form-title').textContent = `📝 Đang sửa: Trang ${guide.id}`;
  document.getElementById('btn-guide-save').disabled = false;
  document.getElementById('btn-guide-cancel').style.display = 'inline-flex';
}

async function saveGuideContent() {
  const id = document.getElementById('guide-id').value;
  const title = document.getElementById('guide-title').value.trim();
  const content = document.getElementById('guide-content').value.trim();

  if (!title || !content) { alert('Tiêu đề và nội dung không được để trống!'); return; }

  try {
    const { error } = await adminWrite('chamcong_guide_content', 'update', {
        title: title,
        content: content,
        updated_at: new Date().toISOString()
      }, 'id', id);

    if (error) throw error;
    alert('✅ Đã cập nhật bài hướng dẫn thành công! Mọi nhân viên mở app sẽ thấy ngay lập tức.');
    cancelGuideEdit();
    loadGuideContent();
  } catch(e) {
    alert('❌ Lỗi cập nhật hướng dẫn: ' + e.message);
  }
}

function cancelGuideEdit() {
  document.getElementById('guide-id').value = '';
  document.getElementById('guide-title').value = '';
  document.getElementById('guide-content').value = '';

  document.getElementById('guide-form-title').textContent = '📝 Cập nhật nội dung hướng dẫn';
  document.getElementById('btn-guide-save').disabled = true;
  document.getElementById('btn-guide-cancel').style.display = 'none';
}

// Xử lý nạp ảnh local và đổi tên file tự động
function handleImageSelected() {
  const imgInput = document.getElementById('imageInput');
  const nameInput = document.getElementById('imageName');
  if (imgInput.files.length > 0) {
    const file = imgInput.files[0];
    nameInput.value = file.name.replace(/\s+/g, '_'); // Đổi khoảng trắng thành gạch dưới cho chuẩn link URL
  }
}

// Gọi API GitHub upload ảnh
async function uploadImageToGithub() {
  const imgInput = document.getElementById('imageInput');
  const nameInput = document.getElementById('imageName');
  const statusEl = document.getElementById('image-upload-status');

  if (imgInput.files.length === 0) {
    alert('Vui lòng chọn 1 file ảnh từ máy tính trước!');
    return;
  }
  const filename = nameInput.value.trim();
  if (!filename) {
    alert('Vui lòng điền tên file ảnh để lưu trên GitHub!');
    return;
  }

  const ghUser = document.getElementById('ghUser').value.trim();
  const ghRepo = document.getElementById('ghRepo').value.trim();
  const ghBranch = document.getElementById('ghBranch').value.trim();
  const ghToken = document.getElementById('ghToken').value.trim();

  if(!ghUser || !ghRepo || !ghToken) {
    alert('Vui lòng cấu hình đầy đủ GitHub Token ở tab Cấu Hình để upload ảnh!');
    return;
  }

  const btn = document.getElementById('btnUploadImage');
  btn.disabled = true;
  btn.textContent = '⏳ Đang tải ảnh lên GitHub...';
  statusEl.innerHTML = '';

  try {
    const file = imgInput.files[0];
    const reader = new FileReader();

    reader.onload = async function(e) {
      // Chuyển kết quả đọc file sang base64 nguyên dạng
      const base64Data = e.target.result.split(',')[1];
      const path = `img/${filename}`;
      const url = `https://api.github.com/repos/${ghUser}/${ghRepo}/contents/${path}`;

      // Check xem ảnh đã tồn tại chưa để lấy SHA
      let sha = null;
      const checkRes = await fetch(url + `?ref=${ghBranch}`, {
        headers: { 'Authorization': `Bearer ${ghToken}` }
      });
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        sha = checkData.sha;
      }

      const body = {
        message: `Upload guide image: ${filename}`,
        content: base64Data,
        branch: ghBranch
      };
      if (sha) body.sha = sha;

      const putRes = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${ghToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      btn.disabled = false;
      btn.textContent = '⬆️ Tải Ảnh Lên GitHub';

      if (putRes.ok) {
        const fullImgUrl = `https://${ghUser}.github.io/${ghRepo}/img/${filename}`;
        statusEl.innerHTML = `<span style="color:#137333; font-weight:700;">✅ Tải ảnh thành công!</span><br>`
          + `<span style="color:#555;">Đường dẫn ảnh:</span><br>`
          + `<a href="${fullImgUrl}" target="_blank" style="color:var(--primary); font-weight:600; text-decoration:none;">${fullImgUrl}</a><br>`
          + `<small style="color:#888;">Hãy copy link trên dán vào thẻ &lt;img src="link_ảnh"&gt; trong bài viết hướng dẫn.</small>`;

        // Reset file input
        imgInput.value = '';
        nameInput.value = '';
      } else {
        const errData = await putRes.json();
        statusEl.innerHTML = `<span style="color:#c5221f; font-weight:700;">❌ Lỗi: ${errData.message || 'Không thể upload'}</span>`;
      }
    };

    // Đọc ảnh dưới dạng DataURL để convert base64
    reader.readAsDataURL(file);

  } catch(err) {
    btn.disabled = false;
    btn.textContent = '⬆️ Tải Ảnh Lên GitHub';
    statusEl.innerHTML = `<span style="color:#c5221f; font-weight:700;">❌ Lỗi: ${err.message}</span>`;
  }
}

// ============================================================
// TIẾN TRÌNH GENERATOR PWA & UPLOAD GITHUB (TAB DEPLOY)
// ============================================================
let htmlTemplate = '';
let selectedFileTime = null; // Thời gian file được nạp vào browser
let selectedFileName = '';

function handleFileSelected() {
  const fileInput = document.getElementById('fileInput');
  const label = document.getElementById('file-info-label');
  if (fileInput.files.length > 0) {
    const file = fileInput.files[0];
    selectedFileName = file.name;

    // Lấy thời gian hiện tại lúc nạp file vào trình duyệt
    const now = new Date();
    selectedFileTime = now.toLocaleTimeString('vi-VN') + ' ngày ' + now.toLocaleDateString('vi-VN');

    label.style.display = 'block';
    label.style.color = '#137333';
    label.style.background = '#e6f4ea';
    label.innerHTML = `🟢 <b>Đã nạp file:</b> ${file.name}<br>⏰ <b>Lúc nạp:</b> ${selectedFileTime}<br><small style="color:#555;"><i>(Nếu bạn vừa chỉnh sửa file trên ổ cứng, hãy bấm chọn lại file để nạp bản mới)</i></small>`;

    log(`Đã nạp file ${file.name} thành công lúc ${selectedFileTime}.`);
  } else {
    selectedFileTime = null;
    label.style.display = 'none';
  }
}

async function startDeployProcess() {
  if (!_isClientReady) {
    log('Lỗi: Chưa kết nối Supabase. Vui lòng cấu hình ở tab Cấu Hình!', 'error');
    return;
  }

  const ghUser = document.getElementById('ghUser').value.trim();
  const ghRepo = document.getElementById('ghRepo').value.trim();

  if(!ghUser || !ghRepo) {
    log('Lỗi: Vui lòng cấu hình GitHub Username và Repository ở tab Cấu Hình!', 'error');
    return;
  }

  const confirmMsg = `🚀 BẮT ĐẦU ĐỒNG BỘ VÀ DEPLOY HỆ THỐNG:\n\n`
    + `• GitHub Repository: ${ghUser}/${ghRepo}\n\n`
    + `Tiến trình sẽ kích hoạt GitHub Actions để tự động đồng bộ file PWA cá nhân và cập nhật mã nguồn.\n`
    + `Bạn có chắc chắn muốn tiến hành?`;

  if (!confirm(confirmMsg)) {
    log('Đã hủy tiến trình Deploy.', 'warn');
    return;
  }

  const btnStart = document.getElementById('btnStart');
  if (btnStart) {
    btnStart.disabled = true;
    btnStart.innerHTML = '⏳ Đang kích hoạt Deploy...';
  }
  clearConsole();
  log('Đang gửi tín hiệu kích hoạt GitHub Actions Deploy...', 'info');

  try {
    const { triggerDeploy } = await import('./api.js');
    const res = await triggerDeploy(ghUser, ghRepo);
    if (res.error) throw new Error(res.error);

    log('✅ Đã kích hoạt GitHub Action Deploy thành công!', 'success');
    log('Tiến trình deploy đang chạy ngầm trên GitHub. Bạn có thể kiểm tra tab Actions trên GitHub để xem trực tiếp.', 'info');
  } catch (e) {
    log('❌ Lỗi kích hoạt Deploy: ' + e.message, 'error');
  } finally {
    if (btnStart) {
      btnStart.disabled = false;
      btnStart.innerHTML = '🚀 Bắt đầu cập nhật & Deploy PWA';
    }
  }
}


// ============================================================
// TAB: DỮ LIỆU CHẤM CÔNG (attendance_logs)
// ============================================================
let allAttendanceLogs = [];
let _attInit = false;

function _attPad(n){ return n < 10 ? '0' + n : '' + n; }
function escAttr(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escHtmlA(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Múi giờ Việt Nam = UTC+7 (không có DST)
const VN_OFFSET_MIN = 7 * 60;

// Chuỗi timestamp (UTC) -> các thành phần giờ Việt Nam
function toVNParts(s){
  let str = String(s || '').trim();
  if(!str) return null;
  str = str.replace(' ', 'T');
  // Nếu chuỗi không kèm thông tin múi giờ -> coi như UTC
  if(!/([zZ]|[+\-]\d{2}:?\d{2})$/.test(str)) str += 'Z';
  const inst = new Date(str);
  if(isNaN(inst.getTime())) return null;
  const vn = new Date(inst.getTime() + VN_OFFSET_MIN * 60000); // cộng 7 giờ
  return {
    y: vn.getUTCFullYear(), mo: vn.getUTCMonth() + 1, d: vn.getUTCDate(),
    h: vn.getUTCHours(), mi: vn.getUTCMinutes(), s: vn.getUTCSeconds()
  };
}

// Giờ Việt Nam (chuỗi datetime-local "YYYY-MM-DDTHH:MM[:SS]") -> chuỗi UTC để lưu
function vnLocalToUTCString(localStr){
  const m = String(localStr).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if(!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], s = m[6] ? +m[6] : 0;
  // Coi các thành phần là giờ VN -> đổi sang mốc UTC bằng cách trừ 7 giờ
  const utcMs = Date.UTC(y, mo - 1, d, h, mi, s) - VN_OFFSET_MIN * 60000;
  const u = new Date(utcMs);
  return `${u.getUTCFullYear()}-${_attPad(u.getUTCMonth() + 1)}-${_attPad(u.getUTCDate())}T`
    + `${_attPad(u.getUTCHours())}:${_attPad(u.getUTCMinutes())}:${_attPad(u.getUTCSeconds())}+00:00`;
}

// Hiển thị ngày/giờ theo giờ Việt Nam
function fmtCheckedAt(s){
  const p = toVNParts(s);
  if(!p) return { date:'—', time:'—' };
  return {
    date: `${_attPad(p.d)}/${_attPad(p.mo)}/${p.y}`,
    time: `${_attPad(p.h)}:${_attPad(p.mi)}:${_attPad(p.s)}`
  };
}

async function loadAttendanceLogs(){
  if(!_isClientReady){ alert('Vui lòng kết nối Supabase ở tab "Cấu Hình Hệ Thống" trước!'); return; }

  const mSel = document.getElementById('att-month');
  const ySel = document.getElementById('att-year');
  // Lần đầu mở tab -> mặc định tháng hiện tại
  if(!_attInit){
    const now = new Date();
    mSel.value = String(now.getMonth() + 1);
    ySel.value = String(now.getFullYear());
    _attInit = true;
  }
  const month = parseInt(mSel.value, 10);
  const year  = parseInt(ySel.value, 10);
  const mm = _attPad(month);
  const daysInMonth = new Date(year, month, 0).getDate();
  const start = `${year}-${mm}-01T00:00:00+07:00`;
  const end   = `${year}-${mm}-${_attPad(daysInMonth)}T23:59:59+07:00`;

  const tbody = document.getElementById('att-table-body');
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">⏳ Đang tải dữ liệu chấm công...</td></tr>';

  try {
    const { data, error } = await supabaseClient
      .from('chamcong_attendance_logs')
      .select('*')
      .gte('checked_at', start)
      .lte('checked_at', end)
      .order('checked_at', { ascending: false });
    if(error) throw error;

    allAttendanceLogs = data || [];
    document.getElementById('att-range').textContent = `Kỳ: Tháng ${mm}/${year}`;
    populateAttEmpFilter();
    renderAttendanceTable();
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#c5221f;">❌ Lỗi tải dữ liệu: ${escHtmlA(e.message)}</td></tr>`;
  }
}

function populateAttEmpFilter(){
  const sel = document.getElementById('att-emp');
  const cur = sel.value;
  const names = [...new Set(allAttendanceLogs.map(l => l.employee_name).filter(Boolean))]
    .sort((a,b) => a.localeCompare(b, 'vi'));
  let html = '<option value="all">👥 Tất cả nhân viên</option>';
  names.forEach(n => html += `<option value="${escAttr(n)}">${escHtmlA(n)}</option>`);
  sel.innerHTML = html;
  if(cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
}

function renderAttendanceTable(){
  const tbody = document.getElementById('att-table-body');
  const empFilter = document.getElementById('att-emp').value;

  let rows = allAttendanceLogs;
  if(empFilter && empFilter !== 'all') rows = rows.filter(l => l.employee_name === empFilter);

  document.getElementById('att-count').textContent = rows.length;

  if(rows.length === 0){
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#888;">📭 Không có dữ liệu chấm công trong kỳ này.</td></tr>';
    return;
  }

  let html = '';
  rows.forEach((l, i) => {
    const t = fmtCheckedAt(l.checked_at);
    const lat = l.latitude, lng = l.longitude;
    const hasGeo = lat != null && lng != null && lat !== '' && lng !== '';
    const maps = hasGeo
      ? `<a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" style="color:var(--primary);text-decoration:none;">📍 ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}</a>`
      : '<span style="color:#aaa;">—</span>';
    const addr = l.address ? escHtmlA(l.address) : '<span style="color:#aaa;">—</span>';
    const office = l.nearest_office ? `<div style="font-size:11px;color:#5f6368;margin-top:2px;">🏢 ${escHtmlA(l.nearest_office)}</div>` : '';
    const dist = (l.distance != null && l.distance !== '') ? `${l.distance} m` : '—';

    const st = (l.status || '').toString();
    const stLc = st.toLowerCase();
    let stBadge;
    if(stLc.includes('hợp lệ') && !stLc.includes('không')) stBadge = '<span class="badge badge-success">✓ Hợp lệ</span>';
    else if(st) stBadge = `<span class="badge badge-danger">${escHtmlA(st)}</span>`;
    else stBadge = '<span class="badge badge-warning">—</span>';

    html += `
      <tr>
        <td>${i + 1}</td>
        <td style="font-weight:600;color:#202124;">${escHtmlA(l.employee_name || '—')}</td>
        <td><div style="font-weight:600;">🕒 ${t.time}</div><div style="font-size:11px;color:#5f6368;">${t.date}</div></td>
        <td style="max-width:280px;">${addr}${office}</td>
        <td style="font-family:monospace;font-size:12px;">${maps}</td>
        <td>${dist}</td>
        <td>${stBadge}</td>
        <td style="max-width:160px;color:#5f6368;">${l.note ? escHtmlA(l.note) : '—'}</td>
        <td style="text-align:center;">
          <button class="btn btn-gray" style="padding:4px 10px;font-size:11px;" onclick="openLogEdit('${escAttr(l.id)}')">✏️ Sửa</button>
        </td>
      </tr>`;
  });
  tbody.innerHTML = html;
}

function _setSelectValue(sel, val){
  if(![...sel.options].some(o => o.value === val)){
    const o = document.createElement('option'); o.value = val; o.textContent = val; sel.appendChild(o);
  }
  sel.value = val;
}

function openLogEdit(id){
  const l = allAttendanceLogs.find(x => String(x.id) === String(id));
  if(!l) return;

  document.getElementById('log-id').value = l.id;

  // Dropdown nhân viên
  const empSel = document.getElementById('log-emp');
  let names = [...new Set(allAttendanceLogs.map(x => x.employee_name).filter(Boolean))];
  if(l.employee_name && !names.includes(l.employee_name)) names.push(l.employee_name);
  names.sort((a,b) => a.localeCompare(b, 'vi'));
  empSel.innerHTML = names.map(n => `<option value="${escAttr(n)}">${escHtmlA(n)}</option>`).join('');
  empSel.value = l.employee_name || '';

  // Thời gian: hiển thị theo giờ Việt Nam để admin nhập trực tiếp
  const vp = toVNParts(l.checked_at);
  const timeInput = document.getElementById('log-time');
  timeInput.value = vp
    ? `${vp.y}-${_attPad(vp.mo)}-${_attPad(vp.d)}T${_attPad(vp.h)}:${_attPad(vp.mi)}:${_attPad(vp.s)}`
    : '';

  document.getElementById('log-lat').value = (l.latitude ?? '');
  document.getElementById('log-lng').value = (l.longitude ?? '');
  document.getElementById('log-address').value = l.address || '';
  document.getElementById('log-office').value = l.nearest_office || '';
  document.getElementById('log-note').value = l.note || '';
  _setSelectValue(document.getElementById('log-status'), l.status || 'Hợp lệ');

  document.getElementById('logEditModal').classList.add('show');
}

function closeLogModal(){
  document.getElementById('logEditModal').classList.remove('show');
}

async function saveLogEdit(){
  const id = document.getElementById('log-id').value;
  const timeInput = document.getElementById('log-time');
  let timeVal = timeInput.value;
  if(!timeVal){ alert('⚠️ Vui lòng nhập thời gian chấm công.'); return; }
  // timeVal là GIỜ VIỆT NAM -> đổi sang UTC để lưu (tự động, không cần trừ tay)
  const checked_at = vnLocalToUTCString(timeVal);
  if(!checked_at){ alert('⚠️ Thời gian không hợp lệ.'); return; }

  const latRaw = document.getElementById('log-lat').value.trim();
  const lngRaw = document.getElementById('log-lng').value.trim();

  const payload = {
    employee_name: document.getElementById('log-emp').value,
    checked_at: checked_at,
    latitude:  latRaw === '' ? null : Number(latRaw),
    longitude: lngRaw === '' ? null : Number(lngRaw),
    address: document.getElementById('log-address').value.trim() || null,
    nearest_office: document.getElementById('log-office').value.trim() || null,
    status: document.getElementById('log-status').value,
    note: document.getElementById('log-note').value.trim() || null
  };

  try {
    const { error } = await adminWrite('chamcong_attendance_logs', 'update', payload, 'id', id);
    if(error) throw error;
    const l = allAttendanceLogs.find(x => String(x.id) === String(id));
    if(l) Object.assign(l, payload);
    closeLogModal();
    populateAttEmpFilter();
    renderAttendanceTable();
    alert('✅ Đã cập nhật lượt chấm công.');
  } catch(e) {
    alert('❌ Lỗi cập nhật: ' + e.message);
  }
}

async function deleteLog(){
  const id = document.getElementById('log-id').value;
  if(!confirm('Bạn chắc chắn muốn XÓA lượt chấm công này? Hành động không thể hoàn tác.')) return;
  try {
    const { error } = await adminWrite('chamcong_attendance_logs', 'delete', null, 'id', id);
    if(error) throw error;
    allAttendanceLogs = allAttendanceLogs.filter(x => String(x.id) !== String(id));
    closeLogModal();
    populateAttEmpFilter();
    renderAttendanceTable();
    alert('🗑️ Đã xóa lượt chấm công.');
  } catch(e) {
    alert('❌ Lỗi xóa: ' + e.message);
  }
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
    switchTab: () => switchTab(args[0], target),
    adminLogin: () => adminLogin(),
    startDeployTestProcess: () => startDeployTestProcess(),
    startDeployProcess: () => startDeployProcess(),
    clearConsole: () => clearConsole(),
    printAllQRCodes: () => printAllQRCodes(),
    saveEmployee: () => saveEmployee(),
    cancelEmployeeEdit: () => cancelEmployeeEdit(),
    addHoliday: () => addHoliday(),
    saveShiftConfig: () => saveShiftConfig(),
    cancelShiftEdit: () => cancelShiftEdit(),
    addNewShift: () => addNewShift(),
    deleteShift: () => deleteShift(),
    saveGuideContent: () => saveGuideContent(),
    cancelGuideEdit: () => cancelGuideEdit(),
    uploadImageToGithub: () => uploadImageToGithub(),
    updatePassword: () => updatePassword(args[0], args[1]),
    saveAccount: () => saveAccount(),
    deleteAccount: () => deleteAccount(args[0], args[1]),
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
    exportPrintReportAll: () => exportPrintReportAll(),
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
  const pwInput = document.getElementById('admin-pw-input');
  if (pwInput) {
    pwInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        adminLogin();
      }
    });
  }
}

// Expose các hàm được gọi từ inline handler (onchange/onclick trong HTML tĩnh & HTML do JS
// sinh ra) ra global scope — ES module không tự đặt hàm lên window.
Object.assign(window, {
  renderEmployeeTable, handleImageSelected, loadAttendanceLogs, renderAttendanceTable, openLogEdit
});
