const axios = require('axios');
const { saveMessage } = require('./messagesRepo');
const { getInboxById } = require('./inboxesRepo');

const GRAPH_API_VERSION = 'v20.0';

// بيرجع الـ credentials المناسبة للرد: لو المحادثة مربوطة بـ Inbox مضاف من الإعدادات
// بنستخدم رقمه وتوكنه هو، ولو مفيش (محادثات قديمة قبل ما نضيف الـ Inboxes) بنرجع
// لمتغيرات الـ .env القديمة عشان الاستمرارية من غير أي كسر
async function resolveCredentials(inboxId) {
  if (inboxId) {
    const inbox = await getInboxById(inboxId);
    if (inbox && inbox.phone_number_id && inbox.access_token) {
      return { phoneNumberId: inbox.phone_number_id, accessToken: inbox.access_token };
    }
  }
  return {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  };
}

async function sendTextMessage(toNumber, text, conversationId = null, inboxId = null, sender = null) {
  const { phoneNumberId, accessToken } = await resolveCredentials(inboxId);
  if (!phoneNumberId || !accessToken) {
    throw new Error('مفيش بيانات اعتماد واتساب متاحة — ضيف Inbox من الإعدادات أو اضبط متغيرات الـ .env');
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to: toNumber,
    type: 'text',
    text: { body: text },
  };

  let response;
  try {
    response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    const metaError = err.response?.data?.error;
    if (metaError) {
      // بنوري رسالة ميتا الحقيقية بدل رسالة axios العامة (زي "Request failed with status code 401")
      // عشان نعرف السبب الفعلي: توكن منتهي، توكن غلط، أو صلاحيات ناقصة
      const e = new Error(`ميتا رفضت الرسالة: ${metaError.message}${metaError.code ? ` (code ${metaError.code})` : ''}`);
      e.metaError = metaError;
      throw e;
    }
    throw err;
  }

  const waMessageId = response.data?.messages?.[0]?.id || null;

  const saved = await saveMessage({
    waMessageId,
    conversationId,
    direction: 'out',
    fromNumber: phoneNumberId,
    toNumber,
    messageType: 'text',
    messageText: text,
    rawPayload: JSON.stringify(response.data),
    sentByUserId: sender?.id || null,
    sentByName: sender?.name || null,
  });

  return saved;
}

module.exports = { sendTextMessage };
