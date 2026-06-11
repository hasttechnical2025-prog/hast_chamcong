const fs = require('fs');

let js = fs.readFileSync('quantri_script.js', 'utf8');

// Replace dynamic onclicks
js = js.replace(/onclick="editEmployee\('([^']+)'\)"/g, 'data-action="edit-employee" data-id="$1"');
js = js.replace(/onclick="openQRModal\('([^']+)'\)"/g, 'data-action="open-qr" data-name="$1"');
js = js.replace(/onclick="exportPrintReport\('([^']+)', '([^']+)'\)"/g, 'data-action="export-print" data-name="$1" data-id="$2"');
js = js.replace(/onclick="deleteHoliday\('([^']+)'\)"/g, 'data-action="delete-holiday" data-date="$1"');
js = js.replace(/onclick="editShiftConfig\('([^']+)'\)"/g, 'data-action="edit-shift" data-id="$1"');
js = js.replace(/onclick="editGuideContent\('([^']+)'\)"/g, 'data-action="edit-guide" data-id="$1"');
js = js.replace(/onclick="openLogEdit\('([^']+)'\)"/g, 'data-action="open-log" data-id="$1"');

// Prepend imports
const imports = `import { supabaseClient } from './supabaseClient.js';
import { SUPABASE_KEY } from './config.js';

// Khởi tạo _isClientReady
window._isClientReady = false;
window.supabaseClient = supabaseClient;
window.SUPABASE_KEY = SUPABASE_KEY;

`;

// Add event delegation and static bindings
const eventListeners = `
// Event Delegation for dynamic buttons
document.addEventListener('click', function(e) {
  const target = e.target;
  const btn = target.closest('button, .nav-tab');
  if (!btn) return;

  const action = btn.getAttribute('data-action');
  if (action === 'edit-employee') editEmployee(btn.getAttribute('data-id'));
  if (action === 'open-qr') openQRModal(btn.getAttribute('data-name'));
  if (action === 'export-print') exportPrintReport(btn.getAttribute('data-name'), btn.getAttribute('data-id'));
  if (action === 'delete-holiday') deleteHoliday(btn.getAttribute('data-date'));
  if (action === 'edit-shift') editShiftConfig(btn.getAttribute('data-id'));
  if (action === 'edit-guide') editGuideContent(btn.getAttribute('data-id'));
  if (action === 'open-log') openLogEdit(btn.getAttribute('data-id'));

  if (btn.classList.contains('nav-tab')) {
    const tabId = btn.getAttribute('data-tab');
    if (tabId) switchTab(tabId);
  }
});

// Bind static buttons
document.addEventListener('DOMContentLoaded', () => {
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };

  bind('btn-deploy-test', startDeployTestProcess);
  bind('btn-deploy-all', startDeployProcess);
  bind('btn-clear-console', clearConsole);
  bind('btn-print-qr-all', printAllQRCodes);
  bind('btn-save-emp', saveEmployee);
  bind('btn-cancel-emp', cancelEmployeeEdit);
  bind('btn-add-holiday', addHoliday);
  bind('btn-save-shift', saveShiftConfig);
  bind('btn-cancel-shift', cancelShiftEdit);
  bind('btn-guide-save', saveGuideContent);
  bind('btn-guide-cancel', cancelGuideEdit);
  bind('btnUploadImage', uploadImageToGithub);
  bind('btn-pw-tbp-kd', () => updatePassword('tbp_kd', 'pw-tbp-kd'));
  bind('btn-pw-tbp-kt', () => updatePassword('tbp_kt', 'pw-tbp-kt'));
  bind('btn-pw-admin', () => updatePassword('admin', 'pw-admin'));
  bind('btn-save-nscl', saveNsclPrintCfg);
  bind('btn-reset-nscl', resetNsclPrintCfg);
  bind('btn-save-config', saveSystemConfig);
  bind('btn-save-log', saveLogEdit);
  bind('btn-cancel-log', closeLogModal);
  bind('btn-delete-log', deleteLog);
  bind('btn-print-qr', printQRCode);
  bind('btn-close-qr', closeQRModal);
  bind('btn-load-logs', loadAttendanceLogs);

  // Close modals on overlay click
  const logModal = document.getElementById('log-edit-modal');
  if (logModal) logModal.addEventListener('click', (e) => { if(e.target === logModal) closeLogModal(); });

  const qrModal = document.getElementById('qr-modal');
  if (qrModal) qrModal.addEventListener('click', (e) => { if(e.target === qrModal) closeQRModal(); });
});
`;

js = imports + js + eventListeners;
fs.writeFileSync('src/js/main.quantri.js', js, 'utf8');

// Now process quantri/index.html
let html = fs.readFileSync('quantri/index.html', 'utf8');

// Strip onclick
html = html.replace(/\sonclick="[^"]*"/g, '');

// Give specific buttons an ID if they don't have one, or just add data-tab for tabs
html = html.replace(/<div class="nav-tab active">🚀 Deploy PWA<\/div>/, '<div class="nav-tab active" data-tab="deploy">🚀 Deploy PWA</div>');
html = html.replace(/<div class="nav-tab">👥 Nhân Viên<\/div>/, '<div class="nav-tab" data-tab="employees">👥 Nhân Viên</div>');
html = html.replace(/<div class="nav-tab">📍 Dữ Liệu Chấm Công<\/div>/, '<div class="nav-tab" data-tab="attendance">📍 Dữ Liệu Chấm Công</div>');
html = html.replace(/<div class="nav-tab">🌴 Ngày Nghỉ Lễ<\/div>/, '<div class="nav-tab" data-tab="holidays">🌴 Ngày Nghỉ Lễ</div>');
html = html.replace(/<div class="nav-tab">⚙️ Cài Đặt Ca<\/div>/, '<div class="nav-tab" data-tab="shifts">⚙️ Cài Đặt Ca</div>');
html = html.replace(/<div class="nav-tab">📖 Hướng Dẫn App<\/div>/, '<div class="nav-tab" data-tab="guide">📖 Hướng Dẫn App</div>');
html = html.replace(/<div class="nav-tab">🔑 Cấu Hình Hệ Thống<\/div>/, '<div class="nav-tab" data-tab="config">🔑 Cấu Hình Hệ Thống</div>');

// Remove script block from line 641 to 2384
const lines = html.split('\n');
const start = 641;
const end = 2384;
html = lines.slice(0, start).join('\n') + '\n<script type="module" src="../src/js/main.quantri.js"></script>\n' + lines.slice(end).join('\n');

fs.writeFileSync('quantri/index.html', html, 'utf8');
console.log('Refactored quantri!');
