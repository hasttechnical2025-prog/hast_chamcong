import { SUPABASE_FUNC_URL } from './config.js';

/**
 * Gửi tin nhắn Telegram thông qua Supabase Edge Function API (Đã gộp vào /api)
 * @param {string|number} chatId - ID chat Telegram nhận tin
 * @param {string} message - Nội dung tin nhắn (hỗ trợ HTML)
 * @returns {Promise<any>}
 */
export async function sendTelegram(chatId, message) {
  if (!chatId) return null;
  const jwt = localStorage.getItem('hstc_jwt') || sessionStorage.getItem('hstc_jwt') || '';

  try {
    const response = await fetch(`${SUPABASE_FUNC_URL}/api/send-telegram`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`
      },
      body: JSON.stringify({ chat_id: chatId, message: message }),
      redirect: 'follow'
    });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      return {};
    }
  } catch (error) {
    console.warn('[Telegram]', error.message);
    return null;
  }
}
