# TỔNG HỢP HỆ THỐNG — App Chấm Công HSTC

## Cấu hình hiện tại

| Thông số | Giá trị |
|---|---|
| GitHub Pages | `https://hasttechnical2025-prog.github.io/hast_chamcong/` |
| Apps Script URL | `https://script.google.com/macros/s/AKfycbwxoh9oU-lA6g9I-bCVeWpoJdo1fYvtnyVmzR28dXvBpyWkRB7edfKEaC7g89KlSRaX/exec` |
| Google Sheet ID | `1f4fTjTE03dnv26OUJhhzCu6GImLQ7-7aC7TKPQqsIcE` |
| Telegram Token | `8782519076:AAEN1ESG-RQHQvldhVXrugwJ9GOxpvN-g10` |
| SW Version | `v2026.05.16` |
| Supabase URL | ← Điền sau khi tạo project |
| Supabase Anon Key | ← Điền sau khi tạo project |

## File trên GitHub

```
hast_chamcong/
├── index.html              ← App chấm công (74KB)
├── giaitrinh_admin.html    ← Trang duyệt giải trình (35KB)
├── sw.js                   ← Service Worker
├── manifest.json           ← PWA manifest
└── img/                    ← Ảnh hướng dẫn
```

## Kiến trúc hiện tại (GSheets)

```
CBNV → index.html → Apps Script → Google Sheets
TBP  → giaitrinh_admin.html → Apps Script → Google Sheets
                Apps Script → Telegram Bot → CBNV/TBP
```

## Kiến trúc sau migrate (Supabase)

```
CBNV → index.html → Supabase REST API → PostgreSQL
TBP  → giaitrinh_admin.html → Supabase REST API → PostgreSQL
           Supabase Edge Function → Telegram Bot → CBNV/TBP
```

## Sheets hiện tại → Bảng Supabase

| GSheets | Supabase | Ghi chú |
|---|---|---|
| Responses | `attendance_logs` | Raw data mọi lần chấm |
| Tổng hợp | `attendance_records` | 1 record/ca/ngày/người sau rule |
| DS CBNV | `employees` | Thêm cột `loai_ca` |
| Settings (giờ) | `shift_config` | Admin chỉnh được |
| Settings (lễ) | `holidays` | Ngày nghỉ |
| — | `explanations` | Giải trình CBNV |

## Actions Apps Script hiện tại

### doGet
| Action | Chức năng |
|---|---|
| `history` | Lịch sử chấm công tháng của CBNV |
| `checkHoliday` | Kiểm tra hôm nay có phải ngày nghỉ |
| `getGiaiTrinhList` | Danh sách giải trình (có auth) |
| `approveGiaiTrinh` | Duyệt/từ chối giải trình (có auth) |
| `batchApprove` | Duyệt hàng loạt (có auth) |
| `getAttendanceToday` | Dữ liệu chấm công hôm nay |

### doPost
| Action | Chức năng |
|---|---|
| `saveGiaiTrinh` | Lưu giải trình → notify TBP |
| _(default)_ | Lưu dữ liệu chấm công |

## Cột Sheet Tổng hợp

```
A(1)  = ID
B(2)  = Họ tên
C(3)  = Ngày (dd/MM/yyyy)
D(4)  = Sáng IN
E(5)  = Sáng OUT
F(6)  = Chiều IN
G(7)  = Chiều OUT
H(8)  = Đánh giá (hàm mảng: "A,B,D,A")
I(9)  = Ghi chú
J(10) = Lý do/Giải trình (hàm mảng — CHỈ ĐỌC)
K(11) = Kết quả duyệt ("Đồng ý"/"Từ chối")
R(18) = Giải trình CBNV (ghi từ app)
S(19) = Ghi chú TBP
T(20) = Thời gian duyệt
```

- Ô F2 = tháng hiện tại, H2 = năm hiện tại
- Header: dòng 4, Data: từ dòng 5

## Tính năng đã hoàn thành

### index.html
- [x] Đồng hồ thực, tên CBNV từ URL `?name=`
- [x] GPS xác định vị trí, tính khoảng cách
- [x] Cảnh báo chấm trùng (popup Hủy/Tiếp tục)
- [x] Màn hình kết quả sau chấm công
- [x] Dữ liệu tháng: bảng ngày/giờ/đánh giá/lý do/kết quả duyệt
- [x] Giải trình: popup điền → lưu cột R
- [x] Chặn chấm T7/CN/ngày lễ
- [x] Online/offline detection
- [x] GPS expire 1 phút
- [x] PWA: manifest, SW, install prompt
- [x] Hướng dẫn sử dụng (guide overlay)

### giaitrinh_admin.html
- [x] 3 mật khẩu: TBP Kinh doanh, TBP Kế toán-HC, Admin
- [x] Tháng từ F2/H2 sheet
- [x] Filter: trạng thái + phòng ban
- [x] Summary tính theo phòng ban đang filter
- [x] Sticky cột Họ tên
- [x] Batch bar cố định: Đồng ý/Từ chối toàn bộ
- [x] Duyệt từng dòng + popup ghi chú + undo
- [x] Gửi Telegram kết quả → CBNV

## Vấn đề cần giải quyết khi migrate

1. **Race condition**: nhiều người chấm cùng lúc
   → Supabase dùng `upsert` + unique constraint thay LockService

2. **Chậm**: Apps Script cold start + GSheets query chậm
   → Supabase REST API nhanh hơn nhiều

3. **Hàm mảng**: cột H (đánh giá) và J (lý do) dùng hàm mảng GSheets
   → Supabase: tính bằng code, lưu kết quả vào DB

## TODO sau migrate

- [ ] Upload icon-maskable-192/512.png
- [ ] Điền Telegram ID cho 9 nhân viên chưa có
- [ ] Điền cột `role=TBP` trong DS CBNV
- [ ] Điền cột `loai_ca` cho từng nhân viên
- [ ] Đổi ADMIN_PASSWORD mạnh hơn
