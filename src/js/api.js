import { SUPABASE_FUNC_URL } from './config.js';

/**
 * Hàm chung để gọi Supabase Edge Function API
 * @param {string} endpoint - API Endpoint (vd: '/auth/verify-token')
 * @param {Object} body - Dữ liệu gửi đi
 * @returns {Promise<any>}
 */
async function callApi(endpoint, body) {
  const jwt = localStorage.getItem('hstc_jwt') || sessionStorage.getItem('hstc_jwt') || '';
  const headers = {
    'Content-Type': 'application/json'
  };
  if (jwt) {
    headers['Authorization'] = `Bearer ${jwt}`;
  }

  const response = await fetch(`${SUPABASE_FUNC_URL}/api${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    redirect: 'follow'
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    if (!response.ok) {
      throw new Error(text || `Lỗi API (${response.status})`);
    }
    return {};
  }

  if (!response.ok) {
    throw new Error(json.error || `Lỗi API (${response.status})`);
  }

  return json;
}

/**
 * Giao dịch Token lấy JWT và Tên nhân viên
 * @param {string} token - UUID Token
 */
export async function verifyQRToken(token) {
  return await callApi('/auth/verify-token', { token });
}

/**
 * Đăng nhập Admin / TBP để lấy JWT
 */
export async function loginAdmin(username, password) {
  return await callApi('/auth/login', { username, password });
}

/**
 * CBNV chấm công
 */
export async function logAttendance(payload) {
  return await callApi('/checkin', payload);
}

/**
 * CBNV gửi giải trình
 */
export async function submitJustification(date, reason) {
  return await callApi('/justification', { date, reason });
}

/**
 * TBP hoặc Admin duyệt giải trình
 */
export async function approveJustification(payload) {
  return await callApi('/approve', payload);
}

/**
 * Tác vụ Admin: Thêm/Sửa/Xóa dữ liệu thông qua Proxy bảo mật
 */
export async function adminWrite(table, action, data, eqColumn, eqValue) {
  return await callApi('/admin/write', { table, action, data, eqColumn, eqValue });
}

/**
 * Quản lý tài khoản TBP/Admin (chỉ admin) qua Edge Function — chống leo thang quyền.
 * @param {'list'|'save'|'delete'|'password'} op
 * @param {Object} [payload] - { username, password, role, department, id }
 */
export async function adminAccount(op, payload) {
  return await callApi('/admin/account', Object.assign({ op }, payload || {}));
}

/**
 * Tác vụ Admin: Kích hoạt quá trình Deploy qua GitHub Actions
 */
export async function triggerDeploy(owner, repo) {
  return await callApi('/admin/deploy', { owner, repo });
}

/**
 * Gửi tin nhắn Telegram qua Edge Function (đường gửi an toàn, token nằm ở Secrets)
 * @param {string|number} chatId
 * @param {string} message
 */
export async function sendTelegram(chatId, message) {
  return await callApi('/send-telegram', { chat_id: chatId, message });
}
