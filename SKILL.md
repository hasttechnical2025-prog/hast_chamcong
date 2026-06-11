# SKILL — Migrate App Chấm Công HSTC sang Supabase

## Vai trò
Senior developer migrate app chấm công từ Google Sheets/Apps Script
sang Supabase + GitHub Pages. Làm việc độc lập, test từng bước.

## Đọc bắt buộc trước khi làm

1. `context/SUMMARY.md` — kiến trúc tổng thể
2. `context/business_rules.md` — quy tắc nghiệp vụ
3. `context/schema_current.md` — cấu trúc data hiện tại
4. `source/Code_new.gs` — toàn bộ backend hiện tại
5. Screenshots trong `screenshots/` nếu có

## Quy tắc kỹ thuật bắt buộc

### CORS — GitHub Pages → Supabase
```javascript
// GET
fetch(`${SUPABASE_URL}/rest/v1/table?select=*`, {
  headers: {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
  },
  redirect: 'follow'
})

// POST/PATCH
fetch(`${SUPABASE_URL}/rest/v1/table`, {
  method: 'POST',
  headers: {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',  // BẮT BUỘC với Supabase
    'Prefer': 'return=representation'
  },
  body: JSON.stringify(data),
  redirect: 'follow'
})
```

### Parse response
```javascript
// LUÔN dùng text() → JSON.parse(), không dùng json() trực tiếp
fetch(url, options)
  .then(r => r.text())
  .then(text => {
    const data = JSON.parse(text);
    // xử lý data
  })
  .catch(e => console.error(e));
```

### Không hardcode credentials
```javascript
// Trong index.html và giaitrinh_admin.html
const SUPABASE_URL  = 'https://xxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...'; // anon key, an toàn ở frontend
// KHÔNG dùng service_role key ở frontend
```

## Schema Supabase cần tạo

### `employees` — Danh sách nhân viên
```sql
id          uuid primary key default gen_random_uuid()
name        text not null unique
dept        text                    -- phòng ban
role        text default 'nv'       -- 'nv' | 'TBP' | 'admin'
loai_ca     text default 'tieu_chuan' -- 'tieu_chuan'|'ngoai_le_1'|'ngoai_le_2'
telegram_id bigint
is_active   boolean default true
created_at  timestamptz default now()
```

### `attendance_logs` — Raw data mọi lần chấm
```sql
id           uuid primary key default gen_random_uuid()
employee_id  uuid references employees(id)
employee_name text                    -- denormalized để query nhanh
checked_at   timestamptz not null    -- thời điểm chấm (có timezone)
date         date not null           -- ngày chấm (generated)
session      text not null           -- 'morning_in'|'morning_out'|'afternoon_in'|'afternoon_out'
lat          numeric(10,7)
lng          numeric(10,7)
accuracy     numeric(8,2)
distance     integer                 -- mét, đến văn phòng gần nhất
office_name  text
is_allowed   boolean                 -- trong phạm vi không
note         text
created_at   timestamptz default now()

UNIQUE(employee_id, date, session, checked_at) -- cho phép nhiều log/ca
```

### `attendance_records` — 1 record/ca/ngày/người (sau Rule 4)
```sql
id           uuid primary key default gen_random_uuid()
employee_id  uuid references employees(id)
employee_name text
date         date not null
morning_in   time                    -- giờ IN sáng (sớm nhất)
morning_out  time                    -- giờ OUT sáng (muộn nhất)
afternoon_in time                    -- giờ IN chiều (sớm nhất)
afternoon_out time                   -- giờ OUT chiều (muộn nhất)
grade_mi     char(1)                 -- A/B/D
grade_mo     char(1)
grade_ai     char(1)
grade_ao     char(1)
note         text
updated_at   timestamptz default now()

UNIQUE(employee_id, date) -- 1 record/ngày/người
```

### `explanations` — Giải trình CBNV
```sql
id            uuid primary key default gen_random_uuid()
employee_id   uuid references employees(id)
employee_name text
date          date not null
reason        text not null          -- lý do giải trình
approve       text                   -- null|'Đồng ý'|'Từ chối'
approve_note  text                   -- ghi chú TBP
approve_by    text                   -- tên TBP đã duyệt
approved_at   timestamptz
created_at    timestamptz default now()
updated_at    timestamptz default now()

UNIQUE(employee_id, date)
```

