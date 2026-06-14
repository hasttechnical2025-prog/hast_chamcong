import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Base64URL helpers an toàn UTF-8 (btoa thuần chỉ nhận Latin1 -> vỡ với tên/phòng ban
// tiếng Việt như "Trần Kiên", "Kế toán-Hành chính"). Mã hoá qua bytes UTF-8 trước.
function bytesToB64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64UrlToBytes(str: string): Uint8Array {
  const binary = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// HMAC-SHA256 JWT implementation using Web Crypto API
async function signJWT(payload: any, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = bytesToB64Url(encoder.encode(JSON.stringify(header)));
  const encodedPayload = bytesToB64Url(encoder.encode(JSON.stringify(payload)));

  const tokenInput = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(tokenInput)
  );

  const encodedSignature = bytesToB64Url(new Uint8Array(signature));

  return `${tokenInput}.${encodedSignature}`;
}

async function verifyJWT(token: string, secret: string): Promise<any | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const tokenInput = `${header}.${payload}`;

    const signBytes = b64UrlToBytes(signature);

    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      signBytes,
      encoder.encode(tokenInput)
    );

    if (!isValid) return null;

    const jsonPayload = new TextDecoder().decode(b64UrlToBytes(payload));
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error("JWT Verification error:", e);
    return null;
  }
}

