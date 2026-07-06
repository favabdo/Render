// services/whatsapp.service.js
// كل التعامل مع WhatsApp Cloud API: بعت رسائل، والتحقق من بيانات اعتماد Inbox جديد

const axios = require('axios');
const env = require('../config/env');
const conversationRepo = require('../repositories/conversation.repo');
const inboxRepo = require('../repositories/inbox.repo');
const { normalizeDigits } = require('../utils/helpers');

const GRAPH_API_VERSION = 'v20.0';

// بيرجع الـ credentials المناسبة للرد: لو المحادثة مربوطة بـ Inbox مضاف من الإعدادات
// بنستخدم رقمه وتوكنه هو، ولو مفيش (محادثات قديمة قبل ما نضيف الـ Inboxes) بنرجع
// لمتغيرات الـ .env القديمة عشان الاستمرارية من غير أي كسر
async function resolveCredentials(inboxId) {
  if (inboxId) {
    const inbox = await inboxRepo.getInboxById(inboxId);
    if (inbox && inbox.phone_number_id && inbox.access_token) {
      return { phoneNumberId: inbox.phone_number_id, accessToken: inbox.access_token };
    }
  }
  return {
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
  };
}

/**
 * مرحلة 1 (سريعة، بدون أي استدعاء لميتا): بتسجل الرسالة فورًا بحالة 'sending'
 * وترجعها فورًا عشان تتبعت على الـ socket فورًا (التيك بيبقى "بيحمّل" لحد ما
 * مرحلة 2 تخلص فعليًا، مش لحد ما الرسالة توصل للعميل).
 */
async function createOutgoingMessage(toNumber, text, conversationId, inboxId, sender) {
  const { phoneNumberId } = await resolveCredentials(inboxId);
  return conversationRepo.saveMessage({
    waMessageId: null,
    conversationId,
    direction: 'out',
    fromNumber: phoneNumberId,
    toNumber,
    messageType: 'text',
    messageText: text,
    status: 'sending',
    sentByUserId: sender?.id || null,
    sentByName: sender?.name || null,
  });
}

/**
 * مرحلة 2 (فعليًا بتكلم ميتا): بتاخد الرسالة اللي اتسجلت فعلاً في createOutgoingMessage
 * وتحاول تبعتها لواتساب. لو في نت وميتا ردت بنجاح -> بتقفل الرسالة بحالة 'sent'
 * ومعاها الـ wa_message_id الحقيقي (تيك واحد). لو فشل الاتصال أو ميتا رفضت
 * -> بتقفلها بحالة 'failed'. الكولباك onFinalized بيتنادى بالنتيجة النهائية
 * عشان اللي استدعى الدالة (الكنترولر) يبعتها لايف على الـ socket فورًا.
 */
async function deliverOutgoingMessage(savedMessage, { toNumber, text, inboxId }, onFinalized) {
  let finalRow;
  try {
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

    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const waMessageId = response.data?.messages?.[0]?.id || null;
    finalRow = await conversationRepo.finalizeOutgoingMessage(savedMessage.id, {
      waMessageId,
      status: waMessageId ? 'sent' : 'failed',
    });
  } catch (err) {
    // فشل الاتصال بميتا (مفيش نت من السيرفر، أو توكن غلط، أو أي سبب تاني) —
    // بنقفل الرسالة بحالة 'failed' بدل ما تفضل عالقة على 'sending' للأبد
    finalRow = await conversationRepo.finalizeOutgoingMessage(savedMessage.id, { status: 'failed' });
  }
  if (onFinalized) onFinalized(finalRow);
  return finalRow;
}

// النسخة القديمة (متزامنة بالكامل، بتستنى ميتا قبل ما ترجع) — لسه موجودة لأي كود
// تاني ممكن يعتمد عليها، بس reply() في الكنترولر بقى بيستخدم النسختين الجداد فوق
async function sendTextMessage(toNumber, text, conversationId = null, inboxId = null, sender = null) {
  const saved = await createOutgoingMessage(toNumber, text, conversationId, inboxId, sender);
  return deliverOutgoingMessage(saved, { toNumber, text, inboxId });
}

/**
 * تحقق حقيقي من إن التلاتة بيانات دي بتاعة بعض فعلاً (من غير Business Account ID):
 * - بنسأل ميتا مباشرة عن الـ phoneNumberId ده بالـ accessToken اللي المستخدم كتبه
 *   (لو الـ ID غلط أو التوكن مالوش صلاحية عليه، ميتا هترفض الطلب من الأول)
 * - بعدين بنقارن الرقم الحقيقي اللي رجع من ميتا (display_phone_number) بالرقم اللي المستخدم كتبه
 *
 * لو أي شرط من دول فشل، بيرمي Error برسالة واضحة بالعربي.
 * لو كله تمام، بيرجع { verifiedName, displayPhoneNumber } من بيانات ميتا نفسها (مش من كلام المستخدم).
 */
async function verifyWhatsappCredentials({ phoneNumber, phoneNumberId, accessToken }) {
  if (!phoneNumber || !phoneNumberId || !accessToken) {
    const err = new Error('لازم تدخل الرقم و Phone Number ID و API key التلاتة مع بعض');
    err.code = 'MISSING_FIELDS';
    throw err;
  }

  let phoneData;
  try {
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}`;
    const response = await axios.get(url, {
      params: { fields: 'id,display_phone_number,verified_name' },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    phoneData = response.data;
  } catch (err) {
    const metaError = err.response?.data?.error?.message;
    const e = new Error(
      metaError ||
        'مقدرناش نوصل لبيانات الـ Phone Number ID ده — تأكد إن الـ ID صح وإن الـ API key عنده صلاحية عليه'
    );
    e.code = 'META_REQUEST_FAILED';
    throw e;
  }

  if (!phoneData || !phoneData.display_phone_number) {
    const e = new Error('الـ Phone Number ID ده مش موجود عند ميتا أو التوكن مالوش صلاحية عليه');
    e.code = 'PHONE_NOT_FOUND';
    throw e;
  }

  const typedDigits = normalizeDigits(phoneNumber);
  const realDigits = normalizeDigits(phoneData.display_phone_number);
  if (typedDigits !== realDigits) {
    const e = new Error(
      `الرقم اللي كتبته مش هو الرقم المسجل فعليًا على الـ Phone Number ID ده (الرقم الحقيقي: ${phoneData.display_phone_number})`
    );
    e.code = 'PHONE_MISMATCH';
    throw e;
  }

  return {
    verifiedName: phoneData.verified_name || null,
    displayPhoneNumber: phoneData.display_phone_number || null,
  };
}

module.exports = {
  sendTextMessage,
  createOutgoingMessage,
  deliverOutgoingMessage,
  verifyWhatsappCredentials,
};
