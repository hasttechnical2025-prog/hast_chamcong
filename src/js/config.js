// Cấu hình các tham số toàn cục của ứng dụng (Tự động sinh từ GitHub Action)

export const SUPABASE_URL = 'https://bkdupkjrafaprvdseued.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_VPxkr4o9TCHiM-cVNalB5A_z4x_dG5y'; // Anon key dùng để đọc dữ liệu
export const SUPABASE_FUNC_URL = 'https://bkdupkjrafaprvdseued.supabase.co/functions/v1';

export const OFFICES = [
  { name: 'Siêu Thanh Hà Nội', lat: 21.008601, lng: 105.812979, radius: 200 },
];

export const MAX_DISTANCE = 15000;

export const ALLOW_HOLIDAY_CHECKIN = false;
export const ALLOW_MULTIPLE_CHECKIN = false;

export const DAYS = ['Chủ Nhật','Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy'];
export const GPS_EXPIRE_MS = 1 * 60 * 1000; // GPS hết hạn sau 1 phút
