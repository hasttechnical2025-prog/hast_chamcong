# SCHEMA HIỆN TẠI — Google Sheets

> ⚠️ File này cần được bổ sung sau khi chụp screenshots
> Xem danh sách screenshots cần chụp trong README.md

## Sheet: Responses (ghi raw từ app)

Cần chụp screenshot `08_responses_header.png` để xác nhận cột.
Dự kiến cấu trúc:

| Cột | Nội dung |
|---|---|
| A | Timestamp |
| B | Họ tên CBNV |
| C | Latitude |
| D | Longitude |
| E | Accuracy (GPS) |
| F | Ghi chú |
| G | Địa chỉ (reverse geocode) |
| H | Tên văn phòng gần nhất |
| I | Khoảng cách (m) |
| J | Trong phạm vi (TRUE/FALSE) |

## Sheet: Tổng hợp (tổng hợp từ Responses)

Header: dòng 4 | Data: từ dòng 5
Ô F2 = tháng, H2 = năm

| Cột | Index | Nội dung | Ghi chú |
|---|---|---|---|
| A | 1 | ID | |
| B | 2 | Họ tên | |
| C | 3 | Ngày | dd/MM/yyyy |
| D | 4 | Sáng IN | HH:mm:ss |
| E | 5 | Sáng OUT | HH:mm:ss |
| F | 6 | Chiều IN | HH:mm:ss |
| G | 7 | Chiều OUT | HH:mm:ss |
| H | 8 | Đánh giá | Hàm mảng → "A,B,D,A" |
| I | 9 | Ghi chú | |
| J | 10 | Lý do | Hàm mảng — CHỈ ĐỌC |
| K | 11 | Kết quả duyệt | "Đồng ý"/"Từ chối" |
| R | 18 | Giải trình CBNV | Ghi từ app |
| S | 19 | Ghi chú TBP | |
| T | 20 | Thời gian duyệt | |

> Cần screenshot `03_formula_grade.png` để lấy công thức cột H
> Cần screenshot `04_formula_reason.png` để lấy công thức cột J

## Sheet: DS CBNV

Cần screenshot `05_ds_cbnv.png` để xác nhận cột.
Dự kiến cấu trúc:

| Cột | Nội dung | Ghi chú |
|---|---|---|
| A | Họ tên | Key để match |
| B | Email/ID | |
| C | Telegram Chat ID | Số nguyên |
| D | Phòng ban | "Kinh doanh" / "Kế toán-Hành chính" / "Kỹ thuật" |
| ? | Role | "TBP" / để trống |
| ? | loai_ca | "tieu_chuan" / "ngoai_le_1" / "ngoai_le_2" |

## Sheet: Settings

### Cột A/B: Cấu hình giờ
Cần screenshot `06_settings_gio.png`

Dự kiến:

| Key (A) | Value (B) |
|---|---|
| morning_in_a | 08:05 |
| morning_in_b | 09:00 |
| ... | ... |

### Cột D/E: Ngày lễ
Cần screenshot `07_settings_ngayle.png`

| Ngày (D) | Tên (E) |
|---|---|
| 01/01/2026 | Tết Dương lịch |
| 29/01/2026 | Tết Âm lịch |
| ... | ... |

## Văn phòng (hardcode trong index.html)

```javascript
const OFFICES = [
  {
    name: 'Siêu Thanh Hà Nội',
    lat: 21.00861322599807,
    lng: 105.81294998643875,
    radius: 200  // mét
  }
];
const MAX_DISTANCE = 20000; // 20km — giới hạn tối đa
```
