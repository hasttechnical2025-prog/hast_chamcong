// Shared Runtime State for index.html (CBNV)

export const state = {
  employeeName: '',
  gpsCoords: null,
  gpsTimestamp: 0,
  isHolidayToday: false,
  histMonth: 0,
  histYear: 0,
  historyCalledFrom: 'done' // 'main' hoặc 'done'
};

export function setEmployeeName(name) {
  state.employeeName = name;
}

export function getEmployeeName() {
  return state.employeeName;
}
