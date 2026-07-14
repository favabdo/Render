// services/ratingFlow.service.js
// أتمتة "تقييم بعد الحل" (Post-Resolve Rating): بمجرد ما محادثة تتقفل (Resolve)
// وقاعدة الأتمتة دي مفعّلة، بيتبعت للعميل على نفس المحادثة (المقفولة) فلو من 3
// خطوات بالترتيب:
//   1) تقييم نجوم من 1 لـ 5 لحل المشكلة
//   2) تقييم نجوم من 1 لـ 5 لممثل خدمة العملاء اللي اتعامل معاه
//   3) تعليق نصي اختياري (أو "تخطي")
// الردود بتتفسر من webhook واتساب العادي (processIncomingMessages في
// conversation.service.js بيتأكد الأول لو فيه طلب تقييم لسه مفتوح لنفس الرقم
// قبل ما يعامل الرسالة كمحادثة عادية)

const ratingRepo = require('../repositories/rating.repo');
const conversationRepo = require('../repositories/conversation.repo');
const companyRepo = require('../repositories/company.repo');
const whatsappService = require('../services/whatsapp.service');
const logger = require('../utils/logger');

const DEFAULT_ISSUE_MESSAGE =
  'شكرًا لتواصلك معانا 🙏\nمن فضلك قيّم مدى رضاك عن حل المشكلة من 1 لـ 5 (ابعت رقم من 1 لـ 5):\n1 = غير راضي خالص … 5 = راضي جدًا';
const DEFAULT_AGENT_MESSAGE =
  'تمام، شكرًا ليك! دلوقتي قيّم ممثل خدمة العملاء اللي اتعامل معاك من 1 لـ 5 (ابعت رقم من 1 لـ 5)';
const DEFAULT_FEEDBACK_MESSAGE =
  'لو حابب تسيبلنا أي تعليق أو ملاحظة تساعدنا نتحسن، اكتبها دلوقتي. أو ابعت "تخطي" لو مش حابب تضيف تعليق';
const DEFAULT_THANKS_MESSAGE = 'شكرًا جدًا لوقتك وتقييمك، ده بيساعدنا نقدملك خدمة أحسن 🌟';

const SKIP_KEYWORDS = ['تخطي', 'لا', 'skip', 'no', 'مفيش', 'خلاص'];

function resolveMessage(configured, fallback) {
  const trimmed = (configured || '').trim();
  return trimmed || fallback;
}

// بيحوّل أي رقم مكتوب (بالعربي أو بالإنجليزي، مع مسافات/نص حواليه) لرقم صحيح
// من 1 لـ 5 — وإلا بيرجع null لو مفيش رقم صالح في الرسالة
function parseStarRating(text) {
  if (!text) return null;
  const arabicIndicMap = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
  const normalized = String(text)
    .trim()
    .replace(/[٠-٩]/g, (d) => arabicIndicMap[d] || d);
  const match = normalized.match(/[1-5]/);
  if (!match) return null;
  return Number(match[0]);
}

function isSkipReply(text) {
  const normalized = String(text || '').trim().toLowerCase();
  return SKIP_KEYWORDS.some((k) => normalized === k || normalized.startsWith(k));
}

async function sendFlowMessage(pending, text, io) {
  const message = await whatsappService.sendTextMessage(
    pending.contact_number,
    text,
    pending.conversation_id,
    pending.inbox_id,
    { id: null, name: 'Automation' }
  );
  await conversationRepo.touchConversation(pending.conversation_id);
  if (io && message) {
    io.emit('new_message', { conversationId: pending.conversation_id, message });
  }
  return message;
}

// بتتنادى فور ما محادثة تتقفل (Resolve) — لو القاعدة مفعّلة، بتفتح طلب تقييم
// جديد وتبعت أول رسالة (تقييم حل المشكلة)
async function startRatingFlow(conversation, io) {
  const settings = await companyRepo.getAutomationSettings();
  if (!settings || !settings.rating_enabled) return;
  if (!conversation || !conversation.contact_number) return;

  const pending = await ratingRepo.createRatingRequest({
    conversationId: conversation.id,
    contactId: conversation.contact_id || null,
    contactNumber: conversation.contact_number,
    inboxId: conversation.inbox_id || null,
    // "ممثل خدمة العملاء" هنا هو الإيجنت المعين على المحادثة وقت قفلها، وإلا
    // اللي عمل الـ Resolve نفسه لو مفيش إيجنت معين
    agentId: conversation.assigned_agent_id || conversation.resolved_by || null,
    agentName: conversation.assigned_agent_name || conversation.resolved_agent_name || null,
  });

  const message = resolveMessage(settings.rating_issue_message, DEFAULT_ISSUE_MESSAGE);
  await sendFlowMessage(pending, message, io);
}

// بتتنادى مع أي رسالة واردة من رقم عنده طلب تقييم لسه مفتوح — بترجع true لو
// اتعاملت مع الرسالة دي كرد تقييم (يعني المفروض توقف أي معالجة عادية تانية للرسالة)
async function handleIncomingRatingReply(pending, text, io) {
  const settings = await companyRepo.getAutomationSettings();

  if (pending.stage === 'awaiting_issue_rating') {
    const rating = parseStarRating(text);
    if (rating === null) {
      await sendFlowMessage(pending, 'من فضلك ابعت رقم من 1 لـ 5 بس 🙏', io);
      return true;
    }
    const updated = await ratingRepo.setIssueRatingAndAdvance(pending.id, rating);
    const message = resolveMessage(settings?.rating_agent_message, DEFAULT_AGENT_MESSAGE);
    await sendFlowMessage(updated, message, io);
    return true;
  }

  if (pending.stage === 'awaiting_agent_rating') {
    const rating = parseStarRating(text);
    if (rating === null) {
      await sendFlowMessage(pending, 'من فضلك ابعت رقم من 1 لـ 5 بس 🙏', io);
      return true;
    }
    const updated = await ratingRepo.setAgentRatingAndAdvance(pending.id, rating);
    const message = resolveMessage(settings?.rating_feedback_message, DEFAULT_FEEDBACK_MESSAGE);
    await sendFlowMessage(updated, message, io);
    return true;
  }

  if (pending.stage === 'awaiting_feedback') {
    const feedbackText = isSkipReply(text) ? null : String(text || '').trim() || null;
    const updated = await ratingRepo.completeWithFeedback(pending.id, feedbackText);
    const message = resolveMessage(settings?.rating_thanks_message, DEFAULT_THANKS_MESSAGE);
    await sendFlowMessage(updated, message, io);
    logger.info(
      `⭐ تقييم مكتمل لمحادثة #${pending.conversation_id}: حل=${updated.issue_rating}, إيجنت=${updated.agent_rating}, تعليق=${updated.feedback_text ? 'موجود' : 'متخطّى'}`
    );
    return true;
  }

  return false;
}

module.exports = { startRatingFlow, handleIncomingRatingReply, parseStarRating };
