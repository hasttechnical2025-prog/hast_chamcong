// ============================================================
// CẤU HÌNH CỐ ĐỊNH
// ============================================================
const SHEET_ID         = '1f4fTjTE03dnv26OUJhhzCu6GImLQ7-7aC7TKPQqsIcE';
const TELEGRAM_TOKEN   = '8782519076:AAEN1ESG-RQHQvldhVXrugwJ9GOxpvN-g10'; // ← Token bot Telegram
// ── Mật khẩu đa cấp cho trang duyệt giải trình ────────────
// Mỗi entry: { pw, dept, isAdmin }
//   dept=''        → admin, xem được tất cả phòng ban
//   dept='Tên PB'  → TBP, chỉ xem phòng ban đó
//   isAdmin=true   → được chọn phòng ban tự do
const ADMIN_PASSWORD   = 'hstc2026'; // Dùng cho các check đơn giản (batchApprove, approveGiaiTrinh)
const ADMIN_USERS = [
  { pw: 'kinhdoanh_pw2026',    dept: 'Kinh doanh',           isAdmin: false }, // TBP Kinh doanh
  { pw: 'kthc_pw2026',    dept: 'Kế toán-Hành chính',   isAdmin: false }, // TBP Kế toán-HC
  { pw: 'admin_kt2026',  dept: '',                      isAdmin: true  }, // Admin Kỹ thuật
];

// Hàm xác thực password → trả về user info hoặc null
function authUser(pw) {
  if (!pw) return null;
  for (var i = 0; i < ADMIN_USERS.length; i++) {
    if (ADMIN_USERS[i].pw === pw.trim()) return ADMIN_USERS[i];
  }
  return null;
}
const SHEET_NAME       = 'Responses';       // Sheet ghi raw data từ app
const STAFF_SHEET_NAME = 'DS CBNV';
const SUMMARY_SHEET    = 'Tổng hợp';        // Sheet đã làm sạch — dùng để hiển thị
const SETTINGS_SHEET   = 'Settings';

const OFFICE_LOCATIONS = [
  { name: 'Siêu Thanh Hà Nội', lat: 21.0085811017119, lng: 105.813012926862, radius: 200 },
];

// ============================================================
// VỊ TRÍ CỘT CỐ ĐỊNH TRONG SHEET TỔNG HỢP (1-based)
// A=1  B=2     C=3    D=4       E=5        F=6       G=7        H=8             I=9      J=10
// ID | Họ tên | Ngày | Sáng IN | Sáng OUT | Chiều IN | Chiều OUT | Đánh giá công | Ghi chú | Lý do
// ============================================================
const COL = {
  ID:           1,
  NAME:         2,
  DATE:         3,
  M_IN:         4,  // Sáng IN
  M_OUT:        5,  // Sáng OUT
  A_IN:         6,  // Chiều IN
  A_OUT:        7,  // Chiều OUT
  GRADE:        8,  // Đánh giá công
  NOTE:         9,  // Ghi chú
  REASON:       10, // Cột J — CHỈ ĐỌC để hiển thị
  APPROVE:      11, // Cột K — Kết quả duyệt
  REASON_SAVE:  18, // Cột R — GHI giải trình từ app
  APPROVE_NOTE: 19, // Cột S — Ghi chú TBP
  APPROVE_TIME: 20, // Cột T — Thời gian duyệt
};

// Dòng header và dòng bắt đầu dữ liệu
const HEADER_ROW = 4;
const DATA_START  = 5;

// Ô chứa tháng và năm
const MONTH_CELL = 'F2';
const YEAR_CELL  = 'H2';

// ============================================================
// ĐỌC CÀI ĐẶT GIỜ
// ============================================================
function getSettings() {
  var d = {
    ca1_a_before: '08:05', ca1_b_before: '09:30',
    ca2_b_from:   '09:30', ca2_a_from:   '12:00', ca2_a_to: '12:45',
    ca3_a_from:   '12:46', ca3_a_to:     '13:05', ca3_b_to: '15:00',
    ca4_b_from:   '15:00', ca4_a_from:   '17:00',
  };
  try {
    var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SETTINGS_SHEET);
    if (!sheet) return d;
    sheet.getDataRange().getValues().forEach(function(r) {
      var k = (r[0]||'').toString().trim();
      var v = (r[1]||'').toString().trim();
      if (k && v && d.hasOwnProperty(k)) d[k] = v;
    });
  } catch(e) {}
  return d;
}

// ============================================================
// ĐỊNH DẠNG GIỜ từ ô Sheets
// Sheets trả về Date object cho ô thời gian
// ô trống hoặc ": :" → trả về ""
// ============================================================
function fmtTime(val) {
  if (val === null || val === undefined || val === '') return '';
  if (val instanceof Date) {
    // Kiểm tra có phải 00:00:00 không (ô trống dạng Date)
    var h = val.getHours(), m = val.getMinutes(), s = val.getSeconds();
    // Nếu là 00:00:00 → có thể là ô trống, trả về ''
    // Nhưng nếu ai checkin lúc 00:xx thì sẽ mất → kiểm tra thêm
    if (h === 0 && m === 0 && s === 0) return '';
    return pad(h) + ':' + pad(m) + ':' + pad(s);
  }
  var str = val.toString().trim();
  // Loại bỏ các giá trị rỗng như ": :" hay ":"
  if (str === '' || str === ':' || str === ': :' || str === '--:--') return '';
  return str;
}

function fmtDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return pad(val.getDate())+'/'+pad(val.getMonth()+1)+'/'+val.getFullYear();
  }
  return val.toString().trim();
}

function pad(n) { return n < 10 ? '0'+n : ''+n; }

