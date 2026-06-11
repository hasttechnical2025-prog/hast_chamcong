# SKILL — Migrate Telegram Notifications sang Supabase Edge Functions

## Bối cảnh

App chấm công HSTC đã migrate data sang Supabase thành công.
Phần Telegram notifications chưa được migrate — hiện toàn bộ im lặng.
Cần triển khai lại Telegram qua Supabase Edge Functions.

---

## Kiến trúc mục tiêu

```
[index.html]          --POST--> [Edge Function: send-telegram] --> Telegram API
[giaitrinh_admin.html]--POST--> [Edge Function: send-telegram] --> Telegram API
[Supabase pg_cron]    --schedule 17:30--> [Edge Function: daily-summary] --> Telegram API
```

Token bot KHÔNG được để ở frontend — chỉ lưu trong Supabase Secrets.

---

## 4 sự kiện cần gửi Telegram

| # | Sự kiện | Gửi cho | Trigger từ |
|---|---|---|---|
| 1 | Chấm công thành công | CBNV (cá nhân) | frontend sau khi Supabase ghi thành công |
| 2 | Giải trình mới | TBP (cá nhân) | frontend sau khi lưu giải trình |
| 3 | Tổng hợp chờ duyệt | TBP (cá nhân) | pg_cron 17:30 T2-T6 |
| 4 | Kết quả duyệt | CBNV (cá nhân) | frontend sau khi TBP duyệt |

---

## Edge Functions cần tạo

### Function 1: `send-telegram`

**Mục đích:** Gửi 1 tin Telegram cho 1 chat_id bất kỳ.
Dùng cho sự kiện 1, 2, 4.

**Endpoint:** `POST /functions/v1/send-telegram`

**Request body:**
```json
{
  "chat_id": 123456789,
  "message": "Nội dung HTML"
}
```

