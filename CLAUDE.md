# CLAUDE.md — HAST Chấm Công (Siêu Thanh Hà Nội)

> Tài liệu cho Claude Code. Mục tiêu: **gộp 3 trang về một repo, refactor monolith thành kiến trúc module sạch, và vá các vấn đề bảo mật/hiệu năng — KHÔNG đổi hành vi nghiệp vụ.**
>
> Khi không chắc một quyết định nghiệp vụ: **giữ nguyên hành vi cũ** và để comment `// TODO: confirm with DK`.

---

## 1. Tổng quan

Ứng dụng chấm công nội bộ Công ty CP Siêu Thanh Hà Nội (HSTC Group). Ba trang web tĩnh trên **GitHub Pages**, dùng chung backend **Supabase** (Postgres + RLS + Trigger + Edge Functions) và thông báo **Telegram**.

- **CBNV** (`index.html`): check-in/out bằng GPS, xem dữ liệu tháng, gửi giải trình.
- **Quản trị** (`admin_new.html` → đổi tên `quantri`): quản lý nhân viên, ngày lễ, cấu hình ca, in NSCL, và tự sinh + push file `index.html` cá nhân lên GitHub.
- **TBP** (`giaitrinh_admin.html`): Trưởng bộ phận duyệt/từ chối giải trình theo phòng ban.

Hiện CBNV+Quản trị ở một repo, TBP ở repo khác. **Quyết định: gộp về một repo** (xem §3).

---

## 2. Tech stack

- HTML5 + CSS thuần + **JavaScript ES modules** — KHÔNG framework, KHÔNG bundler.
- `@supabase/supabase-js@2` (CDN jsdelivr).
- PWA: `manifest.json` + `sw.js`.
- Supabase Edge Functions (Deno) cho Telegram; logic tổng hợp/chấm điểm bằng **Postgres trigger + function** (xem §5).
- Reverse geocode: OpenStreetMap Nominatim (miễn phí).
- Toàn bộ UI/text tiếng Việt.

---

## 3. Cấu trúc repo mục tiêu (một repo)

```
hast_chamcong/                 (1 repo = 1 GitHub Pages site)
├── index.html                 → /              CBNV (PWA cài đặt được)
├── quantri/index.html         → /quantri/      Quản trị
├── giaitrinh/index.html       → /giaitrinh/    TBP
├── manifest.json              (chỉ trang CBNV tham chiếu)
├── sw.js                      NGUỒN VERSION DUY NHẤT — const VERSION
├── img/                       icons, qr-bot.png, monthlydata.jpg...
├── CLAUDE.md
└── src/
    ├── css/   base.css · components.css · history.css · guide.css
    ├── assets/ logo.js   (export LOGO_BASE64 — tách base64 dài khỏi HTML)
    └── js/
        ├── config.js          hằng số: SUPABASE_*, OFFICES, MAX_DISTANCE...
        ├── supabaseClient.js  khởi tạo client + query dùng chung
        ├── api.js             gọi Supabase Edge Functions — đường GHI duy nhất
        ├── auth.js            đăng nhập admin/TBP qua server (xem §6)
        ├── telegram.js        gọi Edge Function send-telegram
        ├── clock.js · gps.js · attendance.js
        ├── history.js · justification.js · guide.js
        ├── pwa.js             đăng ký SW + check version + nút cài app
        └── main.js            điểm khởi động cho từng trang
```

- Mỗi trang HTML là **vỏ mỏng**: chỉ markup + `<link>` CSS + `<script type="module" src="src/js/main.*.js">`.
- **Lợi ích gộp repo:** `src/` chia sẻ cho cả 3 trang — không còn submodule/duplicate. Một `sw.js`, một version, một lần deploy.
- Link CBNV ở root → **không phải in lại QR**; chỉ link quản trị/TBP đổi path.

---

## 4. Data model (đã introspect thực tế — chính xác, không phải suy đoán)

Tất cả bảng ở schema `public`, prefix `chamcong_`.

