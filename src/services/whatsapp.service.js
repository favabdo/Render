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

// ===== رسائل تفاعلية (أزرار / قايمة اختيار) =====
// بتتسجل في الداتابيز بنفس شكل رسالة نصية عادية (message_type: 'text',
// message_text = نص الجسم) عشان تتعرض عادي في لوحة التحكم من غير أي تعديل في
// الفرونت إند — الجزء التفاعلي (الأزرار/القايمة) بيتبعت لواتساب بس، مش بيتخزن
// كعنصر منفصل. العميل برضه يقدر يرد بالكتابة العادية بدل ما يضغط على أي اختيار.

/**
 * بترسل رسالة "قايمة اختيار" (List Message) لواتساب — مناسبة لتقييم النجوم
 * (1 لـ 5) عشان العميل يختار رقم بالضغط بدل ما يكتبه بنفسه.
 */
async function deliverOutgoingInteractiveMessage(savedMessage, { toNumber, interactive, inboxId }, onFinalized) {
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
      type: 'interactive',
      interactive,
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
    logger.error('❌ فشل إرسال رسالة تفاعلية لواتساب:', err.response?.data?.error?.message || err.message);
    finalRow = await conversationRepo.finalizeOutgoingMessage(savedMessage.id, { status: 'failed' });
  }
  if (onFinalized) onFinalized(finalRow);
  return finalRow;
}

// شكل قايمة اختيار نجوم من 1 لـ 5 (List Message برو واحد فيه 5 صفوف) — العميل
// بيضغط على تقييمه بدل ما يكتب رقم بنفسه (بيفضل برضه يقدر يكتب رقم عادي لو حب)
function buildStarRatingListInteractive(bodyText) {
  return {
    type: 'list',
    body: { text: bodyText },
    action: {
      button: 'اختار تقييمك',
      sections: [
        {
          title: 'التقييم من 1 لـ 5',
          rows: [
            { id: 'rating_1', title: '⭐ 1 نجمة' },
            { id: 'rating_2', title: '⭐⭐ 2 نجوم' },
            { id: 'rating_3', title: '⭐⭐⭐ 3 نجوم' },
            { id: 'rating_4', title: '⭐⭐⭐⭐ 4 نجوم' },
            { id: 'rating_5', title: '⭐⭐⭐⭐⭐ 5 نجوم' },
          ],
        },
      ],
    },
  };
}

// شكل رسالة فيها زرار واحد بس ("تخطي") جنب النص — العميل يقدر يدوس عليه عشان
// يتخطى فورًا من غير ما يكتب حاجة، أو يفضل يكتب تعليقه عادي بالكتابة
function buildSkippableTextInteractive(bodyText, skipLabel = 'تخطي') {
  return {
    type: 'button',
    body: { text: bodyText },
    action: {
      buttons: [{ type: 'reply', reply: { id: 'feedback_skip', title: skipLabel } }],
    },
  };
}

async function sendStarRatingMessage(toNumber, bodyText, conversationId = null, inboxId = null, sender = null) {
  const saved = await createOutgoingMessage(toNumber, bodyText, conversationId, inboxId, sender);
  return deliverOutgoingInteractiveMessage(saved, {
    toNumber,
    interactive: buildStarRatingListInteractive(bodyText),
    inboxId,
  });
}

async function sendSkippableTextMessage(toNumber, bodyText, conversationId = null, inboxId = null, sender = null, skipLabel = 'تخطي') {
  const saved = await createOutgoingMessage(toNumber, bodyText, conversationId, inboxId, sender);
  return deliverOutgoingInteractiveMessage(saved, {
    toNumber,
    interactive: buildSkippableTextInteractive(bodyText, skipLabel),
    inboxId,
  });
}

// ===== WhatsApp Flow (رسالة تقييم "ما بعد الحل" الموحّدة) =====
// بدل ما نبعت 3 رسايل متتالية (تقييم الحل -> تقييم الإيجنت -> تعليق نصي)، بنبعت
// رسالة واحدة من نوع Flow فيها الاتنين + خانة تعليق اختيارية وزرار إرسال واحد —
// العميل بيملاها كفورم جوه واتساب نفسه وبيرجعلنا كل حاجة سوا في رد واحد.
// ده محتاج WhatsApp Flow متعمله publish مسبقًا على مستوى الـ WABA بتاعة الـ Inbox
// (getOrCreateRatingFlowId بتعمل ده تلقائيًا أول مرة وتخزن الـ id في الـ Inbox)

