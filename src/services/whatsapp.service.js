// services/whatsapp.service.js
// كل التعامل مع WhatsApp Cloud API: بعت رسائل، والتحقق من بيانات اعتماد Inbox جديد

const axios = require('axios');
const env = require('../config/env');
const conversationRepo = require('../repositories/conversation.repo');
const inboxRepo = require('../repositories/inbox.repo');
const { normalizeDigits } = require('../utils/helpers');
const mediaStorage = require('../utils/mediaStorage');
const logger = require('../utils/logger');

const GRAPH_API_VERSION = 'v20.0';

// أنواع الرسائل اللي WhatsApp Cloud API بتدعمها للوسائط (بره النص العادي)
const MEDIA_MESSAGE_TYPES = ['image', 'video', 'audio', 'document', 'sticker'];

// كاش بسيط في الذاكرة لبيانات اعتماد كل Inbox — التوكن ورقم الهاتف بتاعين الـ Inbox
// بيتغيروا نادرًا جدًا (بس وقت الإضافة نفسها تقريبًا)، فمفيش داعي نعمل رحلة كاملة
// للداتابيز في كل رسالة رد بس عشان نجيب نفس القيمة اللي مش هتتغير. الكاش ده بينتهي
// لوحده بعد دقيقة (TTL) عشان لو حصل تعديل فعلي (مثلاً استبدال التوكن) ينعكس بسرعة معقولة.
const CREDENTIALS_CACHE_TTL_MS = 60 * 1000;
const credentialsCache = new Map(); // inboxId -> { value, expiresAt }

// بيتنادى من inbox.controller.js لما حد يعدّل/يمسح Inbox، عشان الكاش ميفضلش
// شايل بيانات قديمة لحد ما الـ TTL ينتهي لوحده
function invalidateCredentialsCache(inboxId) {
  if (inboxId) credentialsCache.delete(String(inboxId));
  else credentialsCache.clear();
}