### `chamcong_attendance_logs` — log thô mỗi lần chấm (append-only, tăng nhanh nhất)
`id uuid PK`, `employee_name text`, `checked_at timestamptz default now()`, `latitude/longitude/accuracy numeric`, `address text`, `nearest_office text`, `distance numeric`, `status text`, `note text`.
**Index: chỉ có PK trên `id`.** → THIẾU index cho `checked_at` (xem §8).

### `chamcong_attendance_records` — bản ghi ngày (tổng hợp tự động bởi trigger)
`id uuid PK`, `employee_name text`, `date date NOT NULL`, `morning_in/out`, `afternoon_in/out` (`time`), `grades text default 'D,D,D,D'`, `note`, `justification`, `approve_status text default 'Chờ'`, `approve_note`, `approve_time timestamptz`, `updated_at`, `nscl_score text`, `nscl_adjust numeric`.
**Index: PK + UNIQUE `(employee_name, date)` (`unique_employee_date`).** → tra theo người+ngày đã nhanh; query chỉ-theo-`date` thì chưa (xem §8).

### `chamcong_employees`
`id int PK`, `name text UNIQUE NOT NULL`, `email`, `telegram_chat_id bigint`, `department text NOT NULL`, `role text default 'CBNV'` (`'TBP'` cho trưởng bộ phận), `loai_ca text default 'tieu_chuan'`, `status text default 'Đang làm việc'`, `created_at`.
> ⚠️ `status` có giá trị **không nhất quán** trong dữ liệu cũ (`'active'`, `'đang làm'`, `'Đang làm việc'`). Khi lọc nhân viên đang làm phải chấp nhận nhiều biến thể — hoặc chuẩn hoá lại dữ liệu.
> `name` là khoá định danh xuyên suốt (logs/records dùng `employee_name` chuỗi) → **đổi tên một người sẽ làm đứt liên kết lịch sử.** Cân nhắc chuyển sang khoá `employee_id` về lâu dài.

### `chamcong_shift_config` — CẤU HÌNH NGƯỠNG GIỜ CHẤM ĐIỂM
`id int PK`, `shift_type text`, `session text`, `a_start time`, `a_end time`, `a_end2 time`, `b_end time`, `updated_at`. UNIQUE `(shift_type, session)`.

### `chamcong_holidays`
`date date PK`, `description text NOT NULL`, `created_at`.

### `chamcong_guide_content`
`id text PK` (`'p1'..'p4'`), `title`, `content`, `updated_at`.

### `chamcong_admin_settings`
`key text PK`, `password text NOT NULL`, `description`, `updated_at`.
> ⚠️ Cột `password` đang bị **dùng đa mục đích**: mật khẩu admin/TBP (plaintext) **và** JSON cấu hình in NSCL (`key='nscl_print_config'`). Cần tách (xem §6).

---

## 5. Logic server-side (GIỮ NGUYÊN hành vi)

### Trigger `process_attendance_log` (AFTER INSERT trên `chamcong_attendance_logs`)
1. Đổi `checked_at` (UTC) → giờ VN `Asia/Ho_Chi_Minh`, tính `hhmm`.
2. **Phân ca theo ngưỡng hardcode trong trigger:** `hhmm ≤ 900` → `morning_in`; `≤ 1245` → `morning_out`; `≤ 1500` → `afternoon_in`; còn lại → `afternoon_out`.
3. Đọc `loai_ca` của nhân viên (mặc định `'tieu_chuan'`).
4. Upsert dòng ngày vào `attendance_records` (`ON CONFLICT (employee_name, date) DO NOTHING`).
5. **Smart-pick:** IN lấy giờ **sớm nhất**, OUT lấy giờ **muộn nhất**.
6. Gọi `calculate_session_grade` cho 4 ca → ghi `grades` dạng CSV `"A,B,A,D"`.

### Function `calculate_session_grade(p_time, p_shift_type, p_session)` → CHAR(1)
Đọc ngưỡng từ `chamcong_shift_config` theo `(shift_type, session)`. `p_time` NULL hoặc không có config → `D`.
- **IN** (`morning_in`, `afternoon_in`): `≤ a_end` → A; `≤ b_end` (nếu có) → B; còn lại → D.
- **morning_out**: `a_start ≤ t ≤ a_end2` → A; `t < a_start` → B; còn lại → D.
- **afternoon_out**: `t ≥ a_end` → A; còn lại → B. (Nhánh D không bao giờ đạt — về sớm = B, không D. Giữ nguyên, xác nhận với DK nếu cần.)

