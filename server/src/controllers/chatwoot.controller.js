// controllers/chatwoot.controller.js
// استقبال الـ webhook بتاع شات ووت. نفس فلسفة receiveWebhook بتاع ميتا بالظبط:
// رد 200 فورًا، وبعدين المعالجة الفعلية في الخلفية (مع تسجيل idempotent في
// External_Event_byA قبل أي حاجة تانية)

const externalProviderRepo = require('../repositories/externalProvider.repo');
const externalEventRepo = require('../repositories/externalEvent.repo');
const externalIngestService = require('../services/externalIngest.service');
const logger = require('../utils/logger');

// عنوان الـ webhook اللي هتحطه في إعدادات شات ووت:
//   POST https://YOUR_DOMAIN/webhook/chatwoot/:providerId/:secret
// :providerId = id بتاع الصف في External_Provider_byA
// :secret     = نفس القيمة المسجلة في عمود webhook_secret لنفس الصف
async function receiveWebhook(req, res) {
  // لازم نرد بسرعة عشان شات ووت متعتبروش الـ webhook فاشل ويعمل retry بلا داعي
  res.sendStatus(200);

  try {
    const { providerId, secret } = req.params;

    const provider = await externalProviderRepo.getProviderById(providerId);
    if (!provider || !provider.is_active) {
      logger.error(`❌ ويب هوك شات ووت: provider #${providerId} مش موجود أو مش نشط`);
      return;
    }

    if (!provider.webhook_secret || provider.webhook_secret !== secret) {
      logger.error(`❌ ويب هوك شات ووت: سيكرت غلط لـ provider #${providerId} — الحدث اتجاهل`);
      return;
    }

    const eventType = req.body?.event || 'unknown';

    // شات ووت مبيبعتش event id مميز عادةً، فبنبني واحد صناعي مركب من نوع الحدث
    // + id العنصر نفسه + آخر وقت تحديث، عشان الـ retries الحقيقية (نفس المحاولة)
    // تتصفى هنا، من غير ما نمنع تحديثات شرعية جديدة بنفس الـ id بعدين
    const entityId = req.body?.id || req.body?.conversation?.id || null;
    const stamp = req.body?.updated_at || req.body?.created_at || '';
    const externalEventId = entityId ? `${eventType}:${entityId}:${stamp}` : null;

    const payloadStr = JSON.stringify(req.body || {});
    const { event, isDuplicate } = await externalEventRepo.recordEvent(provider.id, eventType, externalEventId, payloadStr);

    if (isDuplicate) {
      logger.info(`ℹ️ حدث شات ووت مكرر (retry) اتجاهل: ${externalEventId}`);
      return;
    }
    if (!event) return;

    try {
      const io = req.app.get('io');
      await externalIngestService.processChatwootEvent(provider, eventType, req.body, io);
      await externalEventRepo.markProcessed(event.id);
    } catch (err) {
      logger.error('❌ فشل معالجة حدث شات ووت:', err.message);
      await externalEventRepo.markFailed(event.id, err.message).catch(() => {});
    }
  } catch (err) {
    logger.error('❌ خطأ عام أثناء استقبال ويب هوك شات ووت:', err.message);
  }
}

module.exports = {
  receiveWebhook,
};