// ============================================================
// doGet
// ============================================================
function doGet(e) {
  var action = (e.parameter.action || '').trim();
  var name   = (e.parameter.name   || '').trim();

  if (action === 'history' && name) {
    return ContentService
      .createTextOutput(JSON.stringify(getPersonalHistory(name)))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'checkHoliday') {
    return ContentService
      .createTextOutput(JSON.stringify(checkTodayHoliday()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getGiaiTrinhList') {
    var pw    = (e.parameter.pw    || '').trim();
    var month = parseInt(e.parameter.month || 0);
    var year  = parseInt(e.parameter.year  || 0);
    var user  = authUser(pw);
    if (!user) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, error: 'Sai mật khẩu' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
	// Truyền dept của user vào hàm (TBP chỉ thấy phòng mình)
    return ContentService
      .createTextOutput(JSON.stringify(getGiaiTrinhList(month, year, user)))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'approveGiaiTrinh') {
    var pw       = (e.parameter.pw       || '').trim();
    var rowIndex = parseInt(e.parameter.rowIndex || 0);
    var approve  = decodeURIComponent(e.parameter.approve  || '').trim();
    var note     = decodeURIComponent(e.parameter.note     || '').trim();
    if (!authUser(pw)) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, error: 'Sai mật khẩu' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
	
    return ContentService
      .createTextOutput(JSON.stringify(approveGiaiTrinh(rowIndex, approve, note)))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'batchApprove') {
    var pw        = (e.parameter.pw    || '').trim();
    var itemsJson = (e.parameter.items || '[]');
    if (!authUser(pw)) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, error: 'Sai mật khẩu' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService
      .createTextOutput(JSON.stringify(batchApprove(itemsJson)))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getAttendanceToday' && name) {
    return ContentService
      .createTextOutput(JSON.stringify(getAttendanceToday(name)))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// doPost
// ============================================================
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.action === 'saveGiaiTrinh') {
      var result = saveGiaiTrinh(data.name, data.date, data.reason);
      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var result = saveAttendance(data);
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================================
// LẤY LỊCH SỬ TỪ SHEET TỔNG HỢP
// ============================================================
function getPersonalHistory(name) {
  try {
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SUMMARY_SHEET);
    if (!sheet) return { success:false, error:'Không tìm thấy sheet "Tổng hợp"' };

    // Lấy tháng/năm từ ô F2, H2
    var filterMonth = parseInt(sheet.getRange(MONTH_CELL).getValue()) || new Date().getMonth()+1;
    var filterYear  = parseInt(sheet.getRange(YEAR_CELL).getValue())  || new Date().getFullYear();

    var lastRow = sheet.getLastRow();
    if (lastRow < DATA_START)
      return { success:true, name:name, month:filterMonth, year:filterYear,
               total:0, fullDays:0, absentDays:0, partialDays:0, days:[] };

    // Đọc toàn bộ dữ liệu từ DATA_START
    var numRows = lastRow - DATA_START + 1;
    var numCols = Math.max(COL.NOTE, sheet.getLastColumn());
    var data    = sheet.getRange(DATA_START, 1, numRows, numCols).getValues();

    var nameLower = name.trim().toLowerCase();
    var days = [];

    data.forEach(function(row) {
      // Bỏ dòng trống
      var rName = (row[COL.NAME-1]||'').toString().trim();
      if (!rName) return;
      if (rName.toLowerCase() !== nameLower) return;

      var dateVal     = row[COL.DATE-1];
      var dateStr     = fmtDate(dateVal);
      if (!dateStr) return;

      var morningIn   = fmtTime(row[COL.M_IN  -1]);
      var morningOut  = fmtTime(row[COL.M_OUT -1]);
      var afternoonIn = fmtTime(row[COL.A_IN  -1]);
      var afternoonOut= fmtTime(row[COL.A_OUT -1]);
      var gradesRaw   = (row[COL.GRADE-1]||'').toString().trim();
      var note        = (row[COL.NOTE -1]||'').toString().trim();

      // Parse đánh giá: "B, A, A, A" → g1=B g2=A g3=A g4=A
      var ga    = gradesRaw.split(',').map(function(g){ return g.trim().toUpperCase(); });
      var g1 = ga[0]||'D', g2 = ga[1]||'D', g3 = ga[2]||'D', g4 = ga[3]||'D';

      var allOk    = g1==='A' && g2==='A' && g3==='A' && g4==='A';
      var hasAbsent= g1==='D' && g2==='D' && g3==='D' && g4==='D';

      var reason  = COL.REASON <= row.length ? (row[COL.REASON-1]||'').toString().trim() : '';
      var approve = numCols >= COL.APPROVE  ? (row[COL.APPROVE-1]||'').toString().trim()  : '';

      days.push({
        date:        dateStr,
        morningIn:   morningIn,
        morningOut:  morningOut,
        afternoonIn: afternoonIn,
        afternoonOut:afternoonOut,
        grades:      gradesRaw,
        g1:g1, g2:g2, g3:g3, g4:g4,
        allOk:    allOk,
        hasAbsent:hasAbsent,
        note:     note,
        reason:   reason,
        approve:  approve
      });
    });

    // Lấy ngày nghỉ lễ từ sheet Cài đặt (object: {dateStr: label})
    var holidaysMap = getHolidays(filterMonth, filterYear);
    var holidayArr  = getHolidayArray(holidaysMap);

    var today    = new Date();
    var todayStr = pad(today.getDate())+'/'+pad(today.getMonth()+1)+'/'+today.getFullYear();

    // ── Công chuẩn = tổng ngày T2-T6 trong tháng (không trừ lễ)
    var congChuan = calcCongChuan(filterMonth, filterYear);

    // ── Lọc chỉ đến hôm nay
    var daysUntilToday = days.filter(function(d){
      return compareDateStr(d.date, todayStr) <= 0;
    });

    // ── Đánh dấu ngày lễ vào từng dòng dữ liệu
    days.forEach(function(d) {
      if (holidaysMap[d.date]) {
        d.isHoliday    = true;
        d.holidayLabel = holidaysMap[d.date];
      }
    });

    // Helper: kiểm tra ngày có phải lễ không (từ map hoặc từ reason)
    function isHolidayDay(d) {
      if (holidaysMap[d.date]) return true;
      if (d.isHoliday) return true;
      // Fallback: reason chứa "Nghỉ" và vắng
      var r = (d.reason || '').replace(/\|+/g,'').trim().toLowerCase();
      return d.hasAbsent && (r.indexOf('ngh') !== -1);
    }

    // ── Công T.tế = ngày có chấm, không phải lễ
    var congThucTe = daysUntilToday.filter(function(d){
      return !d.hasAbsent && !isHolidayDay(d);
    }).length;

    // ── Công B,D = ngày có chấm, không toàn A, không phải lễ
    var congBD = daysUntilToday.filter(function(d){
      return !d.hasAbsent && !d.allOk && !isHolidayDay(d);
    }).length;

    // ── Không chấm = ngày vắng, không phải T7/CN, không phải lễ, đến hôm nay
    var khongCham = daysUntilToday.filter(function(d){
      if (!d.hasAbsent) return false;          // có chấm → không tính
      if (isHolidayDay(d)) return false;        // ngày lễ → không tính
      var parts = d.date.split('/');
      var dow = new Date(parseInt(parts[2]), parseInt(parts[1])-1, parseInt(parts[0])).getDay();
      if (dow === 0 || dow === 6) return false; // T7/CN → không tính
      return true;
    }).length;

    return {
      success:      true,
      name:         name,
      month:        filterMonth,
      year:         filterYear,
      congChuan:    congChuan,
      congThucTe:   congThucTe,
      congBD:       congBD,
      khongCham:    khongCham,
      todayStr:     todayStr,
      holidaysMap:  holidaysMap,   // {dateStr: label} để client tô màu
      days:         days
    };

  } catch(err) {
    Logger.log('getPersonalHistory: ' + err.message);
    return { success:false, error:err.message };
  }
}

// ============================================================
// KIỂM TRA NHÂN VIÊN
// ============================================================
function checkEmployee(name) {
  try {
    var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(STAFF_SHEET_NAME);
    if (!sheet) return { allowed:true };
    var data    = sheet.getDataRange().getValues();
    var headers = data[0].map(function(h){ return h.toString().trim().toLowerCase(); });
    var nc = findCol(headers, ['họ tên','ho ten','tên','name']);
    var sc = findCol(headers, ['status','trạng thái']);
    if (nc === -1) return { allowed:true };
    var nl = name.trim().toLowerCase();
    for (var i=1; i<data.length; i++) {
      if ((data[i][nc]||'').toString().trim().toLowerCase() !== nl) continue;
      if (sc !== -1) {
        var st = (data[i][sc]||'').toString().trim().toLowerCase();
        if (st==='nghỉ việc'||st==='terminated')
          return { allowed:false, reason:'⛔ "'+name+'" đã nghỉ việc.\nVui lòng liên hệ quản lý.' };
      }
      return { allowed:true };
    }
    return { allowed:false, reason:'⛔ "'+name+'" không có trong danh sách CBNV.' };
  } catch(e) { return { allowed:true }; }
}

// ============================================================
// GHI DỮ LIỆU CHẤM CÔNG
// ============================================================
function saveAttendance(data) {
  var name = (data.email||'').trim();
  if (!name) return { success:false, error:'Không xác định được tên.' };
  var check = checkEmployee(name);
  if (!check.allowed) return { success:false, error:check.reason };

  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    var h = ['Thời gian','Họ tên','Vĩ độ','Kinh độ','Độ chính xác (m)',
             'Địa chỉ GPS','Địa điểm gần nhất','Khoảng cách (m)','Trong phạm vi','Ghi chú'];
    sheet.appendRow(h);
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,h.length).setBackground('#1a73e8').setFontColor('#fff').setFontWeight('bold');
    [160,160,110,110,130,220,180,130,120,180].forEach(function(w,i){ sheet.setColumnWidth(i+1,w); });
  }

  var loc = checkLocation(data.lat, data.lng);
  var now = new Date();
  var address = '';
  if (data.lat && data.lng) {
    try {
      var r = Maps.newGeocoder().setLanguage('vi').reverseGeocode(data.lat, data.lng);
      if (r.results && r.results.length) address = r.results[0].formatted_address;
    } catch(e) {}
  }

  sheet.appendRow([now, name, data.lat||'', data.lng||'',
    data.accuracy ? Math.round(data.accuracy) : '', address,
    loc.nearestName,
    loc.nearestDistance < 99999 ? Math.round(loc.nearestDistance) : '',
    loc.isAllowed ? '✓ Hợp lệ' : '✗ Ngoài phạm vi', data.note||'']);
  sheet.getRange(sheet.getLastRow(),1,1,10)
    .setBackground(loc.isAllowed ? '#e6f4ea' : '#fff3e0');

  var timeStr = Utilities.formatDate(now, 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy HH:mm:ss');

  // Gửi tin nhắn Telegram cá nhân sau khi chấm công thành công
  sendAttendanceConfirm(name, timeStr, loc.nearestName, loc.isAllowed);

  return {
    success:true,
    time:     timeStr,
    location: loc.nearestName,
    distance: loc.nearestDistance < 99999 ? Math.round(loc.nearestDistance) : null,
    isAllowed:loc.isAllowed,
    address:  address
  };
}

// ============================================================
// HÀM PHỤ TRỢ
// ============================================================
function findCol(headers, candidates) {
  for (var i=0;i<candidates.length;i++)
    for (var j=0;j<headers.length;j++)
      if (headers[j].indexOf(candidates[i])!==-1) return j;
  return -1;
}

function haversineDistance(lat1,lng1,lat2,lng2) {
  var R=6371000, r=function(x){return x*Math.PI/180;};
  var dLat=r(lat2-lat1), dLng=r(lng2-lng1);
  var a=Math.sin(dLat/2)*Math.sin(dLat/2)+
    Math.cos(r(lat1))*Math.cos(r(lat2))*Math.sin(dLng/2)*Math.sin(dLng/2);
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function checkLocation(lat,lng) {
  if (!lat||!lng) return {isAllowed:false,nearestName:'Không có GPS',nearestDistance:99999};
  var nearest=null, minDist=Infinity;
  OFFICE_LOCATIONS.forEach(function(o){
    var d=haversineDistance(lat,lng,o.lat,o.lng);
    if(d<minDist){minDist=d;nearest=o;}
  });
  return {
    isAllowed:      nearest&&minDist<=nearest.radius,
    nearestName:    nearest?nearest.name:'Không xác định',
    nearestDistance:minDist
  };
}

// ============================================================
// TẠO SHEET CÀI ĐẶT MẪU
// ============================================================
function createSettingsSheet() {
  var ss=SpreadsheetApp.openById(SHEET_ID);
  if (ss.getSheetByName(SETTINGS_SHEET)) { Logger.log('Đã tồn tại'); return; }
  var sheet = ss.insertSheet(SETTINGS_SHEET);
  var rows = [
    ['Tham số','Giá trị (HH:MM)','Mô tả'],
    ['ca1_a_before','08:05','Sáng IN trước → A'],
    ['ca1_b_before','09:30','Sáng IN trước → B (sau D)'],
    ['ca2_b_from',  '09:30','Sáng OUT từ → B'],
    ['ca2_a_from',  '12:00','Sáng OUT từ → A'],
    ['ca2_a_to',    '12:45','Sáng OUT đến → A'],
    ['ca3_a_from',  '12:46','Chiều IN từ → A'],
    ['ca3_a_to',    '13:05','Chiều IN đến → A'],
    ['ca3_b_to',    '15:00','Chiều IN đến → B'],
    ['ca4_b_from',  '15:00','Chiều OUT từ → B'],
    ['ca4_a_from',  '17:00','Chiều OUT từ → A'],
  ];
  sheet.getRange(1,1,rows.length,3).setValues(rows);
  sheet.getRange(1,1,1,3).setBackground('#1a73e8').setFontColor('#fff').setFontWeight('bold');
  [120,100,280].forEach(function(w,i){sheet.setColumnWidth(i+1,w);});
  sheet.setFrozenRows(1);
  Logger.log('✅ Tạo sheet Cài đặt xong!');
}
// ============================================================
// LẤY NGÀY NGHỈ LỄ TỪ SHEET CÀI ĐẶT
// Lưu trong sheet Cài đặt, tham số: "holiday_MM_YYYY"
// Ví dụ: holiday_05_2026 → "01/05,19/05" (các ngày trong tháng)
// ============================================================
function getHolidays(month, year) {
  // Trả về object: { "01/05/2026": "Nghỉ lễ", "02/09/2026": "Nghỉ lễ", ... }
  var holidays = {};
  try {
    var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SETTINGS_SHEET);
    if (!sheet) return holidays;
    var data = sheet.getDataRange().getValues();

    data.forEach(function(row) {
      // Cột D (index 3) = Ngày, Cột E (index 4) = Mô tả
      var dateVal = row[3];
      var label   = (row[4] || 'Nghỉ lễ').toString().trim();
      if (!dateVal) return;

      var dateStr = '';
      if (dateVal instanceof Date) {
        dateStr = pad(dateVal.getDate()) + '/' + pad(dateVal.getMonth()+1) + '/' + dateVal.getFullYear();
      } else {
        dateStr = dateVal.toString().trim();
      }
      if (!dateStr || dateStr.length < 8) return;

      // Chỉ lấy ngày trong tháng/năm đang xem
      var parts = dateStr.split('/');
      if (parts.length === 3) {
        var dMonth = parseInt(parts[1]);
        var dYear  = parseInt(parts[2]);
        if (dMonth === month && dYear === year) {
          holidays[dateStr] = label || 'Nghỉ lễ';
        }
      }
    });
  } catch(e) { Logger.log('getHolidays: ' + e.message); }
  return holidays;
}

// Hàm tiện ích: lấy mảng ngày lễ từ object
function getHolidayArray(holidaysMap) {
  return Object.keys(holidaysMap);
}

// ============================================================
// CÔNG CHUẨN = tổng ngày T2-T6 trong tháng (không trừ lễ, không giới hạn hôm nay)
// ============================================================
function calcCongChuan(month, year) {
  var lastDay = new Date(year, month, 0).getDate();
  var count   = 0;
  for (var d = 1; d <= lastDay; d++) {
    var dow = new Date(year, month-1, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

// ============================================================
// SỐ NGÀY LÀM VIỆC ĐẾN HÔM NAY = T2-T6, trừ lễ, chỉ đến hôm nay
// ============================================================
function calcNgayLamDenHomNay(month, year, holidayArr) {
  // holidayArr: mảng các dateStr ["01/05/2026", ...]
  var today   = new Date();
  var lastDay = new Date(year, month, 0).getDate();
  var count   = 0;
  for (var d = 1; d <= lastDay; d++) {
    var dt      = new Date(year, month-1, d);
    var dow     = dt.getDay();
    var dateStr = pad(d)+'/'+pad(month)+'/'+year;
    if (dow === 0 || dow === 6) continue;
    if (holidayArr.indexOf(dateStr) !== -1) continue;
    if (dt > today) continue;
    count++;
  }
  return count;
}

// So sánh 2 ngày dạng dd/MM/yyyy
// Trả về: -1 nếu a < b, 0 nếu bằng, 1 nếu a > b
function compareDateStr(a, b) {
  function toNum(s) {
    var p = s.split('/');
    return parseInt(p[2])*10000 + parseInt(p[1])*100 + parseInt(p[0]);
  }
  var na = toNum(a), nb = toNum(b);
  return na < nb ? -1 : na > nb ? 1 : 0;
}

// ============================================================
// GỬI TIN NHẮN XÁC NHẬN CHẤM CÔNG CHO CÁ NHÂN
// ============================================================
function sendAttendanceConfirm(name, timeStr, location, isAllowed) {
  try {
    // Lấy Telegram ID của nhân viên từ sheet DS CBNV
    var ss         = SpreadsheetApp.openById(SHEET_ID);
    var staffSheet = ss.getSheetByName(STAFF_SHEET_NAME);
    if (!staffSheet) return;

    var data    = staffSheet.getDataRange().getValues();
    var headers = data[0].map(function(h){ return h.toString().trim().toLowerCase(); });
    var nameCol = findCol(headers, ['họ tên','ho ten','tên','name']);
    var tgCol   = findCol(headers, ['telegram chat id','telegram id','chat id','tele','tg id','tg']);

    if (nameCol === -1 || tgCol === -1) return;

    var nameLower = name.trim().toLowerCase();
    var tgId = '';

    for (var i = 1; i < data.length; i++) {
      if ((data[i][nameCol]||'').toString().trim().toLowerCase() !== nameLower) continue;
      var tgRaw = data[i][tgCol].toString().trim();
      if (tgRaw.indexOf('.') !== -1) tgRaw = tgRaw.split('.')[0];
      var tgNum = parseInt(tgRaw);
      if (!isNaN(tgNum) && tgNum > 0) tgId = tgNum.toString();
      break;
    }

    if (!tgId) return; // Không có Telegram ID → bỏ qua

    var statusIcon = isAllowed ? '✅' : '⚠️';
    var statusText = isAllowed
      ? '✔️ Trạng thái: <b>Hợp lệ</b>'
      : '⚠️ Trạng thái: <b>Ngoài phạm vi</b>\n ↪️ Dữ liệu vẫn được ghi nhận';
 
    // Dùng mảng join để đảm bảo xuống dòng đúng
    var msg = statusIcon + ' <b>Xác nhận chấm công từ hệ thống:</b>\n '
      + '👤 <b>' + name + '</b>\n '
      + '⏰ Thời gian: ' + timeStr + '\n '
      + '📍 Địa điểm: ' + location + '\n '
      + statusText;

    // Gửi tin nhắn
    var url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage';
    UrlFetchApp.fetch(url, {
      method:      'post',
      contentType: 'application/json',
      payload:     JSON.stringify({
        chat_id:    tgId,
        text:       msg,
        parse_mode: 'HTML'
      }),
      muteHttpExceptions: true
    });
    Logger.log('Sent confirm to ' + name + ' (' + tgId + ')');

  } catch(e) {
    Logger.log('sendAttendanceConfirm error: ' + e.message);
  }
}

// ============================================================
// GIẢI TRÌNH LÝ DO — BỔ SUNG
// Ghi lý do vào cột R (COL.REASON_SAVE) sheet Tổng hợp
// Tìm đúng dòng theo: Cột B = name + Cột C = date
// ============================================================
 
// Bổ sung vào doPost: thêm phân luồng action saveGiaiTrinh
// Tìm dòng: var result = saveAttendance(...) trong doPost
// và thêm kiểm tra action trước đó.
// LƯU Ý: bạn cần sửa doPost thủ công hoặc dùng hàm wrapper này:
 
 
function saveGiaiTrinh(name, date, reason) {
  try {
    if (!name || !date || !reason) {
      return { success: false, error: 'Thiếu thông tin: tên, ngày hoặc lý do' };
    }
 
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SUMMARY_SHEET);
    if (!sheet) return { success: false, error: 'Không tìm thấy sheet Tổng hợp' };
 
    var lastRow = sheet.getLastRow();
    if (lastRow < DATA_START) return { success: false, error: 'Sheet Tổng hợp chưa có dữ liệu' };
 
    var numRows = lastRow - DATA_START + 1;
    var numCols = Math.max(COL.REASON_SAVE, sheet.getLastColumn());
    var data    = sheet.getRange(DATA_START, 1, numRows, numCols).getValues();
 
    var nameLower = name.trim().toLowerCase();
    var dateNorm  = date.trim();
 
    for (var i = 0; i < data.length; i++) {
      var rowName = (data[i][COL.NAME - 1] || '').toString().trim().toLowerCase();
      if (rowName !== nameLower) continue;
 
      // Chuẩn hóa ngày trong sheet (Date object hoặc string)
      var rawDate = data[i][COL.DATE - 1];
      var rowDate = '';
      if (rawDate instanceof Date) {
        rowDate = pad(rawDate.getDate()) + '/' + pad(rawDate.getMonth()+1) + '/' + rawDate.getFullYear();
      } else {
        rowDate = rawDate.toString().trim();
      }
 
      if (rowDate !== dateNorm) continue;
 
      // Tìm thấy đúng dòng → ghi cột R
      var rowIndex = DATA_START + i;
      sheet.getRange(rowIndex, COL.REASON_SAVE).setValue(reason.trim());
      Logger.log('saveGiaiTrinh: ' + name + ' | ' + dateNorm + ' | row=' + rowIndex + ' | "' + reason + '"');
      notifyTBPNewGiaiTrinh(name, dateNorm, reason.trim());
      return {
        success: true,
        message: 'Đã lưu giải trình cho ' + name + ' ngày ' + dateNorm
      };
    }
 
    return {
      success: false,
      error: 'Không tìm thấy dòng: ' + name + ' ngày ' + dateNorm
    };
 
  } catch(e) {
    Logger.log('saveGiaiTrinh error: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
// GIẢI TRÌNH — DUYỆT BỞI TBP
// File: GiaiTrinh.gs (thêm vào project Apps Script)
//
// CỘT TRONG SHEET TỔNG HỢP:
//   COL.REASON_SAVE  = 18 (R) — lý do CBNV giải trình
//   COL.APPROVE      = 11 (K) — kết quả: "Đồng ý" / "Từ chối"
//   COL.APPROVE_NOTE = 19 (S) — ghi chú TBP khi từ chối
//   COL.APPROVE_TIME = 20 (T) — thời gian duyệt
//
// TBP: role = 'TBP' trong cột role sheet DS CBNV
// ============================================================

// Thêm vào const COL trong Code.gs:
// APPROVE:       11, // Cột K — kết quả duyệt
// APPROVE_NOTE:  19, // Cột S — ghi chú TBP
// APPROVE_TIME:  20, // Cột T — thời gian duyệt

var COL_APPROVE       = 11;
var COL_APPROVE_NOTE  = 19;
var COL_APPROVE_TIME  = 20;
var COL_REASON_SAVE   = 10;
var TBP_ROLE_KEYWORD  = 'TBP'; // Tên role TBP trong sheet DS CBNV

// ============================================================
// LẤY TELEGRAM ID CỦA TBP
// ============================================================
function getTBPTelegramId() {
  try {
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(STAFF_SHEET_NAME);
    if (!sheet) return null;

    var data    = sheet.getDataRange().getValues();
    var headers = data[0].map(function(h){ return h.toString().trim().toLowerCase(); });
    var tgCol   = findCol(headers, ['telegram chat id','telegram id','chat id','tele','tg']);
    var roleCol = findCol(headers, ['role','chức vụ','chuc vu','vai trò']);

    if (tgCol === -1) return null;

    for (var i = 1; i < data.length; i++) {
      // Nếu có cột role → tìm theo role TBP
      if (roleCol !== -1) {
        var role = (data[i][roleCol] || '').toString().trim().toUpperCase();
        if (role.indexOf(TBP_ROLE_KEYWORD) !== -1) {
          var tgRaw = data[i][tgCol].toString().trim();
          if (tgRaw.indexOf('.') !== -1) tgRaw = tgRaw.split('.')[0];
          var tgNum = parseInt(tgRaw);
          if (!isNaN(tgNum) && tgNum > 0) return tgNum.toString();
        }
      }
    }
    return null;
  } catch(e) {
    Logger.log('getTBPTelegramId: ' + e.message);
    return null;
  }
}

// ============================================================
// GỬI THÔNG BÁO CHO TBP KHI CBNV LƯU GIẢI TRÌNH
// Gọi từ saveGiaiTrinh() sau khi lưu thành công
// ============================================================
function notifyTBPNewGiaiTrinh(name, date, reason) {
  var tgId = getTBPTelegramId();
  if (!tgId) {
    Logger.log('notifyTBP: không tìm thấy Telegram ID của TBP');
    return;
  }

  var adminUrl = 'https://hasttechnical2025-prog.github.io/hast_giaitrinhcong/index.html';

  var msg = '📋 <b>Giải trình mới cần duyệt</b>\n\n'
    + '👤 <b>' + name + '</b>\n'
    + '📅 Ngày: ' + date + '\n'
    + '📝 Lý do: ' + reason + '\n\n'
    + '🔗 <a href="' + adminUrl + '">Mở trang duyệt giải trình</a>';

  sendTelegramMessage(tgId, msg);
  Logger.log('Notified TBP (' + tgId + ') about new giải trình from ' + name);
}

// ============================================================
// TỔNG HỢP CUỐI NGÀY — GỬI CHO TBP
// Trigger: time-driven, mỗi ngày 17:30
// ============================================================
function dailySummaryToTBP() {
  try {
    var now = new Date();
    var dow = now.getDay();
    // Không gửi T7/CN
    if (dow === 0 || dow === 6) return;

    var tgId = getTBPTelegramId();
    if (!tgId) return;

    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SUMMARY_SHEET);
    if (!sheet) return;

    var month = now.getMonth() + 1;
    var year  = now.getFullYear();
    var todayStr = pad(now.getDate()) + '/' + pad(month) + '/' + year;

    var lastRow = sheet.getLastRow();
    if (lastRow < DATA_START) return;

    var numCols = Math.max(COL_APPROVE_TIME, sheet.getLastColumn());
    var data = sheet.getRange(DATA_START, 1, lastRow - DATA_START + 1, numCols).getValues();

    // Lọc: ngày hôm nay, có giải trình mới (cột R), chưa duyệt (cột K rỗng)
    var pendingList = [];
    data.forEach(function(row) {
      var rowDate  = row[COL.DATE - 1];
      var dateStr  = rowDate instanceof Date
        ? pad(rowDate.getDate()) + '/' + pad(rowDate.getMonth()+1) + '/' + rowDate.getFullYear()
        : rowDate.toString().trim();

      if (dateStr !== todayStr) return;

      var reason  = (row[COL_REASON_SAVE - 1] || '').toString().trim();
      var approve = (row[COL_APPROVE - 1]     || '').toString().trim();

      if (!reason || approve) return; // Không có giải trình hoặc đã duyệt

      pendingList.push({
        name:   (row[COL.NAME - 1] || '').toString().trim(),
        date:   dateStr,
        reason: reason
      });
    });

    if (pendingList.length === 0) {
      // Không có giải trình chờ duyệt → gửi thông báo ngắn
      sendTelegramMessage(tgId,
        '✅ <b>Tổng hợp giải trình ' + todayStr + '</b>\n\nKhông có giải trình nào chờ duyệt hôm nay.');
      return;
    }

    var adminUrl = 'https://hasttechnical2025-prog.github.io/hast_giaitrinhcong/index.html';
    var lines = ['📊 <b>Tổng hợp giải trình ' + todayStr + '</b>',
                 '<b>' + pendingList.length + ' giải trình chờ duyệt:</b>', ''];

    pendingList.forEach(function(item, idx) {
      lines.push((idx+1) + '. <b>' + item.name + '</b> — ' + item.reason);
    });

    lines.push('');
    lines.push('🔗 <a href="' + adminUrl + '">Mở trang duyệt giải trình</a>');

    sendTelegramMessage(tgId, lines.join('\n'));

  } catch(e) {
    Logger.log('dailySummaryToTBP: ' + e.message);
  }
}

// ============================================================
// LẤY DANH SÁCH GIẢI TRÌNH CHỜ DUYỆT (cho admin.html)
// action=getGiaiTrinhList&month=5&year=2026&pw=PASSWORD
// ============================================================
function getGiaiTrinhList(month, year, user) {
  try {
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SUMMARY_SHEET);
    if (!sheet) return { success: false, error: 'Không tìm thấy sheet Tổng hợp' };

    var lastRow = sheet.getLastRow();
    // month=0 hoặc year=0 → lấy từ ô F2/H2 trong sheet
    if (!month || month === 0) {
      month = parseInt(sheet.getRange(MONTH_CELL).getValue()) || new Date().getMonth() + 1;
    }
    if (!year || year === 0) {
      year = parseInt(sheet.getRange(YEAR_CELL).getValue()) || new Date().getFullYear();
    }
    if (lastRow < DATA_START) return { success: true, items: [], month: month, year: year };

    var numCols = Math.max(COL_APPROVE_TIME, sheet.getLastColumn());
    var data    = sheet.getRange(DATA_START, 1, lastRow - DATA_START + 1, numCols).getValues();

    var items = [];
    data.forEach(function(row, idx) {
	    // Bỏ qua ngày lễ/tết (kiểm tra cột lý do từ sheet — cột J)
      var reasonJ = (row[COL.REASON - 1] || '').toString().trim().toLowerCase();
      if (reasonJ.indexOf('nghỉ lễ') !== -1 || reasonJ.indexOf('nghỉ tết') !== -1) return;
	  
      var dateVal = row[COL.DATE - 1];
      var dateStr = dateVal instanceof Date
        ? pad(dateVal.getDate()) + '/' + pad(dateVal.getMonth()+1) + '/' + dateVal.getFullYear()
        : dateVal.toString().trim();

      // Bỏ qua T7, CN
      var parts = dateStr.split('/');
      var dow = new Date(parseInt(parts[2]), parseInt(parts[1])-1, parseInt(parts[0])).getDay();
      if (dow === 0 || dow === 6) return; // CN=0, T7=6

      // Lọc theo tháng/năm
      if (parseInt(parts[1]) !== month || parseInt(parts[2]) !== year) return;

      // =====================================================
      // Chỉ lấy đến:
      // - Hôm nay nếu đã qua 17h00
      // - Hôm qua nếu chưa đến 17h00
      // =====================================================
      var now = new Date();

      var limitDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      );

      // Nếu chưa đến 17h thì lùi về hôm qua
      if (now.getHours() < 17) {
        limitDate.setDate(limitDate.getDate() - 1);
      }

      limitDate.setHours(0, 0, 0, 0);

      var rowDate = new Date(dateVal);
      rowDate.setHours(0, 0, 0, 0);

      if (rowDate > limitDate) return;

      // Lấy lý do giải trình
      var reason = (row[COL_REASON_SAVE - 1] || '').toString().trim();
      //if (!reason) return; // Chưa có giải trình → bỏ qua

      // Lấy đánh giá công
      var grade = (row[COL.GRADE - 1] || '').toString().trim();
      var hasBD    = grade.indexOf('B') !== -1 || grade.indexOf('D') !== -1;
															 

      if (!hasBD && !reason) return;
	  
      var approve     = (row[COL_APPROVE - 1]      || '').toString().trim();
      var approveNote = (row[COL_APPROVE_NOTE - 1] || '').toString().trim();
      var approveTime = row[COL_APPROVE_TIME - 1];
      var approveTimeStr = approveTime instanceof Date
        ? Utilities.formatDate(approveTime, 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy HH:mm')
        : (approveTime || '').toString().trim();

      items.push({
        rowIndex:    DATA_START + idx,
        name:        (row[COL.NAME - 1] || '').toString().trim(),
        date:        dateStr,
        grade:       grade,
        reason:      reason,
        approve:     approve,
        approveNote: approveNote,
        approveTime: approveTimeStr,
      });
    });

    // Gắn phòng ban từ DS CBNV vào từng item
    try {
      var staffSheet = ss.getSheetByName(STAFF_SHEET_NAME);
      if (staffSheet) {
        var staffData = staffSheet.getDataRange().getValues();
        var sHeaders  = staffData[0].map(function(h){ return h.toString().trim().toLowerCase(); });
        var sNameCol  = findCol(sHeaders, ['họ tên','ho ten','tên','name']);
        var sDeptCol  = findCol(sHeaders, ['phòng ban','phong ban','department','dept','phòng']);
        if (sNameCol !== -1 && sDeptCol !== -1) {
          var deptMap = {};
          for (var si = 1; si < staffData.length; si++) {
            var sName = (staffData[si][sNameCol]||'').toString().trim();
            var sDept = (staffData[si][sDeptCol]||'').toString().trim();
            if (sName) deptMap[sName.toLowerCase()] = sDept;
          }
          items.forEach(function(item) {
            item.dept = deptMap[item.name.toLowerCase()] || '';
          });
        }
        // Lấy danh sách phòng ban duy nhất
        var depts = [];
        items.forEach(function(item) {
          if (item.dept && depts.indexOf(item.dept) === -1) depts.push(item.dept);
        });
        depts.sort();
        // Lấy phòng ban của TBP từ DS CBNV (cột D)
        var tbpDept = '';
        try {
          var tbpSheet = ss.getSheetByName(STAFF_SHEET_NAME);
          var tbpData  = tbpSheet.getDataRange().getValues();
          var tbpH     = tbpData[0].map(function(h){ return h.toString().trim().toLowerCase(); });
          var tbpRoleC = findCol(tbpH, ['role','chức vụ','chuc vu','vai trò']);
          var tbpDeptC = findCol(tbpH, ['phòng ban','phong ban','department','dept','phòng']);
          if (tbpRoleC !== -1 && tbpDeptC !== -1) {
            for (var ti = 1; ti < tbpData.length; ti++) {
              var role = (tbpData[ti][tbpRoleC]||'').toString().trim().toUpperCase();
              if (role.indexOf('TBP') !== -1) {
                tbpDept = (tbpData[ti][tbpDeptC]||'').toString().trim();
                break;
              }
            }
          }
        } catch(te) { Logger.log('tbpDept: ' + te.message); }
		// Nếu TBP (không phải admin): filter items theo dept của họ
        var filteredItems = items;
        if (user && !user.isAdmin && user.dept) {
          filteredItems = items.filter(function(item) {
            return item.dept === user.dept;
          });
          // TBP chỉ thấy dept của mình, không cần danh sách depts khác
          depts = user.dept ? [user.dept] : depts;
          tbpDept = user.dept;
        } else if (user && user.isAdmin) {
          // Admin: thấy tất cả, tbpDept = '' để có thể chọn tự do
          tbpDept = '';
        }
		
        return { success: true, items: filteredItems, month: month, year: year,
                 depts: depts, tbpDept: tbpDept,
                 isAdmin: user ? user.isAdmin : false };
      }
    } catch(e) { Logger.log('dept map: ' + e.message); }

    return { success: true, items: items, month: month, year: year, depts: [], tbpDept: '' };

  } catch(e) {
    Logger.log('getGiaiTrinhList: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
// DUYỆT GIẢI TRÌNH (TBP bấm Đồng ý / Từ chối)
// action=approveGiaiTrinh, body: {rowIndex, approve, note, pw}
// approve: "Đồng ý" hoặc "Từ chối"
// ============================================================
function approveGiaiTrinh(rowIndex, approve, note) {
  try {
    if (!rowIndex) {
      return { success: false, error: 'Thiếu rowIndex' };
    }
    // approve = '' → undo/hủy duyệt; 'Đồng ý'/'Từ chối' → duyệt bình thường
    if (approve !== '' && approve !== 'Đồng ý' && approve !== 'Từ chối') {
      return { success: false, error: 'Kết quả không hợp lệ: ' + approve };
    }

    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SUMMARY_SHEET);
    if (!sheet) return { success: false, error: 'Không tìm thấy sheet Tổng hợp' };

    var now = new Date();

    // Ghi kết quả duyệt
    sheet.getRange(rowIndex, COL_APPROVE).setValue(approve);
    sheet.getRange(rowIndex, COL_APPROVE_NOTE).setValue(note || '');
	if (approve === ''){
      sheet.getRange(rowIndex, COL_APPROVE_TIME).setValue('');
    } else {
      sheet.getRange(rowIndex, COL_APPROVE_TIME).setValue(now);
    }

  
    // Tô màu dòng theo kết quả
    var numCols = sheet.getLastColumn();
	/*
    var range   = sheet.getRange(rowIndex, 1, 1, numCols);
    range.setBackground(approve === 'Đồng ý' ? '#e6f4ea' : '#fce8e6');
	*/
  
    // Lấy thông tin CBNV để gửi Telegram
    var row      = sheet.getRange(rowIndex, 1, 1, numCols).getValues()[0];
    var name     = (row[COL.NAME - 1]        || '').toString().trim();
    var dateVal  = row[COL.DATE - 1];
    var dateStr  = dateVal instanceof Date
      ? pad(dateVal.getDate()) + '/' + pad(dateVal.getMonth()+1) + '/' + dateVal.getFullYear()
      : dateVal.toString().trim();
    var reason   = (row[COL_REASON_SAVE - 1] || '').toString().trim();

    // Gửi Telegram cho CBNV
    notifyCBNVResult(name, dateStr, reason, approve, note);

    Logger.log('approveGiaiTrinh: row=' + rowIndex + ' | ' + name + ' | ' + approve);
    return {
      success:     true,
      name:        name,
      date:        dateStr,
      approve:     approve,
      approveTime: Utilities.formatDate(now, 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy HH:mm')
    };

  } catch(e) {
    Logger.log('approveGiaiTrinh: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
// GỬI THÔNG BÁO KẾT QUẢ DUYỆT CHO CBNV
// ============================================================
function notifyCBNVResult(name, date, reason, approve, note) {
  try {
    var ss         = SpreadsheetApp.openById(SHEET_ID);
    var staffSheet = ss.getSheetByName(STAFF_SHEET_NAME);
    if (!staffSheet) return;

    var data    = staffSheet.getDataRange().getValues();
    var headers = data[0].map(function(h){ return h.toString().trim().toLowerCase(); });
    var nameCol = findCol(headers, ['họ tên','ho ten','tên','name']);
    var tgCol   = findCol(headers, ['telegram chat id','telegram id','chat id','tele','tg']);
    if (nameCol === -1 || tgCol === -1) return;

    var nameLower = name.trim().toLowerCase();
    var tgId = '';
    for (var i = 1; i < data.length; i++) {
      if ((data[i][nameCol]||'').toString().trim().toLowerCase() !== nameLower) continue;
      var tgRaw = data[i][tgCol].toString().trim();
      if (tgRaw.indexOf('.') !== -1) tgRaw = tgRaw.split('.')[0];
      var tgNum = parseInt(tgRaw);
      if (!isNaN(tgNum) && tgNum > 0) tgId = tgNum.toString();
      break;
    }
    if (!tgId) return;

    var icon = approve === 'Đồng ý' ? '✅' : '❌';
    var msg  = icon + ' <b>Kết quả duyệt giải trình</b>\n\n'
      + '📅 Ngày: ' + date + '\n'
      + '📝 Lý do bạn đã giải trình: ' + reason + '\n'
      + icon + ' Kết quả: <b>' + approve + '</b>'
      + (note ? '\n💬 Ghi chú TBP: ' + note : '');

    sendTelegramMessage(tgId, msg);
    Logger.log('Notified CBNV ' + name + ' result: ' + approve);
  } catch(e) {
    Logger.log('notifyCBNVResult: ' + e.message);
  }
}

// ============================================================
// HÀM TIỆN ÍCH GỬI TELEGRAM
// ============================================================
function sendTelegramMessage(chatId, text) {
  try {
    var url = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage';
    UrlFetchApp.fetch(url, {
      method:             'post',
      contentType:        'application/json',
      payload:            JSON.stringify({
        chat_id:              chatId,
        text:                 text,
        parse_mode:           'HTML',
        disable_web_page_preview: false
      }),
      muteHttpExceptions: true
    });
  } catch(e) {
    Logger.log('sendTelegramMessage error: ' + e.message);
  }
}

// ============================================================
// THIẾT LẬP TRIGGER TỔNG HỢP CUỐI NGÀY 17:30
// Chạy 1 lần để tạo trigger
// ============================================================
function setupDailySummaryTrigger() {
  // Xóa trigger cũ nếu có
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'dailySummaryToTBP') {
      ScriptApp.deleteTrigger(t);
    }
  });
  // Tạo trigger mới: 17:30 mỗi ngày
  ScriptApp.newTrigger('dailySummaryToTBP')
    .timeBased()
    .everyDays(1)
    .atHour(17)
    .nearMinute(30)
    .create();
  Logger.log('✅ Trigger dailySummaryToTBP đã được tạo lúc 17:30 hàng ngày');
}

// ============================================================
// KIỂM TRA HÔM NAY CÓ PHẢI NGÀY NGHỈ KHÔNG
// ============================================================
function checkTodayHoliday() {
  var now      = new Date();
  var dow      = now.getDay();
  var month    = now.getMonth() + 1;
  var year     = now.getFullYear();
  var todayStr = pad(now.getDate()) + '/' + pad(month) + '/' + year;
  if (dow === 0) return { isHoliday: true, reason: 'Hôm nay là Chủ Nhật — ngày nghỉ theo quy định' };
  if (dow === 6) return { isHoliday: true, reason: 'Hôm nay là Thứ 7 — ngày nghỉ theo quy định' };
  var holidays = getHolidays(month, year);
  if (holidays[todayStr]) {
    return { isHoliday: true,
      reason: 'Hôm nay là ' + holidays[todayStr] + ' (' + todayStr + ') — ngày nghỉ theo quy định' };
  }
  return { isHoliday: false };
}

// ============================================================
// DUYỆT HÀNG LOẠT — nhận mảng {rowIndex, approve, note}
// action=batchApprove&pw=...&items=[{rowIndex,approve,note},...]
// ============================================================
function batchApprove(itemsJson) {
  try {
    var items = JSON.parse(itemsJson);
    if (!Array.isArray(items) || items.length === 0) {
      return { success: false, error: 'Không có dữ liệu' };
    }
    var results = [];
    var errors  = [];
    items.forEach(function(item) {
      var r = approveGiaiTrinh(item.rowIndex, item.approve, item.note || '');
      if (r.success) results.push(r);
      else errors.push(item.rowIndex + ': ' + r.error);
    });
    return {
      success: true,
      count:   results.length,
      errors:  errors,
      message: 'Đã duyệt ' + results.length + '/' + items.length + ' mục'
    };
  } catch(e) {
    Logger.log('batchApprove: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
// LẤY DỮ LIỆU CHẤM CÔNG HÔM NAY CỦA CBNV
// action=getAttendanceToday&name=...
// Trả về: {morningIn, morningOut, afternoonIn, afternoonOut}
// ============================================================
function getAttendanceToday(name) {
  try {
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SUMMARY_SHEET);
    if (!sheet) return { success: true, found: false };

    var now      = new Date();
    var todayStr = pad(now.getDate()) + '/' + pad(now.getMonth()+1) + '/' + now.getFullYear();

    var lastRow = sheet.getLastRow();
    if (lastRow < DATA_START) return { success: true, found: false };

    var numRows = lastRow - DATA_START + 1;
    var numCols = Math.max(COL.A_OUT, sheet.getLastColumn());
    var data    = sheet.getRange(DATA_START, 1, numRows, numCols).getValues();

    var nameLower = name.trim().toLowerCase();

    for (var i = 0; i < data.length; i++) {
      var rowName = (data[i][COL.NAME-1]||'').toString().trim().toLowerCase();
      if (rowName !== nameLower) continue;

      var rawDate = data[i][COL.DATE-1];
      var rowDate = rawDate instanceof Date
        ? pad(rawDate.getDate())+'/'+pad(rawDate.getMonth()+1)+'/'+rawDate.getFullYear()
        : rawDate.toString().trim();

      if (rowDate !== todayStr) continue;

      return {
        success:     true,
        found:       true,
        todayStr:    todayStr,
        morningIn:   fmtTime(data[i][COL.M_IN  -1]),
        morningOut:  fmtTime(data[i][COL.M_OUT -1]),
        afternoonIn: fmtTime(data[i][COL.A_IN  -1]),
        afternoonOut:fmtTime(data[i][COL.A_OUT -1])
      };
    }
    return { success: true, found: false };
  } catch(e) {
    Logger.log('getAttendanceToday: ' + e.message);
    return { success: false, error: e.message };
  }
}
