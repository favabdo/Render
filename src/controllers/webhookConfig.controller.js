// controllers/webhookConfig.controller.js
// صفحة Settings → Integrations → Webhooks: تسجيل/تعديل/حذف Webhooks صادرة
// حقيقية، بترسل أحداث المحادثات (POST) لسيرفر اليوزر نفسه فور حصولها فعليًا

const crypto = require('crypto');
const webhookConfigRepo = require('../repositories/webhookConfig.repo');
const webhookDispatchService = require('../services/webhookDispatch.service');
const notificationService = require('../services/notification.service');

const MAX_WEBHOOKS_PER_COMPANY = 10;

function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeEvents(rawEvents) {
  if (!Array.isArray(rawEvents)) return [];
  const seen = new Set();
  const result = [];
  for (const e of rawEvents) {
    const value = String(e || '').trim();
    if (!value || !webhookDispatchService.ALL_EVENT_TYPES.includes(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

async function list(req, res) {
  const webhooks = await webhookConfigRepo.listByCompany();
  res.json({ webhooks, available_events: webhookDispatchService.ALL_EVENT_TYPES });
}

async function create(req, res) {
  const { url, events } = req.body || {};

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'رابط الـ Webhook مش صحيح — لازم يبدأ بـ http:// أو https://' });
  }

  const cleanedEvents = sanitizeEvents(events);
  if (!cleanedEvents.length) {
    return res.status(400).json({ error: 'لازم تختار حدث واحد على الأقل يشترك فيه الـ Webhook ده' });
  }

  const existing = await webhookConfigRepo.listByCompany();
  if (existing.length >= MAX_WEBHOOKS_PER_COMPANY) {
    return res.status(400).json({ error: `أقصى عدد Webhooks هو ${MAX_WEBHOOKS_PER_COMPANY}` });
  }

  const secret = crypto.randomBytes(24).toString('hex');
  const webhook = await webhookConfigRepo.create({
    url: url.trim(),
    secret,
    events: cleanedEvents,
    createdBy: req.user.userId,
  });

  res.json({ ok: true, webhook });
  notificationService.logActivity(req, `أضاف Webhook جديد على ${webhook.url}`, webhook.id);
}

async function update(req, res) {
  const { url, events, enabled } = req.body || {};

  const existing = await webhookConfigRepo.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'الـ Webhook ده مش موجود' });

  const fields = {};
  if (url !== undefined) {
    if (!isValidUrl(url)) {
      return res.status(400).json({ error: 'رابط الـ Webhook مش صحيح — لازم يبدأ بـ http:// أو https://' });
    }
    fields.url = url.trim();
  }
  if (events !== undefined) {
    const cleanedEvents = sanitizeEvents(events);
    if (!cleanedEvents.length) {
      return res.status(400).json({ error: 'لازم تختار حدث واحد على الأقل يشترك فيه الـ Webhook ده' });
    }
    fields.events = cleanedEvents;
  }
  if (enabled !== undefined) {
    fields.enabled = Boolean(enabled);
  }

  const webhook = await webhookConfigRepo.update(req.params.id, fields);
  res.json({ ok: true, webhook });
  notificationService.logActivity(req, `عدّل إعدادات Webhook (${webhook.url})`, webhook.id);
}

async function remove(req, res) {
  const existing = await webhookConfigRepo.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'الـ Webhook ده مش موجود' });

  await webhookConfigRepo.remove(req.params.id);
  res.json({ ok: true });
  notificationService.logActivity(req, `مسح Webhook (${existing.url})`, req.params.id);
}

// بتولّد secret جديد للـ Webhook (لو حصل تسريب مثلاً واليوزر عايز يغيّره)
async function regenerateSecret(req, res) {
  const existing = await webhookConfigRepo.getById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'الـ Webhook ده مش موجود' });

  const secret = crypto.randomBytes(24).toString('hex');
  const webhook = await webhookConfigRepo.update(req.params.id, { secret });
  res.json({ ok: true, webhook });
}

// زرار "Send test event" في الواجهة: بيبعت حدث تجريبي فورًا لنفس اللينك
// المسجل، عشان اليوزر يتأكد إن السيرفر بتاعه فعلاً بيستقبل ويرجع نتيجة حقيقية
async function sendTestEvent(req, res) {
  const webhook = await webhookConfigRepo.getById(req.params.id);
  if (!webhook) return res.status(404).json({ error: 'الـ Webhook ده مش موجود' });

  const before = webhook.last_status_code;
  await webhookDispatchService.sendToWebhook(webhook, 'webhook.test', {
    message: 'دي رسالة تجريبية من NileChat للتأكد إن الـ Webhook شغال فعليًا',
    triggered_by: req.user.userId,
  });

  const updated = await webhookConfigRepo.getById(req.params.id);
  res.json({
    ok: true,
    webhook: updated,
    delivered: updated.last_error === null,
    changed: updated.last_status_code !== before || updated.last_error,
  });
}

module.exports = {
  list,
  create,
  update,
  remove,
  regenerateSecret,
  sendTestEvent,
};
