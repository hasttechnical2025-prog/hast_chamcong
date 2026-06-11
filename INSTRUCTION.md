# INSTRUCTION CHO CLAUDE COWORK

## Nhiệm vụ
Migrate app chấm công HSTC từ Google Sheets + Apps Script
sang Supabase. Frontend (index.html, giaitrinh_admin.html)
giữ nguyên UI/UX, chỉ thay đổi API calls.

## Đọc trước khi làm bất cứ thứ gì

```
context/SUMMARY.md          → kiến trúc tổng thể
context/business_rules.md   → quy tắc nghiệp vụ (QUAN TRỌNG NHẤT)
context/schema_current.md   → cấu trúc GSheets hiện tại
source/Code_new.gs          → backend hiện tại (đọc để hiểu logic)
SKILL.md                    → schema Supabase + quy tắc kỹ thuật
```

## Quy tắc làm việc

1. **Làm từng bước nhỏ** theo thứ tự trong SKILL.md
2. **Sau mỗi file tạo**: đọc lại và verify syntax
3. **Không sang bước tiếp** nếu bước hiện tại chưa hoàn chỉnh
4. **Giữ nguyên** toàn bộ UI/UX của 2 file HTML
5. **Báo rõ** khi cần thông tin từ user (Supabase keys, screenshots)

## Thông tin cần từ user trước khi bắt đầu

- [ ] Supabase Project URL
- [ ] Supabase Anon Key
- [ ] Screenshots trong folder `screenshots/`
- [ ] File `source/Code_new.gs` (bản đang chạy thật)

## Output cần tạo

```
supabase/
├── schema.sql              ← CREATE TABLE statements
├── rls_policies.sql        ← Row Level Security
├── seed_shift_config.sql   ← Dữ liệu mẫu shift_config
└── migrations/             ← Các thay đổi sau này

source/ (sửa file hiện có)
├── index.html              ← Thay API calls
└── giaitrinh_admin.html    ← Thay API calls
```

## Supabase credentials (điền khi có)

```
SUPABASE_URL      = 
SUPABASE_ANON_KEY = 
TELEGRAM_TOKEN    = 8782519076:AAEN1ESG-RQHQvldhVXrugwJ9GOxpvN-g10
ADMIN_USERS = [
  { pw: 'tbp_kd2026',   dept: 'Kinh doanh',         isAdmin: false },
  { pw: 'tbp_kt2026',   dept: 'Kế toán-Hành chính', isAdmin: false },
  { pw: 'admin_kt2026', dept: '',                    isAdmin: true  },
]
```
