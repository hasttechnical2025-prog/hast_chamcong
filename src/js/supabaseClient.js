import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// Khởi tạo Supabase Client với JWT từ localStorage nếu có sẵn
const jwt = localStorage.getItem('hstc_jwt') || sessionStorage.getItem('hstc_jwt') || '';

export let supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {}
  }
});

/**
 * Hàm cập nhật session/token động cho client sau khi đăng nhập thành công
 * @param {string} token - JWT Token
 */
export function setSupabaseToken(token) {
  if (token) {
    localStorage.setItem('hstc_jwt', token);
    sessionStorage.setItem('hstc_jwt', token);

    // Gọi setSession để Supabase client tự động đính kèm Token này vào Header Authorization
    supabaseClient.auth.setSession({
      access_token: token,
      refresh_token: ''
    });
  } else {
    localStorage.removeItem('hstc_jwt');
    sessionStorage.removeItem('hstc_jwt');
    supabaseClient.auth.signOut();
  }
}

/**
 * Hàm khởi tạo lại Supabase Client với URL và Key mới (dành cho tab Cấu hình Admin)
 */
export function recreateSupabaseClient(url, key) {
  const currentJwt = localStorage.getItem('hstc_jwt') || sessionStorage.getItem('hstc_jwt') || '';
  supabaseClient = window.supabase.createClient(url, key, {
    global: {
      headers: currentJwt ? { Authorization: `Bearer ${currentJwt}` } : {}
    }
  });
  return supabaseClient;
}
