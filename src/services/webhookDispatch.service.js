// services/webhookDispatch.service.js
// المسؤول الوحيد عن إرسال طلبات الـ HTTP الفعلية للـ Webhooks الصادرة اللي
// اليوزر سجّلها من صفحة Settings → Integrations. بيتنادى من أي مكان في الكود
// لما حدث حقيقي يحصل (رسالة جديدة، رد، Resolve...) عن طريق dispatchEvent فقط.

const crypto = require('crypto');
const logger = require('../utils/logger');
const webhookConfigRepo = require('../repositories/webhookConfig.repo');

// أنواع الأحداث المدعومة حاليًا — نفس القايمة دي بتتعرض في الواجهة كـ checkboxes
// عشان اليوزر يختار يشترك في أي حدث منها. الأسامي دي على نفس نمط Chatwoot.
const EVENT_TYPES = {
  CONVERSATION_CREATED: 'conversation_created',                // أول رسالة فتحت محادثة جديدة خالص
  CONVERSATION_STATUS_CHANGED: 'conversation_status_changed',   // status اتغير (assigned/closed/open...)
  CONVERSATION_UPDATED: 'conversation_updated',                 // تحديث عام على المحادثة (تعيين، ربط كونتاكت...)
  MESSAGE_CREATED: 'message_created',                           // رسالة جديدة اتسجلت (جاية من العميل أو رد من الإيجنت)
  MESSAGE_UPDATED: 'message_updated',                           // حالة رسالة اتغيرت (sent/delivered/read/failed)
  WEBWIDGET_TRIGGERED: 'webwidget_triggered',                   // فتح ويدجت الشات (مش متاحة فعليًا حاليًا — واتساب بس)
  CONTACT_CREATED: 'contact_created',                           // كونتاكت جديد اتسجل
  CONTACT_UPDATED: 'contact_updated',                           // بيانات كونتاكت اتعدلت
};

const ALL_EVENT_TYPES = Object.values(EVENT_TYPES);

const REQUEST_TIMEOUT_MS = 8000;

function signPayload(secret, rawBody) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

// بتبعت طلب POST واحد لـ webhook واحد، وبتسجّل نتيجة المحاولة (نجحت أو فشلت)
// في الداتابيز عشان تبان تحت الكارت بتاعه في الواجهة. الفشل هنا (URL واقع،
// timeout، 4xx/5xx...) بيتسجل بس، مبيوقفش تنفيذ باقي الكود اللي نادى عليها
async function sendToWebhook(webhook, eventType, data) {
  const payload = {
    event: eventType,
    timestamp: new Date().toISOString(),
    data,
  };
  const rawBody = JSON.stringify(payload);
  const signature = signPayload(webhook.secret, rawBody);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-NileChat-Event': eventType,
        'X-NileChat-Signature': `sha256=${signature}`,
      },
      body: rawBody,
      signal: controller.signal,
    });

    await webhookConfigRepo.recordDeliveryResult(webhook.id, {
      statusCode: response.status,
      error: response.ok ? null : `HTTP ${response.status}`,
    });

    if (!response.ok) {
      logger.warn(`⚠️ الـ Webhook ${webhook.url} رد بحالة ${response.status} لحدث ${eventType}`);
    }
  } catch (err) {
    const message = err.name === 'AbortError' ? `تجاوز مهلة ${REQUEST_TIMEOUT_MS}ms` : err.message;
    await webhookConfigRepo.recordDeliveryResult(webhook.id, { statusCode: null, error: message });
    logger.warn(`⚠️ فشل إرسال الـ Webhook ${webhook.url} لحدث ${eventType}: ${message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

// نقطة الدخول الوحيدة لأي حدث في الكود: بتجيب كل الـ Webhooks المفعّلة
// والمشتركة في الحدث ده (لنفس الشركة)، وبتبعتلهم كلهم على التوازي (مش
// الواحد وبعدين التاني، عشان webhook واحد بطيء ميأخرش الباقي)
async function dispatchEvent(eventType, data, companyId = null) {
  try {
    const webhooks = await webhookConfigRepo.listEnabledForCompanyEvent(eventType, companyId);
    if (!webhooks.length) return;
    await Promise.all(webhooks.map((wh) => sendToWebhook(wh, eventType, data)));
  } catch (err) {
    logger.error(`❌ فشل تنفيذ dispatchEvent للحدث ${eventType}:`, err.message);
  }
}

module.exports = {
  EVENT_TYPES,
  ALL_EVENT_TYPES,
  dispatchEvent,
  sendToWebhook, // مستخدمة كمان في زرار "Send test event" من صفحة الإعدادات
};
