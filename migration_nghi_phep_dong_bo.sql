-- MIGRATION: Bảng nhận nghỉ phép ĐÃ DUYỆT đẩy từ app "Số công tác" (project Supabase A).
--
-- App Số công tác (nơi KTV đăng ký + duyệt nghỉ phép) sẽ ghi (upsert) mỗi ngày nghỉ đã duyệt
-- vào bảng này bằng service key của project B. App Chấm công đọc bảng này (của chính nó) để:
--   - Mở ô chấm điểm ngày đó (bỏ chặn "phải giải trình").
--   - Tự điền giải trình = "Nghỉ phép"/"Nghỉ ốm" cho CBNV, hiển thị P.
--
-- KHÓA NỐI NHÂN VIÊN = HỌ TÊN (employee_name khớp chamcong_employees.employee_name).
--   App A cam kết không trùng tên (trùng thì thêm A/B). So khớp nên chuẩn hóa: trim + gộp
--   khoảng trắng + không phân biệt hoa/thường, GIỮ DẤU (tên tiếng Việt phân biệt bởi dấu).
--
-- Idempotent: UNIQUE (nguon_id, ngay). Đẩy lại = upsert (không nhân đôi). Hủy duyệt/xóa đơn
-- bên A -> A xóa các dòng theo nguon_id.
--
-- ⚠️ CHẠY SQL trên project B (App Chấm công). Idempotent.

CREATE TABLE IF NOT EXISTS public.chamcong_nghi_phep_dong_bo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_name text NOT NULL,                    -- khóa nối (khớp chamcong_employees.employee_name)
  ngay          date NOT NULL,                    -- ngày nghỉ
  buoi          text NOT NULL DEFAULT 'ca_ngay',  -- 'ca_ngay' | 'sang' | 'chieu'
  loai          text NOT NULL DEFAULT 'phep',     -- 'phep' | 'om' | 'viec_rieng'
  nguon_id      uuid NOT NULL,                    -- id đơn gốc soct_nghi_phep (để upsert/xóa)
  synced_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (nguon_id, ngay)
);

-- Tra cứu nhanh theo nhân viên + ngày (khi app chấm công render lịch/chấm điểm).
CREATE INDEX IF NOT EXISTS idx_ccnpdb_name_ngay
  ON public.chamcong_nghi_phep_dong_bo (employee_name, ngay);

-- Xóa theo đơn gốc khi hủy đồng bộ.
CREATE INDEX IF NOT EXISTS idx_ccnpdb_nguon
  ON public.chamcong_nghi_phep_dong_bo (nguon_id);

-- RLS bật. App A GHI bằng service role (bỏ qua RLS). App Chấm công là web tĩnh ĐỌC bằng ANON key
-- (client-side) nên cần policy SELECT cho anon. Ghi/sửa/xóa vẫn chỉ service role của A.
ALTER TABLE public.chamcong_nghi_phep_dong_bo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ccnpdb_read ON public.chamcong_nghi_phep_dong_bo;
CREATE POLICY ccnpdb_read ON public.chamcong_nghi_phep_dong_bo FOR SELECT USING (true);
