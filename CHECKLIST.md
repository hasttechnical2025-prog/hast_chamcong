# DANH SÁCH SCREENSHOTS CẦN CHỤP

Chụp xong đặt vào folder `screenshots/` với đúng tên file.

## Bắt buộc (blocking — chưa có không làm được)

### 01_tong_hop_header.png ⬜
**Cách chụp:** Mở sheet Tổng hợp → chụp dòng 1→6
**Cần thấy:** Ô F2 (tháng), H2 (năm), dòng 4 (header cột A→T)
**Mục đích:** Xác nhận cấu trúc header và vị trí tháng/năm

### 02_tong_hop_data.png ⬜
**Cách chụp:** Sheet Tổng hợp → chụp 20-30 dòng data (cột A→T)
**Cần thấy:** Data thật của nhiều nhân viên, nhiều ngày
**Mục đích:** Hiểu format data thực tế (giờ, ngày, đánh giá)

### 03_formula_grade.png ⬜
**Cách chụp:** Click vào ô H5 → chụp cả formula bar phía trên
**Cần thấy:** Toàn bộ công thức trong formula bar
**Mục đích:** Hiểu logic đánh giá A/B/D đang dùng

### 04_formula_reason.png ⬜
**Cách chụp:** Click vào ô J5 → chụp formula bar
**Cần thấy:** Công thức tính lý do/giải trình
**Mục đích:** Hiểu cột J đang tính gì

### 05_ds_cbnv.png ⬜
**Cách chụp:** Mở sheet DS CBNV → chụp toàn bộ (header + vài dòng)
**Cần thấy:** Tất cả tên cột, đặc biệt cột role và phòng ban
**Mục đích:** Thiết kế bảng employees đúng

### 06_settings_gio.png ⬜
**Cách chụp:** Sheet Settings → chụp cột A và B (tất cả dòng có data)
**Cần thấy:** Key/value các tham số giờ làm việc
**Mục đích:** Seed data shift_config đúng

### 07_settings_ngayle.png ⬜
**Cách chụp:** Sheet Settings → chụp cột D và E
**Cần thấy:** Danh sách ngày lễ tết (ngày + tên)
**Mục đích:** Seed data holidays

### 08_responses_header.png ⬜
**Cách chụp:** Sheet Responses → chụp dòng 1 (header) + 3-5 dòng data
**Cần thấy:** Tất cả cột được ghi khi chấm công
**Mục đích:** Thiết kế bảng attendance_logs đúng

### 09_supabase_project.png ⬜
**Cách chụp:** Supabase Dashboard → Settings → API
**Cần thấy:** Project URL và anon key
**CHÚ Ý:** Che/blur service_role key trước khi chụp!
**Mục đích:** Điền vào INSTRUCTION.md

## Nên có (giúp tránh bug)

### 10_tong_hop_full_row.png ⬜
**Cách chụp:** 1 dòng data đầy đủ từ cột A → T (scroll ngang)
**Mục đích:** Xác nhận cột K, R, S, T có data không

### 11_ds_cbnv_role.png ⬜
**Cách chụp:** DS CBNV → zoom vào cột role và loai_ca
**Mục đích:** Xác nhận đã có 2 cột này chưa hay cần tạo mới