### `shift_config` — Cấu hình khung giờ
```sql
id          uuid primary key default gen_random_uuid()
shift_type  text not null  -- 'tieu_chuan'|'ngoai_le_1'|'ngoai_le_2'
session     text not null  -- 'morning_in'|'morning_out'|'afternoon_in'|'afternoon_out'
a_start     time           -- mốc đầu A (dùng cho morning_out)
a_end       time           -- mốc cuối A
a_end2      time           -- mốc cuối A thứ 2 (dùng cho morning_out)
b_start     time           -- mốc đầu B
b_end       time           -- mốc cuối B (null = không có B)
updated_at  timestamptz default now()
updated_by  text

UNIQUE(shift_type, session)
```

### `holidays` — Ngày lễ tết
```sql
id         uuid primary key default gen_random_uuid()
date       date not null unique
name       text not null
created_at timestamptz default now()
```

## Seed data shift_config (tạo ngay sau schema)

```sql
-- Chuẩn
INSERT INTO shift_config (shift_type, session, a_end, b_end) VALUES
('tieu_chuan', 'morning_in',    '08:05', '09:00'),
('tieu_chuan', 'afternoon_in',  '13:05', '15:00');

INSERT INTO shift_config (shift_type, session, a_start, a_end2, b_start) VALUES
('tieu_chuan', 'morning_out',   '12:00', '12:45', '09:00');

INSERT INTO shift_config (shift_type, session, a_end, b_start) VALUES
('tieu_chuan', 'afternoon_out', '17:00', '15:00');

-- Ngoại lệ 1 (chỉ khác morning_in)
INSERT INTO shift_config (shift_type, session, a_end, b_end) VALUES
('ngoai_le_1', 'morning_in',   '08:30', '09:00');
-- Các ca khác copy từ tieu_chuan

-- Ngoại lệ 2
INSERT INTO shift_config (shift_type, session, a_end, b_end) VALUES
('ngoai_le_2', 'morning_in',   '09:00', null);   -- không có B

INSERT INTO shift_config (shift_type, session, a_end, b_start) VALUES
('ngoai_le_2', 'afternoon_out','16:00', '15:00');
-- Các ca khác copy từ tieu_chuan
```

## Thứ tự migrate (làm đúng thứ tự này)

```
B1: schema.sql + rls_policies.sql + seed_shift_config.sql
B2: saveAttendance (ghi attendance_logs + tính records)
B3: getAttendanceToday (đọc attendance_records)
B4: getPersonalHistory (đọc attendance_records + explanations)
B5: checkHoliday (đọc holidays)
B6: saveGiaiTrinh + notify TBP
B7: getGiaiTrinhList (đọc explanations + employees)
B8: approveGiaiTrinh + batchApprove + notify CBNV
B9: Edge Functions cho Telegram (thay Apps Script triggers)
B10: Test end-to-end + cutover
```

## Điểm hay bị sai — cần test kỹ

1. **OUT sáng ngược timeline**: B nằm trước A
   Test: chấm 10:00 → phải là B, chấm 12:30 → phải là A

2. **Rule 4 Smart pick**: chấm nhiều lần cùng ca
   Test: chấm IN sáng 08:00 rồi 08:30 → record giữ 08:00

3. **Boundary**: đúng mốc giờ thuộc về grade nào
   Test: chấm đúng 08:05 → A (không phải B)

4. **Timezone**: Supabase lưu UTC, hiển thị phải là UTC+7
   Luôn dùng `timestamptz`, convert khi hiển thị

5. **Format ngày**: DB dùng ISO date (2026-05-30),
   hiển thị dùng dd/MM/yyyy → phải convert đúng chiều

6. **hasValidTime**: giờ trống từ DB có thể là null hoặc ""
   Phải handle cả 2 trường hợp

## Không được làm

- Không hardcode service_role key ở frontend
- Không xóa tính năng đang hoạt động
- Không đổi UX của index.html và giaitrinh_admin.html
- Không bỏ logic hasValidTime khi kiểm tra giờ
- Không dùng r.json() trực tiếp — luôn r.text() → JSON.parse()
