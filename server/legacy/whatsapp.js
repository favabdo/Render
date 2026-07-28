// whatsapp.js
// دوال التعامل مع WhatsApp Cloud API (بعت رسائل من السيرفر للعميل)

const axios = require('axios');

const GRAPH_VERSION = 'v20.0';

function getConfig() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    throw new Error(
      '[WhatsApp] Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN in environment variables.'
    );
  }
  return { phoneNumberId, accessToken };
}

/**
 * بعت رسالة نصية عادية لرقم واتساب معين
 * @param {string} to - رقم العميل بصيغة دولية بدون + (مثال: 201001234567)
 * @param {string} text - نص الرسالة
 */
async function sendTextMessage(to, text) {
  const { phoneNumberId, accessToken } = getConfig();

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;

  const response = await axios.post(
    url,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text, preview_url: false },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  // بيرجع جوها id الرسالة المتولدة من واتساب (wa_message_id)
  return response.data;
}

/**
 * علّم رسالة واردة كـ "مقروءة" (اختياري لكن بيحسن تجربة العميل)
 */
async function markAsRead(waMessageId) {
  const { phoneNumberId, accessToken } = getConfig();
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;

  try {
    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: waMessageId,
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
  } catch (err) {
    console.error('[WhatsApp] markAsRead failed:', err.response?.data || err.message);
  }
}

module.exports = { sendTextMessage, markAsRead };
