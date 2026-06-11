# CHAMCONG HSTC — COWORK PROJECT

## Mục tiêu
Migrate app chấm công HSTC từ Google Sheets + Apps Script
sang **Supabase** (database) + **GitHub Pages** (frontend).
Frontend giữ nguyên, chỉ thay đổi backend và API calls.

## Trạng thái hiện tại
- ✅ Frontend hoạt động: GitHub Pages
- ✅ Backend: Google Apps Script + Google Sheets
- ⚠️ Vấn đề: chậm, race condition khi nhiều người chấm cùng lúc
- 🎯 Mục tiêu: migrate sang Supabase, giữ nguyên UX

## Cấu trúc folder

```
cowork/
├── README.md                   ← file này
├── context/
│   ├── SUMMARY.md              ← tổng hợp hệ thống hiện tại
│   ├── business_rules.md       ← quy tắc nghiệp vụ (QUAN TRỌNG)
│   ├── schema_current.md       ← cấu trúc GSheets hiện tại
│   └── schema_supabase.md      ← schema Supabase (Cowork tạo)
├── source/
│   ├── Code_new.gs             ← Apps Script hiện tại (FULL)
│   ├── index.html              ← Frontend chấm công
│   └── giaitrinh_admin.html   ← Frontend duyệt giải trình
├── supabase/
│   ├── schema.sql              ← Cowork tạo
│   ├── rls_policies.sql        ← Cowork tạo
│   ├── seed_shift_config.sql   ← Cowork tạo
│   └── migrations/             ← Cowork tạo
└── screenshots/                ← User cung cấp (xem danh sách bên dưới)
```

## Screenshots cần chụp (BLOCKING — phải có trước khi bắt đầu)

### 1. `01_tong_hop_header.png`
Sheet Tổng hợp — chụp dòng 1→6 (thấy ô F2, H2 và header)
→ Cần thấy: tháng ở F2, năm ở H2, tên cột hàng 4

### 2. `02_tong_hop_data.png`
Sheet Tổng hợp — chụp 20-30 dòng data (cột A→T)
→ Cần thấy: data thật của nhiều nhân viên, nhiều ngày

### 3. `03_formula_grade.png`
Sheet Tổng hợp — click vào ô H5, chụp formula bar
→ Cần thấy: công thức tính đánh giá A/B/D

### 4. `04_formula_reason.png`
Sheet Tổng hợp — click vào ô J5, chụp formula bar
→ Cần thấy: công thức tính lý do/giải trình

### 5. `05_ds_cbnv.png`
Sheet DS CBNV — chụp toàn bộ (header + vài dòng data)
→ Cần thấy: tất cả tên cột, đặc biệt cột role và loai_ca

### 6. `06_settings_gio.png`
Sheet Settings — chụp cột A và B
→ Cần thấy: các key/value cấu hình giờ làm việc

### 7. `07_settings_ngayle.png`
Sheet Settings — chụp cột D và E
→ Cần thấy: danh sách ngày lễ tết

### 8. `08_responses_header.png`
Sheet Responses — chụp header và 5 dòng đầu
→ Cần thấy: tất cả cột được ghi khi chấm công

### 9. `09_supabase_project.png`
Supabase Dashboard → Settings → API
→ Cần thấy: Project URL và anon key (service_role key ẩn đi)

## Thứ tự thực hiện

```
Bước 1: Đọc toàn bộ context/ trước khi làm bất cứ thứ gì
Bước 2: Tạo schema Supabase (schema.sql + rls_policies.sql)
Bước 3: Tạo seed data shift_config
Bước 4: Migrate saveAttendance (ghi chấm công)
Bước 5: Migrate getPersonalHistory (đọc lịch sử)
Bước 6: Migrate getAttendanceToday (kiểm tra trước khi chấm)
Bước 7: Migrate giải trình (saveGiaiTrinh, getGiaiTrinhList)
Bước 8: Migrate duyệt giải trình (approveGiaiTrinh, batchApprove)
Bước 9: Migrate Telegram notifications
Bước 10: Test end-to-end + cutover
```
