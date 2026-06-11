import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    // KHỞI TẠO CLIENT VỚI SCHEMA public MẶC ĐỊNH
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = Deno.env.get("TELEGRAM_TOKEN")!;
    const groupChatId = "-1003782837084";

    // ── Tính ngày hôm nay theo UTC+7 ──────────────────────
    const now = new Date();
    const vnDate = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const dow = vnDate.getUTCDay(); // 0=CN, 6=T7
    const today = vnDate.toISOString().split("T")[0]; // YYYY-MM-DD

    const h = vnDate.getUTCHours();
    const m = vnDate.getUTCMinutes();
    const currentMins = h * 60 + m; // Số phút từ đầu ngày

    // Định nghĩa 4 khung giờ quét
    let activeSession = "";
    if (currentMins >= 450 && currentMins <= 485) activeSession = "morning_in";
    else if (currentMins >= 720 && currentMins <= 765) activeSession = "morning_out";
    else if (currentMins >= 766 && currentMins <= 785) activeSession = "afternoon_in";
    else if (currentMins >= 1020 && currentMins <= 1080) activeSession = "afternoon_out";

    if (!activeSession) {
      return new Response(JSON.stringify({ ok: true, msg: "Not in active reminder time window." }));
    }

    // ── Bỏ qua T7/CN ──────────────────────────────────────
    if (dow === 0 || dow === 6) {
      return new Response(JSON.stringify({ ok: true, skipped: "weekend" }));
    }

    // ── Bỏ qua ngày lễ/tết (Đọc từ bảng public.chamcong_holidays) ──
    const { data: holiday } = await supabase
      .from("chamcong_holidays")
      .select("description")
      .eq("date", today)
      .maybeSingle();

    if (holiday) {
      return new Response(JSON.stringify({ ok: true, skipped: "holiday" }));
    }

    // ── Lấy danh sách nhân viên Active (Bảng public.chamcong_employees) ──
    const { data: emps, error: empErr } = await supabase
      .from("chamcong_employees")
      .select("name, telegram_chat_id, status")
      .or('status.is.null,status.ilike.%đang%,status.ilike.%active%,status.ilike.%làm%');

    if (empErr || !emps) throw empErr || new Error("No employees found");

    // ── Lấy Record của ngày hôm nay (Bảng public.chamcong_attendance_records) ──
    const { data: records, error: recErr } = await supabase
      .from("chamcong_attendance_records")
      .select("*")
      .eq("date", today);

    if (recErr) throw recErr;

    const recordMap = new Map();
    (records || []).forEach((r: any) => recordMap.set(r.employee_name, r));

    const absentList: string[] = [];
    const personalMsgs: Promise<Response>[] = [];

    let sessionName = "";
    let timeRangeMsg = "";

    // Phân tích theo từng khung giờ
    emps.forEach((e: any) => {
      const r = recordMap.get(e.name);
      let isMissing = false;
      let personalText = "";

      if (activeSession === "morning_in") {
        sessionName = "Check In Sáng";
        timeRangeMsg = "từ 00:01 đến thời điểm hiện tại";
        if (!r || !r.morning_in) {
          isMissing = true;
          personalText = "Bạn chưa chấm công Check In sáng hôm nay. Hãy chấm công nhé!";
        }
      }
      else if (activeSession === "morning_out") {
        sessionName = "Check Out Sáng";
        timeRangeMsg = "từ 09:30 đến thời điểm hiện tại";
        // Chỉ tính người có đi làm sáng (có morning_in hợp lệ)
        if (r && r.morning_in && !r.morning_out) {
          isMissing = true;
          personalText = "Bạn chưa chấm công Check Out sáng hôm nay. Hãy chấm công nhé!";
        }
      }
      else if (activeSession === "afternoon_in") {
        sessionName = "Check In Chiều";
        timeRangeMsg = "từ 12:46 đến thời điểm hiện tại";
        if (!r || !r.afternoon_in) {
          isMissing = true;
          personalText = "Bạn chưa chấm công Check In chiều hôm nay. Hãy chấm công nhé!";
        }
      }
      else if (activeSession === "afternoon_out") {
        sessionName = "Check Out Chiều";
        timeRangeMsg = "từ 15:30 đến thời điểm hiện tại";
        // Chỉ tính người có đi làm chiều (có afternoon_in hợp lệ)
        if (r && r.afternoon_in && !r.afternoon_out) {
          isMissing = true;
          personalText = "Bạn chưa chấm công Check Out chiều hôm nay. Hãy chấm công nhé!";
        }
      }

      if (isMissing) {
        absentList.push(e.name);
        // Gửi tin nhắn cá nhân nếu có ID Telegram
        if (e.telegram_chat_id) {
          personalMsgs.push(
            fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: e.telegram_chat_id,
                text: `⏰ <b>Nhắc nhở chấm công</b>\n\n👤 ${e.name}\n❗️ ${personalText}`,
                parse_mode: "HTML"
              }),
            })
          );
        }
      }
    });

    // Chờ gửi xong tất cả tin cá nhân
    await Promise.allSettled(personalMsgs);

    // Gửi thông báo tổng hợp lên Group công ty
    if (absentList.length > 0) {
      const [y, m, d] = today.split("-");
      const groupMsg = `📢 <b>Nhắc nhở chấm công [${sessionName}]</b>\n`
        + `📅 Ngày: ${d}/${m}/${y}\n`
        + `🕒 Thời gian quét: ${timeRangeMsg}\n\n`
        + `<b>Danh sách CBNV chưa chấm công:</b>\n`
        + absentList.map((name, i) => `${i + 1}. ${name}`).join("\n");

      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: groupChatId,
          text: groupMsg,
          parse_mode: "HTML"
        }),
      });
    }

    return new Response(JSON.stringify({ ok: true, notified: absentList.length }));
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500 });
  }
});