> Ngưỡng giờ A/B/D là **dữ liệu** trong `shift_config`, KHÔNG hardcode. Ngưỡng *phân ca* (bước 2) thì hardcode trong trigger.

### Edge Function `send-telegram` (Deno)
Nhận `{ chat_id, message }`, đọc `TELEGRAM_TOKEN` từ `Deno.env` (Secrets — không lộ ra frontend ✓), gửi `sendMessage` (`parse_mode: HTML`). CORS `*`.
> ⚠️ Hàm **không xác thực người gọi** → ai biết URL + publishable key đều gửi tin qua bot công ty (chat_id đọc được từ bảng employees đang mở public). Thêm kiểm tra caller (mức ưu tiên trung bình).

### Các sự kiện Telegram hiện có
1. Xác nhận chấm công cá nhân (CBNV, sau `doSend`). 2. Báo TBP có giải trình mới (CBNV, sau `submitGiaiTrinh`). 3. Bot nhắc nhở theo giờ (cron — *chưa có source, cần bổ sung sau*). 4. Báo CBNV kết quả duyệt (TBP).

---

## 6. BẢO MẬT — phần trọng tâm

### Hiện trạng (KHÔNG an toàn — phải thay)
RLS có bật nhưng **mọi policy cấp cho `public`/`anon`** (xác nhận từ `pg_policies`). Ai đọc được publishable key (nằm trong source) đều:
- Đọc + sửa `admin_settings` → **mật khẩu admin/TBP (plaintext) lộ và sửa được** → đăng nhập coi như vô hiệu.
- Toàn quyền `employees` (kể cả DELETE) → đọc PII (telegram_chat_id), xoá/sửa cả bảng.
- `ALL` trên `attendance_records` → tự sửa điểm, tự duyệt giải trình của mình, xoá bản ghi.
- INSERT `attendance_logs` với tên bất kỳ (chấm hộ) + đọc GPS mọi người.
- Thêm: admin lưu **service_role key + GitHub PAT plaintext** trong `localStorage` (`hstc_admin_config`).

### Đích đến
1. **Backend làm "người cầm quyền"** = **Supabase Edge Functions (Deno)** dùng `service_role` (lấy từ `Deno.env`, KHÔNG bao giờ ra frontend). Mọi thao tác GHI quan trọng đi qua đây; frontend chỉ còn ĐỌC những gì được phép. (Không có Vercel — toàn bộ backend gói gọn trong Supabase.)
2. **Định danh = token bí mật ngẫu nhiên**, KHÔNG phải tên (chống chấm hộ — xem §7). Backend tự đóng dấu `employee_name` từ token; client không gửi tên.
3. **Đăng nhập thật:** server kiểm mật khẩu đã **hash** (bỏ plaintext, tách khỏi `admin_settings`) → phát JWT phiên ngắn hạn. Bỏ so sánh mật khẩu phía client.
4. **Lật RLS sang deny-public** — chỉ cho `service_role` (qua backend) ghi; anon chỉ SELECT tối thiểu (vd guide_content). **Làm ĐỒNG THỜI với (1)(2)(3)**, vì khoá RLS trước khi có backend sẽ làm app chết.
5. **Gỡ service_role + PAT khỏi localStorage.** Việc deploy file cá nhân chuyển thành **GitHub Action** (token ở repo Secrets). Đây là việc an toàn làm NGAY, độc lập.
6. **Tách cột `password`:** mật khẩu (đã hash) sang bảng riêng; `nscl_print_config` sang cột/bảng JSON riêng.

---

## 7. Định danh & chống chấm hộ (chính sách: cấm chấm hộ trừ khi có QR người đó)

