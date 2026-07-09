// services/autoResolve.service.js
// بتقفل (Resolve) أي محادثة مفتوحة عدّى عليها عدد الأيام المحدد في إعدادات
// الحساب (Auto Resolve After Inactivity) من غير أي نشاط جديد — تصنيفها بيبقى
// "تم قفل المحادثة بعد X يوم من عدم التفاعل" عشان يتفرق بسهولة عن أي Resolve
// عمله إيجنت حقيقي بإيده.

const conversationRepo = require('../repositories/conversation.repo');
const companyRepo = require('../repositories/company.repo');
const logger = require('../utils/logger');

// كل قد إيه بنعمل فحص جديد للمحادثات الخاملة (كل 15 دقيقة كفاية جدًا لدقة على
// مستوى أيام، ومش بتحمّل الداتابيز زيادة)
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

function autoResolveCategoryText(days) {
  return `تم قفل المحادثة بعد ${days} يوم من عدم التفاعل`;
}

async function runAutoResolveSweep(io) {
  try {
    const days = await companyRepo.getPrimaryAutoResolveDays();
    // null أو 0 يعني الخاصية متوقفة من إعدادات الحساب
    if (!days || days <= 0) return;

    const candidates = await conversationRepo.findConversationsInactiveSince(days);
    if (!candidates.length) return;

    for (const { id } of candidates) {
      try {
        // بنجيب المحادثة تاني قبل القفل عشان نتأكد إنها لسه مفتوحة وماتقفلتش
        // (race condition نادرة لو إيجنت عمل Resolve يدوي في نفس اللحظة)
        const conversation = await conversationRepo.getConversationById(id);
        if (!conversation || conversation.locked_at || conversation.status === 'closed') continue;

        const category = autoResolveCategoryText(days);
        const [, systemMessage] = await Promise.all([
          conversationRepo.resolveConversation(id, { category, notes: null, resolvedBy: null }),
          conversationRepo.addSystemMessage(
            id,
            `Conversation was automatically resolved after ${days} day(s) of inactivity`
          ),
        ]);

        const updated = await conversationRepo.getConversationById(id);
        if (io && updated) {
          io.emit('conversation_updated', updated);
          io.emit('new_message', { conversationId: updated.id, message: systemMessage });
        }

        logger.info(`⏳ محادثة #${id} اتقفلت تلقائيًا بعد ${days} يوم من عدم التفاعل`);
      } catch (err) {
        logger.error(`❌ فشل الـ Auto Resolve للمحادثة #${id}:`, err.message);
      }
    }
  } catch (err) {
    logger.error('❌ فشل فحص الـ Auto Resolve After Inactivity:', err.message);
  }
}

// بيبدأ الفحص الدوري (setInterval) — لازم يتنادى مرة واحدة بس وقت تشغيل السيرفر
function startAutoResolveScheduler(getIo) {
  // فحص أول مرة بعد دقيقة من تشغيل السيرفر (نستنى الـ schema يجهز)، وبعدين كل SWEEP_INTERVAL_MS
  setTimeout(() => runAutoResolveSweep(getIo()), 60 * 1000);
  setInterval(() => runAutoResolveSweep(getIo()), SWEEP_INTERVAL_MS);
}

module.exports = { runAutoResolveSweep, startAutoResolveScheduler, autoResolveCategoryText };
