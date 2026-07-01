import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// Client ĐỌC luôn dùng anon key (publishable) nhúng sẵn trong config.js.
// KHÔNG đính JWT phiên đăng nhập vào client đọc: mọi thao tác GHI quan trọng đi qua
// Edge Function (service_role) với JWT gửi kèm ở api.js. Nhờ vậy các truy vấn ĐỌC
// luôn chạy bằng role anon — ổn định trên mọi máy, không phụ thuộc trạng thái đăng nhập
// (tránh lỗi "permission denied for table" khi role authenticated chưa được cấp quyền).
export let supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Lưu / gỡ JWT phiên đăng nhập vào localStorage + sessionStorage để api.js đính kèm
 * khi gọi Edge Function. KHÔNG gắn JWT vào supabaseClient (đọc luôn bằng anon).
 * @param {string} token - JWT Token (rỗng/null để đăng xuất)
 */
export function setSupabaseToken(token) {
  if (token) {
    localStorage.setItem('hstc_jwt', token);
    sessionStorage.setItem('hstc_jwt', token);
  } else {
    localStorage.removeItem('hstc_jwt');
    sessionStorage.removeItem('hstc_jwt');
  }
}

/**
 * Tạo lại Supabase Client với URL/Key khác (giữ cho tương thích ngược).
 * Vẫn chạy thuần anon key — không đính JWT.
 */
export function recreateSupabaseClient(url, key) {
  supabaseClient = window.supabase.createClient(url, key);
  return supabaseClient;
}