- **Token ngẫu nhiên** (không đoán được) gắn mỗi nhân viên trong DB; QR mã hoá **token**, không mã hoá tên. Ô tên trên màn hình là `<span>` chỉ-đọc, tên do **server** trả về từ token — client không bao giờ gõ/sửa tên.
- **iOS:** sinh file cá nhân theo **path token** `/nv/<token>/` (baked sẵn token) + manifest `start_url: "."`. Vì tên không nằm trong storage và path sống sót qua Add-to-Home-Screen → khắc phục lỗi Safari iOS mất localStorage. Path là token ngẫu nhiên nên không đoán được như slug-theo-tên.
- **Android + bản test:** QR `?t=<token>` → lưu **token** (không lưu tên) vào localStorage.
- **Bỏ `?name=` ở production** (cửa cho gõ tên tuỳ ý) — chỉ giữ làm cửa test với nhân viên test (`note='test'`), tốt nhất disable trong bản prod.
- Có token = chấm được cho người đó = đúng bằng "có QR của họ" (ngoại lệ DK chấp nhận). Backend + DB cho phép **thu hồi token** nếu QR bị lộ.

---

## 8. Hiệu năng (lag khi dữ liệu nhiều)

**Đã tốt:** `attendance_records` có UNIQUE `(employee_name, date)`; `holidays(date)` PK; `employees(name)` unique → các tra cứu chính đã có index.

**Cần thêm index:**
```sql
-- Admin nạp log theo tháng (checked_at) — bảng tăng nhanh nhất, hiện chỉ index id
CREATE INDEX IF NOT EXISTS idx_logs_checked_at ON public.chamcong_attendance_logs (checked_at);
CREATE INDEX IF NOT EXISTS idx_logs_emp_checked ON public.chamcong_attendance_logs (employee_name, checked_at);

-- Giaitrinh nạp cả tháng theo date (mọi nhân viên): unique index dẫn đầu bằng employee_name nên
-- query chỉ-theo-date không dùng được → thêm index theo date
CREATE INDEX IF NOT EXISTS idx_records_date ON public.chamcong_attendance_records (date);
```

**Khác:**
- `select('*')` → chỉ lấy cột cần (cột `address` dài), giảm payload.
- Mọi query GIỮ lọc theo tháng (`gte/lte`) — không nạp toàn bảng.
- **Archive** `attendance_logs` cũ sang bảng nguội theo định kỳ (dữ liệu chỉ giữ tới ngày 10 tháng sau).
- Bảng tháng render vào DOM: hiện ổn cho một tháng; chỉ ảo hoá/phân trang nếu sau này nạp nhiều hơn.

---

## 9. PWA / version (GIỮ cơ chế hiện tại)

- `sw.js`: `const VERSION` là **nguồn duy nhất**. Chiến lược fetch network-first, fallback cache. `skipWaiting` + `clients.claim`.
- Khi deploy: đổi `VERSION` → `git push`. `pwa.js` đọc `VERSION` từ `sw.js`, so với localStorage, khác thì xoá cache + reload.
- `manifest.json`: `start_url: "./index.html"`, `scope: "./"` cho trang CBNV. Trang quản trị/TBP **không** tham chiếu manifest và **không** cache mạnh trong SW (chỉ cache vỏ CBNV + tài nguyên tĩnh).
- Sửa hiện tại: `PRECACHE` còn liệt kê `huongdan.html` (đã chuyển sang guide overlay) — cập nhật lại danh sách. Bỏ chặn `script.google.com` nếu không còn dùng Apps Script.

---

## 10. Chuẩn lập trình (bắt buộc)

1. **ES modules**, mỗi file một trách nhiệm; không biến toàn cục ngầm.
2. **Không `onclick` inline** — gắn `addEventListener` trong JS; dùng `data-*` + event delegation cho phần tử động.
3. **Không khai báo trùng** (bản cũ có `gpsTimestamp`, `_historyCalledFrom`, `GPS_EXPIRE_MS` lặp lại). Dùng `const`/`let`, không `var`.
4. Tách CSS ra file; dùng biến `:root` cho màu chủ đạo `#1a73e8` và trạng thái ok/warn/err.
5. **Mọi `await supabase/api` bọc `try/catch`.** Telegram & Nominatim fail thì bỏ qua, KHÔNG chặn luồng chấm công.
6. Gom magic string trạng thái thành hằng: `'Chờ'/'Đồng ý'/'Từ chối'`, `'✓ Hợp lệ'/'✗ Ngoài phạm vi'`.
7. JSDoc cho hàm public; comment nghiệp vụ bằng tiếng Việt; hàm camelCase.
8. **Tuyệt đối không** đưa `service_role` key hay GitHub PAT vào bất kỳ file frontend / localStorage nào.
9. CORS: GitHub Pages → Supabase **phải** kèm `Content-Type: application/json`.