**Code (Deno/TypeScript):**
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const { chat_id, message } = await req.json();

    if (!chat_id || !message) {
      return new Response(
        JSON.stringify({ ok: false, error: "Thiếu chat_id hoặc message" }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const token = Deno.env.get("TELEGRAM_TOKEN");
    if (!token) throw new Error("TELEGRAM_TOKEN chưa được cấu hình");

    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id,
          text: message,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      }
    );

    const data = await res.json();
    return new Response(JSON.stringify({ ok: true, result: data }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e.message }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
```

---

### Function 2: `daily-summary`

**Mục đích:** Tổng hợp giải trình chờ duyệt → gửi TBP lúc 17:30.
Chạy tự động qua pg_cron, không cần gọi từ frontend.

**Kiểm tra trước khi gửi (theo thứ tự):**
1. Hôm nay là T7 hoặc CN → bỏ qua
2. Hôm nay có trong bảng `holidays` → bỏ qua
3. Không có giải trình chờ duyệt → vẫn gửi thông báo "không có gì"

**Endpoint:** `POST /functions/v1/daily-summary`

**Code (Deno/TypeScript):**
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = Deno.env.get("TELEGRAM_TOKEN")!;

    // ── Tính ngày hôm nay theo UTC+7 ──────────────────────
    const now = new Date();
    const vnDate = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const dow = vnDate.getUTCDay(); // 0=CN, 6=T7
    const today = vnDate.toISOString().split("T")[0]; // YYYY-MM-DD

    // ── Bỏ qua T7/CN ──────────────────────────────────────
    if (dow === 0 || dow === 6) {
      return new Response(
        JSON.stringify({ ok: true, skipped: "weekend", date: today })
      );
    }

    // ── Bỏ qua ngày lễ/tết (kiểm tra bảng holidays) ──────
    // Bảng holidays: cột date kiểu DATE (YYYY-MM-DD), cột name TEXT
    const { data: holiday } = await supabase
      .from("holidays")
      .select("name")
      .eq("date", today)
      .maybeSingle();

    if (holiday) {
      return new Response(
        JSON.stringify({
          ok: true,
          skipped: "holiday",
          holiday: holiday.name,
          date: today,
        })
      );
    }

    // ── Lấy danh sách giải trình chưa duyệt ───────────────
    // Lọc theo tháng hiện tại (không chỉ hôm nay)
    // vì TBP có thể chưa duyệt các ngày trước trong tháng
    const firstOfMonth = today.substring(0, 7) + "-01"; // YYYY-MM-01
    const { data: pending, error: pendingErr } = await supabase
      .from("explanations")
      .select("employee_name, date, reason")
      .is("approve", null)
      .gte("date", firstOfMonth)
      .lte("date", today)
      .order("date", { ascending: true });

    if (pendingErr) throw pendingErr;

    // ── Lấy Telegram ID của tất cả TBP ────────────────────
    // Mỗi TBP chỉ nhận thông báo phòng ban mình
    const { data: tbpList, error: tbpErr } = await supabase
      .from("employees")
      .select("telegram_id, name, dept")
      .eq("role", "TBP")
      .not("telegram_id", "is", null);

    if (tbpErr) throw tbpErr;
    if (!tbpList || tbpList.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "Không tìm thấy TBP nào" })
      );
    }

    // ── Format ngày hiển thị dd/MM/yyyy ───────────────────
    const [y, m, d] = today.split("-");
    const dateDisplay = `${d}/${m}/${y}`;
    const adminUrl =
      "https://hasttechnical2025-prog.github.io/hast_chamcong/giaitrinh_admin.html";

    // ── Gửi cho từng TBP (filter theo phòng ban) ──────────
    const sendPromises = tbpList.map(async (tbp) => {
      // Lọc pending theo phòng ban của TBP
      // Nếu TBP.dept rỗng → admin, thấy tất cả
      const myPending = tbp.dept
        ? (pending ?? []).filter((p: any) => {
            // Cần join với employees để lấy dept của CBNV
            // Tạm dùng tất cả nếu không có dept filter
            return true; // ← Cowork cần join bảng employees để filter đúng
          })
        : (pending ?? []);

      let msg = "";
      if (myPending.length === 0) {
        msg =
          `✅ <b>Tổng hợp giải trình ${dateDisplay}</b>

` +
          `Không có giải trình nào chờ duyệt.`;
      } else {
        const lines = [
          `📊 <b>Tổng hợp giải trình ${dateDisplay}</b>`,
          `<b>${myPending.length} giải trình chờ duyệt:</b>`,
          "",
          ...myPending.map(
            (p: any, i: number) =>
              `${i + 1}. <b>${p.employee_name}</b> (${p.date}) — ${p.reason}`
          ),
          "",
          `🔗 <a href="${adminUrl}">Mở trang duyệt</a>`,
        ];
        msg = lines.join("
");
      }

      return fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: tbp.telegram_id,
            text: msg,
            parse_mode: "HTML",
            disable_web_page_preview: false,
          }),
        }
      );
    });

    await Promise.all(sendPromises);

    return new Response(
      JSON.stringify({
        ok: true,
        date: today,
        pending_count: pending?.length ?? 0,
        tbp_notified: tbpList.length,
      })
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500 }
    );
  }
});
```

> ⚠️ **Cowork cần bổ sung:** join bảng `employees` trong query
> `explanations` để lấy `dept` của CBNV → filter đúng theo phòng ban TBP.
> Query gợi ý:
> ```typescript
> const { data: pending } = await supabase
>   .from("explanations")
>   .select("employee_name, date, reason, employees!inner(dept)")
>   .is("approve", null)
>   .gte("date", firstOfMonth)
>   .lte("date", today);
> // Sau đó: filter bằng p.employees.dept === tbp.dept
> ```

---

## Supabase Secrets cần cấu hình

Vào Supabase Dashboard → **Settings → Edge Functions → Secrets**:

```
TELEGRAM_TOKEN = 8782519076:AAEN1ESG-RQHQvldhVXrugwJ9GOxpvN-g10
```

`SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY` đã có sẵn tự động,
không cần thêm thủ công.

---

## pg_cron — Trigger daily-summary lúc 17:30 VN

Chạy trong **Supabase SQL Editor**:

```sql
-- Bật extension nếu chưa có
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Tạo scheduled job: 17:30 VN = 10:30 UTC, T2-T6
select cron.schedule(
  'daily-summary-tbp',           -- tên job (unique)
  '30 10 * * 1-5',               -- cron: 10:30 UTC = 17:30 UTC+7, T2→T6
  $$
  select net.http_post(
    url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/daily-summary',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Kiểm tra job đã tạo chưa
select * from cron.job;

-- Xóa job nếu cần tạo lại
-- select cron.unschedule('daily-summary-tbp');
```

---

## Cập nhật frontend — gọi send-telegram

### Cấu hình thêm vào index.html và giaitrinh_admin.html

```javascript
// Thêm vào phần CẤU HÌNH đầu file
const SUPABASE_FUNC_URL = 'https://YOUR_PROJECT_REF.supabase.co/functions/v1';

// Hàm gửi Telegram (dùng chung cho cả 2 file)
function sendTelegram(chatId, message) {
  if (!chatId) return Promise.resolve();
  return fetch(SUPABASE_FUNC_URL + '/send-telegram', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
    },
    body: JSON.stringify({ chat_id: chatId, message: message }),
    redirect: 'follow'
  })
  .then(function(r) { return r.text(); })
  .then(function(text) {
    try { return JSON.parse(text); } catch(e) { return {}; }
  })
  .catch(function(e) { console.warn('[Telegram]', e.message); });
}
```

### Sự kiện 1 — Xác nhận chấm công (trong index.html)

Gọi sau khi Supabase ghi thành công:

```javascript
// Lấy telegram_id của CBNV từ Supabase employees table
// Sau đó gọi:
var msg = '✅ <b>Chấm công thành công</b>\n\n'
  + '👤 ' + employeeName + '\n'
  + '🕐 ' + timeStr + '\n'
  + '📍 ' + locationStr + '\n'
  + '✔ Trạng thái: ' + (isAllowed ? '✅ Hợp lệ' : '⚠️ Ngoài phạm vi');
sendTelegram(employeeTelegramId, msg);
```

### Sự kiện 2 — Giải trình mới (trong index.html)

Gọi sau khi lưu giải trình thành công:

```javascript
// Lấy telegram_id TBP từ employees WHERE role='TBP' AND dept = dept của CBNV
var adminUrl = 'https://hasttechnical2025-prog.github.io/hast_chamcong/giaitrinh_admin.html';
var msg = '📋 <b>Giải trình mới cần duyệt</b>\n\n'
  + '👤 <b>' + employeeName + '</b>\n'
  + '📅 Ngày: ' + dateStr + '\n'
  + '📝 Lý do: ' + reason + '\n\n'
  + '🔗 <a href="' + adminUrl + '">Mở trang duyệt</a>';
sendTelegram(tbpTelegramId, msg);
```

### Sự kiện 4 — Kết quả duyệt (trong giaitrinh_admin.html)

Gọi sau khi approveGiaiTrinh thành công:

```javascript
// Lấy telegram_id CBNV từ employees WHERE name = item.name
var icon = approve === 'Đồng ý' ? '✅' : '❌';
var msg = icon + ' <b>Kết quả duyệt giải trình</b>\n\n'
  + '📅 Ngày: ' + item.date + '\n'
  + '📝 Lý do: ' + item.reason + '\n'
  + icon + ' Kết quả: <b>' + approve + '</b>'
  + (note ? '\n💬 Ghi chú: ' + note : '');
sendTelegram(cbnvTelegramId, msg);
```

---

## Thứ tự triển khai

```
B1: Tạo 2 Edge Functions (send-telegram, daily-summary)
B2: Cấu hình TELEGRAM_TOKEN trong Supabase Secrets
B3: Test send-telegram bằng curl hoặc Postman
B4: Chạy pg_cron SQL (thay YOUR_PROJECT_REF và SERVICE_ROLE_KEY)
B5: Cập nhật index.html — thêm sendTelegram() sau chấm công
B6: Cập nhật index.html — thêm sendTelegram() sau lưu giải trình
B7: Cập nhật giaitrinh_admin.html — thêm sendTelegram() sau duyệt
B8: Test end-to-end toàn bộ 4 sự kiện
```

---

## Test nhanh Edge Function sau khi deploy

```bash
# Test send-telegram (thay URL, KEY, CHAT_ID)
curl -X POST \
  'https://YOUR_REF.supabase.co/functions/v1/send-telegram' \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"chat_id": YOUR_CHAT_ID, "message": "Test từ Edge Function ✅"}'

# Kết quả mong đợi:
# {"ok":true,"result":{"ok":true,...}}
```

---

## Lưu ý quan trọng

- `chat_id` CBNV và TBP lấy từ bảng `employees.telegram_id` (số nguyên)
- Chat nhóm có `chat_id` âm (dạng `-100xxxxxxx`)
- Nếu `telegram_id` null → bỏ qua, không báo lỗi
- Edge Function timeout mặc định 2 giây — Telegram API thường < 1 giây, đủ dùng
- KHÔNG gửi T7/CN và ngày lễ/tết trong daily-summary
  → T7/CN: kiểm tra `getUTCDay()`
  → Ngày lễ: query `holidays` table trong Supabase trước khi gửi
  → Bảng `holidays`: cột `date DATE`, cột `name TEXT`
- parse_mode HTML: dùng `<b>`, `<i>`, `<a href>` — không dùng Markdown

---

## Thông tin cần điền trước khi bắt đầu

```
SUPABASE_PROJECT_REF = ________________  (lấy từ Settings → General)
SUPABASE_ANON_KEY    = ________________
SUPABASE_SERVICE_ROLE_KEY = ___________  (chỉ dùng trong pg_cron SQL)
TELEGRAM_TOKEN       = 8782519076:AAEN1ESG-RQHQvldhVXrugwJ9GOxpvN-g10
TBP_TELEGRAM_IDS     = lấy từ bảng employees WHERE role='TBP'
ADMIN_PAGE_URL       = https://hasttechnical2025-prog.github.io/hast_chamcong/giaitrinh_admin.html
```
