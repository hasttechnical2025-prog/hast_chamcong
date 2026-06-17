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

    // ── Lấy cấu hình các ca làm việc (Bảng public.chamcong_shift_config) ──
    const { data: shifts, error: shiftErr } = await supabase
      .from("chamcong_shift_config")
      .select("*");

    if (shiftErr) throw shiftErr;

    const timeToMin = (t: string) => {
      if (!t) return null;
      const [h, m] = t.split(":");
      return parseInt(h, 10) * 60 + parseInt(m, 10);
    };

    const shiftMap = new Map();
    const morningInMins = new Set<number>();

    (shifts || []).forEach((s: any) => {
      const type = s.shift_type;
      if (!shiftMap.has(type)) {
        shiftMap.set(type, new Map());
      }
      shiftMap.get(type).set(s.session, s);

      if (s.session === "morning_in" && s.a_end) {
        const m = timeToMin(s.a_end);
        if (m !== null) morningInMins.add(m - 5);
      }
    });

    const isMorningInTime = morningInMins.has(currentMins);
    const isMorningOutTime = (currentMins === 735);   // 12:15
    const isAfternoonInTime = (currentMins === 780);  // 13:00
    const isAfternoonOutTime = (currentMins === 1035); // 17:15

    if (!isMorningInTime && !isMorningOutTime && !isAfternoonInTime && !isAfternoonOutTime) {
      return new Response(JSON.stringify({ ok: true, msg: "Not in active reminder time window.", currentMins }));
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
      .select("name, telegram_chat_id, status, loai_ca")
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

    const absentBySession: Record<string, string[]> = {};
    const personalMsgs: Promise<Response>[] = [];

    // Phân tích theo từng khung giờ và loại ca của mỗi nhân viên
    emps.forEach((e: any) => {
      const lc = e.loai_ca || 'tieu_chuan';
      const shiftCfg = shiftMap.get(lc) || shiftMap.get('tieu_chuan');
      if (!shiftCfg) return;

      const r = recordMap.get(e.name);
      let isMissing = false;
      let personalText = "";
      let sessionName = "";

      // 1. Check In Sáng (Trước mốc A_END 5 phút)
      const mInCfg = shiftCfg.get("morning_in");
      if (mInCfg && mInCfg.a_end) {
        const aEndMin = timeToMin(mInCfg.a_end);
        if (aEndMin !== null && currentMins === aEndMin - 5) {
          sessionName = "Sáng IN";
          if (!r || !r.morning_in) {
            isMissing = true;
            personalText = `Bạn chưa chấm công Sáng IN. Mốc vào ca của bạn là ${mInCfg.a_end.substring(0,5)}, hãy chấm công ngay nhé!`;
          }
        }
      }

      // 2. Check Out Sáng (12:15 = 735 mins)
      if (currentMins === 735) {
        sessionName = "Sáng OUT";
        // Chỉ tính người có đi làm sáng (có morning_in hợp lệ)
        if (r && r.morning_in && !r.morning_out) {
          isMissing = true;
          personalText = "Bạn chưa chấm công Sáng OUT nghỉ trưa. Hãy chấm công nhé!";
        }
      }

      // 3. Check In Chiều (13:00 = 780 mins)
      if (currentMins === 780) {
        sessionName = "Chiều IN";
        // CHỐNG SPAM: Chỉ nhắc chiều IN nếu người đó ĐÃ ĐI LÀM SÁNG NAY (có morning_in hoặc morning_out)
        // Nếu nghỉ cả ngày, họ đã bị nhắc ở Sáng IN và sẽ không bị spam tiếp ở Chiều IN.
        if (r && (r.morning_in || r.morning_out) && !r.afternoon_in) {
          isMissing = true;
          personalText = "Bạn chưa chấm công Chiều IN. Hãy chấm công ngay nhé!";
        }
      }

      // 4. Check Out Chiều (17:15 = 1035 mins)
      if (currentMins === 1035) {
        sessionName = "Chiều OUT";
        // Chỉ tính người có đi làm chiều (có afternoon_in hợp lệ)
        if (r && r.afternoon_in && !r.afternoon_out) {
          isMissing = true;
          personalText = "Bạn chưa chấm công Chiều OUT lúc ra về. Hãy chấm công nhé!";
        }
      }

      if (isMissing && sessionName) {
        if (!absentBySession[sessionName]) absentBySession[sessionName] = [];
        absentBySession[sessionName].push(e.name);

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
    let totalNotified = 0;
    const [y, m, d] = today.split("-");
    const groupMsgs = Object.keys(absentBySession).map(sessionName => {
      const list = absentBySession[sessionName];
      totalNotified += list.length;

      let timeRangeMsg = "";
      if (sessionName === "Sáng IN") timeRangeMsg = "trước mốc vào ca 5 phút";
      else if (sessionName === "Sáng OUT") timeRangeMsg = "vào lúc 12:15";
      else if (sessionName === "Chiều IN") timeRangeMsg = "vào lúc 13:00";
      else if (sessionName === "Chiều OUT") timeRangeMsg = "vào lúc 17:15";

      const groupMsg = `📢 <b>Nhắc nhở chấm công [${sessionName}]</b>\n`
        + `📅 Ngày: ${d}/${m}/${y}\n`
        + `🕒 Thời gian quét: ${timeRangeMsg}\n\n`
        + `<b>Danh sách CBNV chưa chấm công:</b>\n`
        + list.map((name, i) => `${i + 1}. ${name}`).join("\n");

      return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: groupChatId,
          text: groupMsg,
          parse_mode: "HTML"
        }),
      });
    });

    await Promise.allSettled(groupMsgs);

    return new Response(JSON.stringify({ ok: true, notified: totalNotified }));
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500 });
  }
});