### Lỗi/kh+code-smell cần dọn khi refactor (kiểm lại trên file hiện hành)
- `beforeinstallprompt`/`appinstalled` bị đặt nhầm trong `.catch()` của SW registration.
- Thẻ `<script>` Supabase đặt sai vị trí; thẻ `</body>` thừa.
- CSS lỗi cú pháp (`padding-top: 0 !important` thiếu `;`); selector vô nghĩa `#guide-overlay body`.
- Text "GPS quá 3 phút" lệch với `GPS_EXPIRE_MS` (1 phút); `MAX_DISTANCE` lệch comment; `;;` thừa.
- `ALLOW_HOLIDAY_CHECKIN`/`ALLOW_MULTIPLE_CHECKIN` hardcode dù ý định đọc từ admin → đưa vào `config.js`, lý tưởng là đọc từ DB.

---

## 11. KHÔNG được đổi (nghiệp vụ)

- Ngưỡng phân ca trong trigger (≤9:00 / ≤12:45 / ≤15:00) và Smart-pick (IN sớm nhất, OUT muộn nhất).
- Luật chấm A/B/D theo `shift_config` (data-driven).
- GPS bắt buộc; trong `radius` = hợp lệ; ngoài `radius` nhưng ≤ `MAX_DISTANCE` = vẫn ghi (cảnh báo); vượt `MAX_DISTANCE` = chặn; GPS hết hạn sau `GPS_EXPIRE_MS`.
- Chặn ngày nghỉ (T7/CN + `holidays`); cảnh báo chấm trùng ca.
- Record ảo `grades='D,D,D,D'` cho ngày làm việc đã qua không chấm (để hiển thị + cho giải trình).
- 4 sự kiện Telegram.

---

## 12. Thứ tự ưu tiên triển khai

1. **NGAY:** gỡ service_role + GitHub PAT khỏi localStorage; thêm 3 index ở §8 (một câu SQL, hiệu quả tức thì).
2. **Gộp repo + refactor module** (§3, §10) — giữ nguyên hành vi, dọn code-smell.
3. **Backend authority + auth + token định danh + lật RLS** (§6, §7) — bước phối hợp, làm cùng nhau.
4. Chuyển deploy file cá nhân sang GitHub Action; tách cột `password`; thêm xác thực cho `send-telegram`; chuẩn hoá `status`.

---

## 13. Checklist nghiệm thu

- [ ] CBNV: check-in trong/ngoài phạm vi, hết hạn GPS, cảnh báo trùng ca, chặn ngày nghỉ — y bản cũ.
- [ ] Trigger vẫn tổng hợp records + chấm A/B/D đúng (so vài ngày mẫu trước/sau refactor).
- [ ] Dữ liệu tháng + giải trình + overlay hướng dẫn hoạt động.
- [ ] TBP duyệt/từ chối + Telegram báo kết quả.
- [ ] Quản trị: CRUD nhân viên/ngày lễ/ca, in NSCL, deploy file cá nhân.
- [ ] PWA cài được, version mới tự cập nhật.
- [ ] Sau khi lật RLS: anon KHÔNG đọc được `admin_settings`/PII, KHÔNG ghi trực tiếp được; mọi GHI đi qua backend.
- [ ] Không còn `var`/khai báo trùng/`onclick` inline; không secret nào trong frontend/localStorage.

---

## 14. Cần bổ sung khi có
- Source **bot nhắc nhở** (cron) — bổ sung sau, không chặn các bước hiện tại. (Không dùng Vercel; backend = Supabase Edge Functions.)
- Trạng thái RLS enabled/disabled từng bảng (query `pg_class.relrowsecurity`) — để viết policy chính xác.