// بيرجع الـ credentials المناسبة للرد: لو المحادثة مربوطة بـ Inbox مضاف من الإعدادات
// بنستخدم رقمه وتوكنه هو، ولو مفيش (محادثات قديمة قبل ما نضيف الـ Inboxes) بنرجع
// لمتغيرات الـ .env القديمة عشان الاستمرارية من غير أي كسر
async function resolveCredentials(inboxId) {
  if (inboxId) {
    const cacheKey = String(inboxId);
    const cached = credentialsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const inbox = await inboxRepo.getInboxById(inboxId);
    if (inbox && inbox.phone_number_id && inbox.access_token) {
      const value = { phoneNumberId: inbox.phone_number_id, accessToken: inbox.access_token };
      credentialsCache.set(cacheKey, { value, expiresAt: Date.now() + CREDENTIALS_CACHE_TTL_MS });
      return value;
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

// ===== وسائط (صور / فيديوهات / صوتيات / مستندات) =====

/**
 * لما تجيلنا رسالة وسائط من العميل، ميتا بتبعتلنا "media id" بس مش رابط مباشر
 * (والرابط اللي ميتا بترجعه بينتهي سريعًا ومحتاج نفس التوكن). فبنعمل خطوتين:
 * 1) نسأل ميتا عن الرابط المؤقت الحقيقي بالـ media id ده
 * 2) ننزّل الملف فعليًا ونخزنه على السيرفر بتاعنا، ونرجع رابط ثابت (public/uploads)
 *    نقدر نعرضه في لوحة التحكم مباشرة من غير ما نحتاج توكن ميتا تاني
 */
async function downloadIncomingMedia(mediaId, inboxId = null) {
  if (!mediaId) return null;
  try {
    const { accessToken } = await resolveCredentials(inboxId);
    if (!accessToken) return null;

    const metaUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`;
    const metaResponse = await axios.get(metaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const { url, mime_type: mimeType, file_size: fileSize } = metaResponse.data || {};
    if (!url) return null;

    const fileResponse = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: 'arraybuffer',
      maxContentLength: 50 * 1024 * 1024, // حد أقصى 50MB لأي ملف وارد
    });

    const buffer = Buffer.from(fileResponse.data);
    const { publicUrl } = mediaStorage.saveBuffer(buffer, { folder: 'incoming', mimeType });

    return { url: publicUrl, mimeType: mimeType || null, fileSize: fileSize || null };
  } catch (err) {
    logger.error('❌ فشل تنزيل ميديا واردة من واتساب:', err.response?.data?.error?.message || err.message);
    return null;
  }
}

/**
 * بترفع ملف محلي (من public/uploads/outgoing) لسيرفرات ميتا نفسها، وبترجع
 * الـ media id بتاعه — الخطوة دي لازمة قبل بعت أي رسالة وسائط لأن WhatsApp
 * Cloud API بيطلب media id مرفوع عندهم الأول (أو رابط عام بديل، بس الرفع المباشر أوثق)
 */
async function uploadMediaToWhatsapp({ buffer, mimeType, fileName }, inboxId = null) {
  const { phoneNumberId, accessToken } = await resolveCredentials(inboxId);
  if (!phoneNumberId || !accessToken) {
    throw new Error('مفيش بيانات اعتماد واتساب متاحة — ضيف Inbox من الإعدادات أو اضبط متغيرات الـ .env');
  }

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', new Blob([buffer], { type: mimeType || 'application/octet-stream' }), fileName || 'file');

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/media`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.id) {
    throw new Error(data?.error?.message || 'فشل رفع الملف لواتساب');
  }
  return data.id;
}

/**
 * مرحلة 1 لرسالة وسائط صادرة (زي createOutgoingMessage بالظبط بس للوسائط):
 * بتسجل الرسالة فورًا بحالة 'sending' ورابط الملف المحلي (اللي هيتعرض في الشات
 * فورًا حتى قبل ما نخلص رفعه لواتساب فعليًا)
 */
async function createOutgoingMediaMessage(
  toNumber,
  { messageType, mediaUrl, mimeType, fileName, caption },
  conversationId,
  inboxId,
  sender
) {
  const { phoneNumberId } = await resolveCredentials(inboxId);
  return conversationRepo.saveMessage({
    waMessageId: null,
    conversationId,
    direction: 'out',
    fromNumber: phoneNumberId,
    toNumber,
    messageType,
    messageText: caption || null,
    mediaUrl,
    mediaMime: mimeType || null,
    mediaFileName: fileName || null,
    status: 'sending',
    sentByUserId: sender?.id || null,
    sentByName: sender?.name || null,
  });
}

/**
 * مرحلة 2 لرسالة وسائط صادرة: بترفع الملف المحلي لواتساب، وبعدين تبعت رسالة
 * الوسائط الفعلية (type: image/video/audio/document) بالـ media id اللي رجع.
 * نفس فلسفة deliverOutgoingMessage تمامًا (sent/failed + onFinalized callback)
 */
async function deliverOutgoingMediaMessage(
  savedMessage,
  { toNumber, buffer, messageType, mimeType, fileName, caption, inboxId },
  onFinalized
) {
  let finalRow;
  try {
    const { phoneNumberId, accessToken } = await resolveCredentials(inboxId);
    if (!phoneNumberId || !accessToken) {
      throw new Error('مفيش بيانات اعتماد واتساب متاحة — ضيف Inbox من الإعدادات أو اضبط متغيرات الـ .env');
    }

    const waMediaId = await uploadMediaToWhatsapp({ buffer, mimeType, fileName }, inboxId);

    const mediaPayload = { id: waMediaId };
    if (caption && messageType !== 'audio' && messageType !== 'sticker') {
      mediaPayload.caption = caption;
    }
    if (messageType === 'document' && fileName) {
      mediaPayload.filename = fileName;
    }

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      to: toNumber,
      type: messageType,
      [messageType]: mediaPayload,
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
    logger.error('❌ فشل إرسال رسالة وسائط لواتساب:', err.response?.data?.error?.message || err.message);
    finalRow = await conversationRepo.finalizeOutgoingMessage(savedMessage.id, { status: 'failed' });
  }
  if (onFinalized) onFinalized(finalRow);
  return finalRow;
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
  invalidateCredentialsCache,
  downloadIncomingMedia,
  createOutgoingMediaMessage,
  deliverOutgoingMediaMessage,
  MEDIA_MESSAGE_TYPES,
};