async function sendTelegramMsg(chatId: string | number, message: string) {
  const telegramToken = Deno.env.get("TELEGRAM_TOKEN") ?? "";
  if (!telegramToken || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML"
      })
    });
  } catch (e) {
    console.error("Error sending telegram:", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const jwtSecret = Deno.env.get("JWT_SECRET") ?? "";

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // 1. ENDPOINT: /auth/login (Cho Admin / TBP)
    if (path.endsWith("/auth/login")) {
      const { username, password } = await req.json();
      if (!password) {
        return new Response(JSON.stringify({ error: "Thiếu mật khẩu xác thực" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      let result;
      if (username) {
        // Đăng nhập có tài khoản và mật khẩu
        result = await supabase.rpc("chamcong_verify_auth", {
          p_username: username,
          p_password: password
        });
      } else {
        // Đăng nhập chỉ dùng mật khẩu (TBP page)
        result = await supabase.rpc("chamcong_verify_auth_password_only", {
          p_password: password
        });
      }

      if (result.error || !result.data || result.data.length === 0) {
        return new Response(JSON.stringify({ error: "Mật khẩu hoặc tài khoản không chính xác" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const account = result.data[0];
      const payload = {
        role: "authenticated",
        iss: "supabase",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // Phiên admin/TBP dài 1 năm (gần như không hết hạn)
        user_metadata: {
          type: "admin",
          username: account.username,
          role: account.role,
          department: account.department
        }
      };

      const jwt = await signJWT(payload, jwtSecret);
      return new Response(JSON.stringify({ access_token: jwt, user: account }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 2. ENDPOINT: /auth/verify-token (Cho CBNV quét QR Code)
    if (path.endsWith("/auth/verify-token")) {
      const { token } = await req.json();
      if (!token) {
        return new Response(JSON.stringify({ error: "Thiếu QR Token định danh" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Tìm nhân viên theo token
      const { data: emp, error } = await supabase
        .from("chamcong_employees")
        .select("name, status")
        .eq("token", token)
        .maybeSingle();

      if (error || !emp) {
        return new Response(JSON.stringify({ error: "Mã QR định danh không hợp lệ" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (emp.status !== "Đang làm việc" && emp.status !== "đang làm" && emp.status !== "active") {
        return new Response(JSON.stringify({ error: "Nhân viên đã nghỉ việc hoặc không khả dụng" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const payload = {
        role: "authenticated",
        iss: "supabase",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // CBNV lưu phiên 30 ngày
        user_metadata: {
          type: "cbnv",
          employee_name: emp.name
        }
      };

      const jwt = await signJWT(payload, jwtSecret);
      return new Response(JSON.stringify({ access_token: jwt, employee_name: emp.name }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --- CÁC ENDPOINTS YÊU CẦU XÁC THỰC JWT ---
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Yêu cầu xác thực" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const token = authHeader.substring(7);
    const decoded = await verifyJWT(token, jwtSecret);
    if (!decoded) {
      return new Response(JSON.stringify({ error: "Phiên làm việc hết hạn hoặc không hợp lệ" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const meta = decoded.user_metadata;

    // 3. ENDPOINT: /checkin (CBNV ghi log chấm công)
    if (path.endsWith("/checkin")) {
      if (meta.type !== "cbnv") {
        return new Response(JSON.stringify({ error: "Không có quyền thực hiện hành động này" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { latitude, longitude, accuracy, nearest_office, distance, status, address, note } = await req.json();

      const { data, error } = await supabase
        .from("chamcong_attendance_logs")
        .insert([{
          employee_name: meta.employee_name,
          latitude,
          longitude,
          accuracy: Math.round(accuracy),
          nearest_office,
          distance: Math.round(distance),
          status,
          address,
          note
        }])
        .select();

      if (error) throw error;

      // Gửi Telegram cá nhân thông báo chấm công
      try {
        const { data: emp } = await supabase
          .from("chamcong_employees")
          .select("telegram_chat_id")
          .eq("name", meta.employee_name)
          .maybeSingle();

        if (emp && emp.telegram_chat_id) {
          const vnTime = new Date(new Date().getTime() + (7 * 60 * 60 * 1000));
          const timeStr = `${vnTime.getUTCDate().toString().padStart(2,'0')}/${(vnTime.getUTCMonth()+1).toString().padStart(2,'0')}/${vnTime.getUTCFullYear()} ${vnTime.getUTCHours().toString().padStart(2,'0')}:${vnTime.getUTCMinutes().toString().padStart(2,'0')}:${vnTime.getUTCSeconds().toString().padStart(2,'0')}`;

          const msg = `✅ <b>Xác nhận chấm công thành công</b>\n\n`
            + `👤 <b>${meta.employee_name}</b>\n`
            + `⏰ Thời gian: ${timeStr}\n`
            + `📍 Địa điểm: ${nearest_office || 'Không xác định'}\n`
            + `✔️ Trạng thái: <b>${status && status.includes('Hợp lệ') ? 'Hợp lệ' : 'Ngoài phạm vi'}</b>`;

          await sendTelegramMsg(emp.telegram_chat_id, msg);
        }
      } catch (tgErr) {
        console.error("Lỗi gửi Telegram checkin:", tgErr);
      }

      return new Response(JSON.stringify({ success: true, data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 4. ENDPOINT: /justification (CBNV gửi giải trình)
    if (path.endsWith("/justification")) {
      if (meta.type !== "cbnv") {
        return new Response(JSON.stringify({ error: "Không có quyền thực hiện hành động này" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { date, reason } = await req.json();
      if (!date || !reason) {
        return new Response(JSON.stringify({ error: "Thiếu thông tin ngày hoặc lý do" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data, error } = await supabase
        .from("chamcong_attendance_records")
        .update({
          justification: reason,
          approve_status: "Chờ"
        })
        .eq("employee_name", meta.employee_name)
        .eq("date", date)
        .select();

      if (error) throw error;

      if (!data || data.length === 0) {
        const { error: insErr } = await supabase
          .from("chamcong_attendance_records")
          .insert([{
            employee_name: meta.employee_name,
            date: date,
            grades: "D,D,D,D",
            justification: reason,
            approve_status: "Chờ"
          }]);
        if (insErr) throw insErr;
      }

      // Gửi Telegram báo cho TBP
      try {
        const { data: userEmp } = await supabase
          .from("chamcong_employees")
          .select("department")
          .eq("name", meta.employee_name)
          .maybeSingle();

        if (userEmp && userEmp.department) {
          const { data: tbp } = await supabase
            .from("chamcong_employees")
            .select("telegram_chat_id")
            .eq("role", "TBP")
            .eq("department", userEmp.department)
            .maybeSingle();

          if (tbp && tbp.telegram_chat_id) {
            const adminUrl = 'https://hasttechnical2025-prog.github.io/hast_chamcong/giaitrinh/';
            const msg = `📋 <b>Giải trình mới cần duyệt</b>\n\n`
              + `👤 <b>${meta.employee_name}</b>\n`
              + `📅 Ngày: ${date}\n`
              + `📝 Lý do: ${reason}\n\n`
              + `🔗 <a href="${adminUrl}">Mở trang duyệt giải trình</a>`;

            await sendTelegramMsg(tbp.telegram_chat_id, msg);
          }
        }
      } catch (tgErr) {
        console.error("Lỗi gửi Telegram báo giải trình:", tgErr);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 5. ENDPOINT: /approve (TBP hoặc Admin duyệt/từ chối giải trình)
    if (path.endsWith("/approve")) {
      if (meta.type !== "admin") {
        return new Response(JSON.stringify({ error: "Không có quyền thực hiện hành động này" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { employee_name, date, approve_status, approve_note } = await req.json();

      if (meta.role === "TBP") {
        const { data: targetEmp, error: empErr } = await supabase
          .from("chamcong_employees")
          .select("department")
          .eq("name", employee_name)
          .maybeSingle();

        if (empErr || !targetEmp || targetEmp.department !== meta.department) {
          return new Response(JSON.stringify({ error: "Bạn không có quyền duyệt phòng ban này" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      const { data: updated, error } = await supabase
        .from("chamcong_attendance_records")
        .update({
          approve_status,
          approve_note,
          approve_time: new Date().toISOString()
        })
        .eq("employee_name", employee_name)
        .eq("date", date)
        .select();

      if (error) throw error;

      // Bản ghi ảo (chưa tồn tại trong DB) -> insert mới để lưu kết quả duyệt.
      // Đặt sau kiểm tra phòng ban ở trên nên TBP vẫn không thể ghi phòng khác.
      if (!updated || updated.length === 0) {
        const { error: insErr } = await supabase
          .from("chamcong_attendance_records")
          .insert([{
            employee_name,
            date,
            grades: "D,D,D,D",
            approve_status,
            approve_note,
            approve_time: new Date().toISOString()
          }]);
        if (insErr) throw insErr;
      }

      // Gửi Telegram báo kết quả cho nhân viên
      try {
        const { data: emp } = await supabase
          .from("chamcong_employees")
          .select("telegram_chat_id")
          .eq("name", employee_name)
          .maybeSingle();

        if (emp && emp.telegram_chat_id) {
          const msg = `🔔 <b>Kết quả duyệt giải trình</b>\n\n`
            + `👤 Nhân viên: <b>${employee_name}</b>\n`
            + `📅 Ngày: ${date}\n`
            + `📝 Trạng thái: <b>${approve_status === 'Đồng ý' ? 'Đồng ý' : 'Từ chối'}</b>\n`
            + `${approve_note ? `💬 Ghi chú TBP: ${approve_note}` : ''}`;

          await sendTelegramMsg(emp.telegram_chat_id, msg);
        }
      } catch (tgErr) {
        console.error("Lỗi gửi Telegram báo kết quả duyệt:", tgErr);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 6. ENDPOINT: /send-telegram (Gửi tin nhắn tuỳ ý qua Telegram Bot)
    if (path.endsWith("/send-telegram")) {
      const { chat_id, message } = await req.json();
      if (!chat_id || !message) {
        return new Response(JSON.stringify({ error: "Thiếu chat_id hoặc nội dung tin nhắn" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      await sendTelegramMsg(chat_id, message);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 7. ENDPOINT: /admin/write (Proxy ghi dữ liệu an toàn cho Admin/TBP)
    if (path.endsWith("/admin/write")) {
      if (meta.type !== "admin") {
        return new Response(JSON.stringify({ error: "Không có quyền thực hiện hành động này" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { table, action, data, eqColumn, eqValue } = await req.json();

      let query = supabase.from(table);
      let result;

      if (action === "insert") {
        result = await query.insert(data).select();
      } else if (action === "update") {
        result = await query.update(data).eq(eqColumn, eqValue).select();
      } else if (action === "upsert") {
        // Chèn hoặc cập nhật theo khoá chính của bảng (vd system_config.key)
        result = await query.upsert(data).select();
      } else if (action === "delete") {
        result = await query.delete().eq(eqColumn, eqValue).select();
      } else {
        return new Response(JSON.stringify({ error: "Hành động Ghi không hợp lệ" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (result.error) throw result.error;

      return new Response(JSON.stringify({ success: true, data: result.data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 7b. ENDPOINT: /admin/account (Quản lý tài khoản TBP/Admin - CHỈ admin)
    // Gọi RPC qua service_role; RPC đã bị thu hồi execute khỏi public/authenticated
    // -> chỉ admin (qua đây) mới tạo/sửa/xóa/đổi mật khẩu tài khoản. Chống leo thang quyền.
    if (path.endsWith("/admin/account")) {
      if (meta.type !== "admin") {
        return new Response(JSON.stringify({ error: "Không có quyền thực hiện hành động này" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { op, username, password, role, department, id } = await req.json();
      let r;
      if (op === "list") {
        r = await supabase.rpc("chamcong_list_accounts");
      } else if (op === "save") {
        r = await supabase.rpc("chamcong_upsert_account", {
          p_username: username, p_password: password || "", p_role: role, p_department: department || null
        });
      } else if (op === "delete") {
        r = await supabase.rpc("chamcong_delete_account", { p_id: id });
      } else if (op === "password") {
        r = await supabase.rpc("chamcong_update_password", { p_username: username, p_password: password });
      } else {
        return new Response(JSON.stringify({ error: "Thao tác không hợp lệ" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (r.error) throw r.error;
      return new Response(JSON.stringify({ success: true, data: r.data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 8. ENDPOINT: /admin/deploy (Trigger GitHub Action)
    if (path.endsWith("/admin/deploy")) {
      if (meta.type !== "admin") {
        return new Response(JSON.stringify({ error: "Không có quyền thực hiện hành động này" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { owner, repo } = await req.json();
      if (!owner || !repo) {
        return new Response(JSON.stringify({ error: "Thiếu thông tin owner hoặc repo GitHub" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const githubPat = Deno.env.get("GITHUB_PAT") ?? "";
      if (!githubPat) {
        return new Response(JSON.stringify({ error: "Chưa cấu hình GITHUB_PAT trên Supabase Secrets" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const ghResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${githubPat}`,
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "Supabase_Edge_Function"
        },
        body: JSON.stringify({
          event_type: "deploy-pwa"
        })
      });

      if (!ghResponse.ok) {
        const errText = await ghResponse.text();
        throw new Error(`Lỗi gọi GitHub API (${ghResponse.status}): ${errText}`);
      }

      return new Response(JSON.stringify({ success: true, message: "Đã kích hoạt GitHub Action Deploy thành công!" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ error: "Không tìm thấy Endpoint" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (e: any) {
    console.error("Internal API Error:", e);
    return new Response(JSON.stringify({ error: e.message || "Lỗi hệ thống xảy ra" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
