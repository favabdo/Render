// services/contractExpiry.service.js
// أتمتة "عقد الصيانة منتهي": فحص دوري لأي عميل عقده عدّى تاريخ نهايته من غير
// ما يتجدد، وبعت رسالة واتساب جاهزة له (النص قابل للتعديل من صفحة الإعدادات
// -> Automation). كل عقد بياخد الرسالة مرة واحدة بس (marked بعمود
// expiry_notice_sent_at)، حتى لو الفحص اتكرر بعد كده.

const maintenanceContractRepo = require('../repositories/maintenanceContract.repo');
const conversationRepo = require('../repositories/conversation.repo');
const companyRepo = require('../repositories/company.repo');
const whatsappService = require('../services/whatsapp.service');
const logger = require('../utils/logger');

// فحص جديد كل 24 ساعة (يوميًا) — كفاية جدًا لدقة على مستوى أيام، ومفيش داعي
// نحمّل الداتابيز والـ WhatsApp API بفحص متكرر لحاجة بتتغير مرة في اليوم بس
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function runContractExpirySweep(io) {
  try {
    const settings = await companyRepo.getAutomationSettings();
    if (!settings || !settings.contract_expired_enabled || !settings.contract_expired_message) return;

    const candidates = await maintenanceContractRepo.findExpiredContractsPendingNotice();
    if (!candidates.length) return;

    for (const contract of candidates) {
      try {
        // بنبعت الرسالة جوه محادثة (بنستخدم المحادثة المفتوحة لو موجودة، وإلا
        // بننشئ واحدة جديدة) عشان الإيجنتس يقدروا يشوفوا إن الإشعار اتبعت
        // ويكملوا مع العميل من نفس المكان لو رد
        const { id: conversationId } = await conversationRepo.findOrCreateConversation(
          contract.contact_phone,
          contract.contact_name || null,
          null,
          contract.contact_id
        );

        const message = await whatsappService.sendTextMessage(
          contract.contact_phone,
          settings.contract_expired_message,
          conversationId,
          null,
          { id: null, name: 'Automation' }
        );
        await conversationRepo.touchConversation(conversationId);

        // بنسجل إن الإشعار اتبعت الأول قبل أي حاجة تانية، عشان لو فشل الإرسال
        // فعليًا (مفيش نت مثلاً) الرسالة تتسجل 'failed' لكن العقد ميتحاولش يتبعتله
        // تاني كل نص ساعة للأبد — لو حابب تعيد المحاولة يدويًا في الحالة دي
        await maintenanceContractRepo.markExpiryNoticeSent(contract.contract_id);

        const updated = await conversationRepo.getConversationById(conversationId);
        if (io && updated) {
          io.emit('conversation_updated', updated);
          if (message) io.emit('new_message', { conversationId, message });
        }

        logger.info(`📨 اتبعت إشعار "عقد الصيانة منتهي" لعميل #${contract.contact_id} (عقد #${contract.contract_id})`);
      } catch (err) {
        logger.error(`❌ فشل إرسال إشعار انتهاء العقد #${contract.contract_id}:`, err.message);
      }
    }
  } catch (err) {
    logger.error('❌ فشل فحص أتمتة "عقد الصيانة منتهي":', err.message);
  }
}

// بيبدأ الفحص الدوري (setInterval) — لازم يتنادى مرة واحدة بس وقت تشغيل السيرفر
function startContractExpiryScheduler(getIo) {
  // فحص أول مرة بعد دقيقتين من تشغيل السيرفر (نستنى الـ schema يجهز)، وبعدين كل SWEEP_INTERVAL_MS
  setTimeout(() => runContractExpirySweep(getIo()), 2 * 60 * 1000);
  setInterval(() => runContractExpirySweep(getIo()), SWEEP_INTERVAL_MS);
}

module.exports = { runContractExpirySweep, startContractExpiryScheduler };