// شاشة الفورم نفسها: عنوانين (تقييم حل المشكلة / تقييم الإيجنت) وتحت كل واحد
// قايمة اختيار نجوم من 1 لـ 5، وتحتهم خانة تعليق نصي اختيارية، وزرار إرسال
function buildRatingFlowJson() {
  const starOptions = [
    { id: '1', title: '⭐ 1 نجمة' },
    { id: '2', title: '⭐⭐ 2 نجوم' },
    { id: '3', title: '⭐⭐⭐ 3 نجوم' },
    { id: '4', title: '⭐⭐⭐⭐ 4 نجوم' },
    { id: '5', title: '⭐⭐⭐⭐⭐ 5 نجوم' },
  ];

  return {
    version: '6.3',
    screens: [
      {
        id: 'RATING',
        title: 'تقييم الخدمة',
        terminal: true,
        success: true,
        data: {},
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              type: 'Form',
              name: 'rating_form',
              children: [
                { type: 'TextHeading', text: 'تقييم حل المشكلة' },
                {
                  type: 'RadioButtonsGroup',
                  name: 'issue_rating',
                  label: 'قيّم مدى رضاك عن حل المشكلة',
                  required: true,
                  'data-source': starOptions,
                },
                { type: 'TextHeading', text: 'تقييم الإيجنت' },
                {
                  type: 'RadioButtonsGroup',
                  name: 'agent_rating',
                  label: 'قيّم ممثل خدمة العملاء اللي اتعامل معاك',
                  required: true,
                  'data-source': starOptions,
                },
                {
                  type: 'TextArea',
                  name: 'feedback_text',
                  label: 'إرسال تعليق إضافي (اختياري)',
                  required: false,
                },
                {
                  type: 'Footer',
                  label: 'إرسال',
                  'on-click-action': {
                    name: 'complete',
                    payload: {
                      issue_rating: '${form.issue_rating}',
                      agent_rating: '${form.agent_rating}',
                      feedback_text: '${form.feedback_text}',
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

// لو الـ Inbox متضاف بتوكن قديم من غير Business Account ID متسجل (كان بيحصل
// دايمًا قبل كده — الحقل ده مكنش بيتاخد وقت إضافة Inbox أصلاً)، بنحاول نكتشفه
// تلقائيًا من التوكن نفسه عن طريق /debug_token: التوكن (خصوصًا System User
// Token) بيكون عنده granular_scopes فيها target_ids بتقول هو مربوط بأي WABA.
// لو لقيناه، بنسجله في الـ Inbox عشان المرة الجاية نستخدمه على طول من غير
// ما نعمل الاكتشاف ده تاني
async function discoverBusinessAccountId(accessToken) {
  if (!accessToken) return null;
  try {
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/debug_token`;
    const response = await axios.get(url, {
      params: { input_token: accessToken, access_token: accessToken },
    });
    const scopes = response.data?.data?.granular_scopes || [];
    const managementScope = scopes.find((s) => s.scope === 'whatsapp_business_management');
    const messagingScope = scopes.find((s) => s.scope === 'whatsapp_business_messaging');
    const wabaId = managementScope?.target_ids?.[0] || messagingScope?.target_ids?.[0] || null;
    return wabaId;
  } catch (err) {
    logger.error('⚠️ تعذر اكتشاف Business Account ID تلقائيًا من التوكن:', err.response?.data?.error?.message || err.message);
    return null;
  }
}

// بيانات اعتماد "إدارية" (WABA id + توكن) لازمة لإنشاء/نشر الـ Flow — غير
// بيانات الإرسال العادية لأنها محتاجة صلاحية whatsapp_business_management على
// التوكن، مش whatsapp_business_messaging بس
async function resolveManagementCredentials(inboxId) {
  if (!inboxId) return { wabaId: null, accessToken: env.WHATSAPP_ACCESS_TOKEN || null };
  const inbox = await inboxRepo.getInboxById(inboxId);
  const accessToken = inbox?.access_token || env.WHATSAPP_ACCESS_TOKEN || null;

  let wabaId = inbox?.business_account_id || null;
  if (!wabaId && accessToken) {
    wabaId = await discoverBusinessAccountId(accessToken);
    if (wabaId) {
      await inboxRepo.setBusinessAccountId(inboxId, wabaId);
    }
  }

  return { wabaId, accessToken };
}

// بتعمل الـ Flow (فاضي) في الـ WABA، بترفعله محتوى الشاشة (flow.json)، وبعدين
// بتنشره (publish) عشان يبقى صالح للإرسال فعليًا للعملاء — بتترمي error واضح
// لو التوكن مش عنده صلاحية whatsapp_business_management عشان يبان السبب فورًا
// في اللوج بدل ما يفشل بصمت
async function createAndPublishRatingFlow(inboxId) {
  const { wabaId, accessToken } = await resolveManagementCredentials(inboxId);
  if (!wabaId || !accessToken) {
    throw new Error(
      'مفيش Business Account ID متاح لهذا الـ Inbox والاكتشاف التلقائي من التوكن فشل — ' +
        'ضيفه يدويًا من إعدادات الـ Inbox (WhatsApp Manager → API Setup → WhatsApp Business Account ID)'
    );
  }

  const createUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/flows`;
  const createRes = await axios.post(
    createUrl,
    { name: `تقييم ما بعد الحل - Inbox ${inboxId}`, categories: ['CUSTOMER_SUPPORT'] },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const flowId = createRes.data?.id;
  if (!flowId) throw new Error('ميتا مرجعتش flow id بعد إنشاء الـ Flow');

  const assetsUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${flowId}/assets`;
  const form = new FormData();
  form.append('name', 'flow.json');
  form.append('asset_type', 'FLOW_JSON');
  form.append('file', new Blob([JSON.stringify(buildRatingFlowJson())], { type: 'application/json' }), 'flow.json');
  await axios.post(assetsUrl, form, { headers: { Authorization: `Bearer ${accessToken}` } });

  const publishUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${flowId}/publish`;
  await axios.post(publishUrl, {}, { headers: { Authorization: `Bearer ${accessToken}` } });

  return flowId;
}

// بترجع الـ Flow id المتخزن للـ Inbox ده لو موجود، وإلا بتعمله (إنشاء + نشر)
// أول مرة وتخزنه عشان المرات الجاية تستخدمه على طول من غير ما تعمله تاني
async function getOrCreateRatingFlowId(inboxId) {
  if (!inboxId) throw new Error('لازم تحدد Inbox عشان تقدر تبعت WhatsApp Flow');
  const inbox = await inboxRepo.getInboxById(inboxId);
  if (inbox?.rating_flow_id) return inbox.rating_flow_id;

  const flowId = await createAndPublishRatingFlow(inboxId);
  await inboxRepo.setRatingFlowId(inboxId, flowId);
  return flowId;
}

function buildRatingFlowInteractive({ flowId, flowToken, bodyText }) {
  return {
    type: 'flow',
    body: { text: bodyText },
    action: {
      name: 'flow',
      parameters: {
        flow_message_version: '3',
        flow_token: flowToken,
        flow_id: flowId,
        flow_cta: 'قيّم تجربتك',
        flow_action: 'navigate',
        flow_action_payload: { screen: 'RATING', data: {} },
      },
    },
  };
}

// بتبعت رسالة الـ Flow الموحّدة (تقييمين + تعليق + إرسال في فقاعة واحدة).
// flowToken هو id صف التقييم (NileChat_ConversationRatings_byA) كنص، عشان لما
// الرد يرجع من واتساب نعرف نربطه بالطلب الصح
async function sendRatingFlowMessage(toNumber, { flowId, flowToken, bodyText }, conversationId = null, inboxId = null, sender = null) {
  const saved = await createOutgoingMessage(toNumber, bodyText, conversationId, inboxId, sender);
  return deliverOutgoingInteractiveMessage(saved, {
    toNumber,
    interactive: buildRatingFlowInteractive({ flowId, flowToken, bodyText }),
    inboxId,
  });
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
  sendStarRatingMessage,
  sendSkippableTextMessage,
  getOrCreateRatingFlowId,
  sendRatingFlowMessage,
  createOutgoingMessage,
  deliverOutgoingMessage,
  verifyWhatsappCredentials,
  invalidateCredentialsCache,
  downloadIncomingMedia,
  createOutgoingMediaMessage,
  deliverOutgoingMediaMessage,
  MEDIA_MESSAGE_TYPES,
};
