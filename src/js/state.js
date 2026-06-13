// Shared Runtime State for index.html (CBNV)
import { ALLOW_HOLIDAY_CHECKIN, ALLOW_MULTIPLE_CHECKIN } from './config.js';

export const state = {
  employeeName: '',
  gpsCoords: null,
  gpsTimestamp: 0,
  isHolidayToday: false,
  histMonth: 0,
  histYear: 0,
  historyCalledFrom: 'done', // 'main' hoặc 'done'
  // 2 cờ đọc TRỰC TIẾP từ chamcong_system_config lúc chạy (ăn ngay, không cần deploy).
  // Mặc định = giá trị baked trong config.js để an toàn nếu chưa tải kịp / DB lỗi.
  allowHoliday: ALLOW_HOLIDAY_CHECKIN,
  allowMultiple: ALLOW_MULTIPLE_CHECKIN
};

export function setEmployeeName(name) {
  state.employeeName = name;
}

export function getEmployeeName() {
  return state.employeeName;
}
