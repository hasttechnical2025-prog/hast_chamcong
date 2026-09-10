-- MIGRATION: Nâng cấp Giải trình — thêm Loại + Buổi cho giải trình của CBNV.
--
-- Mục đích: CBNV chọn Loại (Nghỉ phép / Nghỉ ốm / Khác) + Buổi (Cả ngày / Sáng / Chiều).
-- Khi TBP DUYỆT (Đồng ý), Edge Function /approve tự chấm điểm NSCL:
--   - Nghỉ phép/ốm + cả ngày -> nscl_score = 'P' / 'Ô'
--   - Nghỉ phép/ốm + nửa buổi -> nscl_score = '5'
--   - Khác -> không tự chấm (TBP tự chấm trong bảng NSCL)
--
-- An toàn: cột nullable, KHÔNG đổi hành vi giải trình cũ. Giải trình cũ (type/buoi = NULL)
-- được frontend hiển thị như "Khác" (giữ nguyên nội dung lý do).
-- Idempotent: ADD COLUMN IF NOT EXISTS. Chạy trên project App Chấm công.

ALTER TABLE public.chamcong_attendance_records
  ADD COLUMN IF NOT EXISTS justification_type text,   -- 'phep' | 'om' | 'khac'
  ADD COLUMN IF NOT EXISTS justification_buoi text;    -- 'ca_ngay' | 'sang' | 'chieu'

-- Cấp quyền ĐỌC 2 cột mới cho anon/authenticated (frontend đọc bằng anon).
-- Tránh lỗi "permission denied" nếu bảng đang bị siết theo cột (như từng gặp với ngay_vao_lam).
GRANT SELECT (justification_type, justification_buoi)
  ON public.chamcong_attendance_records TO anon, authenticated;
