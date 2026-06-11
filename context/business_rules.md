# BUSINESS RULES — App Chấm Công HSTC

## 1. Đánh giá công (A/B/D)

### Timeline chuẩn (đọc trái → phải)

```
IN sáng:   00:00 ──[A]── 08:05 ──[B]── 09:00 ──[D]──>
OUT sáng:  <──[D]── 09:00 ──[B]── 12:00 ──[A]── 12:45 ──[D]──>
IN chiều:  <──[D]── 12:45 ──[A]── 13:05 ──[B]── 15:00 ──[D]──>
OUT chiều: <──[D]── 15:00 ──[B]── 17:00 ──[A]──>
```

### Quy tắc biên (boundary — quan trọng)

| Ca | Mốc | Thuộc về |
|---|---|---|
| IN sáng | đúng 08:05 | A |
| IN sáng | đúng 09:00 | B |
| OUT sáng | đúng 12:00 | A (bắt đầu A) |
| OUT sáng | đúng 12:45 | A (kết thúc A) |
| IN chiều | đúng 12:45 | A (bắt đầu, > 12:45) |
| IN chiều | đúng 13:05 | A |
| OUT chiều | đúng 15:00 | B (> 15:00 mới B) |
| OUT chiều | đúng 17:00 | A |

> Ngoài khung hoặc không chấm → **D**

### Ngoại lệ 1 — chỉ khác IN sáng

```
IN sáng:   00:00 ──[A]── 08:30 ──[B]── 09:00 ──[D]──>
```
Các ca khác: theo chuẩn.

### Ngoại lệ 2 — khác IN sáng và OUT chiều

```
IN sáng:   00:00 ──[A]── 09:00 ──[D]──>   (không có B)
OUT chiều: <──[D]── 15:00 ──[B]── 16:00 ──[A]──>
```
Các ca khác: theo chuẩn.

### Gán loại ca cho CBNV

Cột `loai_ca` trong bảng `employees`:

| Giá trị | Ý nghĩa |
|---|---|
| `tieu_chuan` | Mặc định nếu để trống |
| `ngoai_le_1` | Chỉ khác mốc IN sáng (A ≤ 08:30) |
| `ngoai_le_2` | Khác IN sáng (A ≤ 09:00) + OUT chiều (A ≥ 16:00) |

### Cấu hình linh hoạt — bảng `shift_config`

Admin chỉnh khung giờ không cần sửa code.

| Cột | Kiểu | Mô tả |
|---|---|---|
| `shift_type` | text | `tieu_chuan` / `ngoai_le_1` / `ngoai_le_2` |
| `session` | text | `morning_in` / `morning_out` / `afternoon_in` / `afternoon_out` |
| `a_end` | time | Mốc cuối A (dùng cho IN sáng, IN chiều, OUT chiều) |
| `a_start` | time | Mốc đầu A (dùng cho OUT sáng) |
| `a_end2` | time | Mốc cuối A (dùng cho OUT sáng) |
| `b_end` | time | Mốc cuối B (null = không có B) |
| `updated_at` | timestamptz | Lần cập nhật cuối |
| `updated_by` | text | Admin đã sửa |

### Pseudocode tính đánh giá

```
function grade(time, shift_type, session):
  if time is null → return 'D'
  c = shift_config[shift_type][session]

  if session in [morning_in, afternoon_in]:
    if time <= c.a_end  → return 'A'
    if c.b_end and time <= c.b_end → return 'B'
    return 'D'

  if session == morning_out:
    if c.a_start <= time <= c.a_end2 → return 'A'
    if time < c.a_start → return 'B'
    return 'D'

  if session == afternoon_out:
    if time >= c.a_end → return 'A'
    if time > c.b_start → return 'B'
    return 'D'
```

---

## 2. Rule chọn giờ khi chấm nhiều lần (Rule 4)

### Nguyên tắc

- Lưu **TẤT CẢ** lần chấm vào `attendance_logs` (raw)
- Tính `attendance_records` từ logs theo rule Smart pick

### Xác định ca từ thời điểm chấm

```
00:00 → 09:00  → morning_in   (IN sáng)
09:01 → 12:45  → morning_out  (OUT sáng)
12:46 → 15:00  → afternoon_in (IN chiều)
15:01 → 23:59  → afternoon_out(OUT chiều)
```

### Rule Smart pick theo ca

| Ca | Lấy | Lý do |
|---|---|---|
| IN sáng | Sớm nhất | Thể hiện giờ đến thật |
| OUT sáng | Muộn nhất | Thể hiện rời ca thật |
| IN chiều | Sớm nhất | Thể hiện quay lại thật |
| OUT chiều | Muộn nhất | Thể hiện giờ về thật |

### Pseudocode

```
for each log in attendance_logs(employee_id, date):
  session = getSession(log.checked_at)
  existing = attendance_records[employee_id][date][session]

  if session in [morning_in, afternoon_in]:
    if existing is null OR log.time < existing.time:
      upsert attendance_records ← log

  if session in [morning_out, afternoon_out]:
    if existing is null OR log.time > existing.time:
      upsert attendance_records ← log
```

### Xử lý popup cảnh báo trên app

Khi CBNV bấm Chấm công và đã có dữ liệu trong ca đó:
- Hiện popup: "Bạn đã chấm [ca] lúc HH:MM. Tiếp tục?"
- Bấm **Tiếp tục** → ghi log mới → tính lại record theo rule
- Bấm **Hủy** → không ghi gì

---

## 3. Ngày nghỉ

- Không chấm công: Thứ 7, Chủ Nhật, ngày lễ/tết
- Ngày lễ lưu trong bảng `holidays` (dd/MM/yyyy + tên)
- App kiểm tra khi mở → hiện thông báo + disable nút chấm công
- Giải trình không hiển thị ngày lễ/T7/CN

---

## 4. Giải trình công

### Điều kiện hiển thị ô Giải trình

| Ngày | Hiển thị |
|---|---|
| T7, CN | ❌ |
| Ngày lễ/tết | ❌ |
| Hôm nay | ❌ |
| A A A A (đủ công, không có giải trình) | ❌ |
| Có B hoặc D | ✅ |
| A A A A nhưng có giải trình | ✅ |

### Flow giải trình

```
CBNV bấm ô Lý do → popup nhập → bấm Lưu
→ Ghi vào cột REASON_SAVE (cột R sheet Tổng hợp / bảng explanations)
→ Notify Telegram TBP ngay lập tức
→ TBP nhận thông báo + link trang duyệt

TBP mở giaitrinh_admin.html → duyệt Đồng ý / Từ chối
→ Ghi kết quả vào cột APPROVE (K) + APPROVE_NOTE (S) + APPROVE_TIME (T)
→ Notify Telegram CBNV kết quả
```

---

## 5. Phân quyền Admin

### Mật khẩu trang giaitrinh_admin.html

| Password | Role | Phòng ban thấy | Dropdown phòng ban |
|---|---|---|---|
| `tbp_kd2026` | TBP Kinh doanh | Chỉ Kinh doanh | Khóa |
| `tbp_kt2026` | TBP Kế toán-HC | Chỉ Kế toán-HC | Khóa |
| `admin_kt2026` | Admin | Tất cả | Tự do chọn |

### Duyệt hàng loạt (batch)

- 1 request duy nhất thay vì N requests
- Chỉ duyệt items chưa có kết quả (`approve = null`)
- Không ghi đè kết quả đã duyệt

---

## 6. Telegram

| Sự kiện | Gửi cho | Thời điểm |
|---|---|---|
| Chấm công thành công | CBNV | Ngay lập tức |
| Giải trình mới | TBP | Ngay lập tức |
| Tổng hợp chờ duyệt | TBP | 17:30 hàng ngày |
| Kết quả duyệt | CBNV | Ngay sau khi TBP duyệt |

- Không gửi T7/CN/ngày lễ
- Telegram ID lưu trong bảng `employees`
- TBP: lấy theo cột `role = TBP` trong `employees`

---

## 7. Rule CORS — BẤT BIẾN

```
GitHub Pages → Supabase REST API:
  POST: PHẢI có Content-Type: application/json
  GET:  fetch(url, { headers: { apikey, Authorization } })
  Tất cả fetch: { redirect: 'follow' }
  Parse response: r.text() → JSON.parse() (không dùng r.json())

GitHub Pages → Apps Script (cũ, không dùng nữa sau migrate):
  POST: KHÔNG có Content-Type (CORS preflight!)
  GET: fetch(url) thẳng
```
