// services/ratingFlow.service.js
// أتمتة "بعد الحل" لما محادثة تتقفل (Resolve) — فيها فعلين مستقلين، لو الاتنين
// مفعّلين بيحصلوا **ورا بعض بالترتيب** (مش واحد بس):
//   1) رسالة الـ CSAT (نص عادي، لو automation_csat_enabled مفعّلة)
//   2) فلو التقييم: رسالة WhatsApp Flow واحدة فيها تقييم نجوم (1-5) لحل المشكلة
//      + تقييم نجوم (1-5) لممثل خدمة العملاء + خانة تعليق نصي اختيارية + زرار
//      إرسال — كل ده في فقاعة واحدة، العميل بيملاها كفورم ويبعتها مرة واحدة
//      (لو automation_rating_enabled مفعّلة)
// لو الـ WhatsApp Flow فشل إنشاؤه لأي سبب (مثلاً التوكن مالوش صلاحية
// whatsapp_business_management)، بيرجع تلقائيًا (fallback) للأسلوب المتدرج
// القديم: تقييم الحل -> تقييم الإيجنت -> تعليق نصي، كل واحدة في رسالة لوحدها.
// الردود العادية (نص/زرار) على الأسلوب القديم بتتفسر من webhook واتساب
// (processIncomingMessages بيتأكد الأول لو فيه طلب تقييم لسه مفتوح لنفس الرقم)،
// ورد الـ Flow (نموذج كامل مرة واحدة) بييجي كـ nfm_reply وبيتعامل معاه handleFlowSubmit

const ratingRepo = require('../repositories/rating.repo');
const conversationRepo = require('../repositories/conversation.repo');
const companyRepo = require('../repositories/company.repo');
const whatsappService = require('../services/whatsapp.service');
const { emitToPrivilegedRoom } = require('../socket/socket');
const logger = require('../utils/logger');

const DEFAULT_CSAT_MESSAGE = 'شكرًا لتواصلك معانا، تم حل مشكلتك 🙏 لو محتاج أي حاجة تانية إحنا موجودين.';
const DEFAULT_ISSUE_MESSAGE =
  'من فضلك قيّم تجربتك معانا — تقييم حل المشكلة وتقييم الإيجنت مع بعض، وسيبلنا تعليق لو حابب 👇';
const DEFAULT_AGENT_MESSAGE =
  'تمام، شكرًا ليك! دلوقتي قيّم ممثل خدمة العملاء اللي اتعامل معاك — اختار تقييمك من القايمة تحت 👇';
const DEFAULT_FEEDBACK_MESSAGE =
  'لو حابب تسيبلنا أي تعليق أو ملاحظة تساعدنا نتحسن، اكتبها دلوقتي. أو دوس "تخطي" لو مش حابب تضيف تعليق';
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

async function sendPlainFlowMessage(pending, text, io) {
  const message = await whatsappService.sendTextMessage(
    pending.contact_number,
    text,
    pending.conversation_id,
    pending.inbox_id,
    { id: null, name: 'Automation' },
    true
  );
  await conversationRepo.touchConversation(pending.conversation_id);
  if (io && message) {
    emitToPrivilegedRoom(io, 'new_message', { conversationId: pending.conversation_id, message });
  }
  return message;
}

// بيبعت سؤال تقييم كقايمة اختيار (1 لـ 5) بدل ما يسيب العميل يكتب الرقم بنفسه
async function sendStarRatingFlowMessage(pending, text, io) {
  const message = await whatsappService.sendStarRatingMessage(
    pending.contact_number,
    text,
    pending.conversation_id,
    pending.inbox_id,
    { id: null, name: 'Automation' },
    true
  );
  await conversationRepo.touchConversation(pending.conversation_id);
  if (io && message) {
    emitToPrivilegedRoom(io, 'new_message', { conversationId: pending.conversation_id, message });
  }
  return message;
}

// بيبعت سؤال التعليق النصي مع زرار "تخطي" — العميل يقدر يدوس تخطي فورًا من غير
// ما يكتب حاجة، أو يفضل يكتب تعليقه عادي بالكتابة
async function sendSkippableFlowMessage(pending, text, io) {
  const message = await whatsappService.sendSkippableTextMessage(
    pending.contact_number,
    text,
    pending.conversation_id,
    pending.inbox_id,
    { id: null, name: 'Automation' },
    'تخطي',
    true
  );
  await conversationRepo.touchConversation(pending.conversation_id);
  if (io && message) {
    emitToPrivilegedRoom(io, 'new_message', { conversationId: pending.conversation_id, message });
  }
  return message;
}

// بتبعت رسالة الـ CSAT (نص عادي بس) لو القاعدة مفعّلة — مستقلة تمامًا عن فلو
// التقييم، وبتتبعت الأول قبله
async function sendCsatMessage(conversation, io) {
  const settings = await companyRepo.getAutomationSettings();
  if (!settings || !settings.csat_enabled) return null;
  if (!conversation || !conversation.contact_number) return null;

  const text = resolveMessage(settings.csat_message, DEFAULT_CSAT_MESSAGE);
  const message = await whatsappService.sendTextMessage(
    conversation.contact_number,
    text,
    conversation.id,
    conversation.inbox_id,
    { id: null, name: 'Automation' },
    true
  );
  await conversationRepo.touchConversation(conversation.id);
  if (io && message) {
    emitToPrivilegedRoom(io, 'new_message', { conversationId: conversation.id, message });
  }
  return message;
}

// بتفتح طلب تقييم جديد وتحاول تبعته كرسالة WhatsApp Flow واحدة (تقييمين +
// تعليق + إرسال في فقاعة واحدة). لو فشل إنشاء/إرسال الـ Flow لأي سبب (توكن
// من غير صلاحية إدارية، مشكلة شبكة...) بترجع تلقائيًا للأسلوب المتدرج القديم
// (3 رسايل ورا بعض) عشان التقييم يفضل شغال حتى لو الـ Flow مش متاح دلوقتي
async function startRatingFlow(conversation, io) {
  const settings = await companyRepo.getAutomationSettings();
  if (!settings || !settings.rating_enabled) return;
  if (!conversation || !conversation.contact_number) return;

  const introText = resolveMessage(settings.rating_issue_message, DEFAULT_ISSUE_MESSAGE);

  try {
    if (!conversation.inbox_id) throw new Error('المحادثة دي مش مربوطة بـ Inbox — مينفعش نبعت WhatsApp Flow');

    const flowId = await whatsappService.getOrCreateRatingFlowId(conversation.inbox_id);

    const pending = await ratingRepo.createRatingRequest({
      conversationId: conversation.id,
      contactId: conversation.contact_id || null,
      contactNumber: conversation.contact_number,
      inboxId: conversation.inbox_id || null,
      agentId: conversation.assigned_agent_id || conversation.resolved_by || null,
      agentName: conversation.assigned_agent_name || conversation.resolved_agent_name || null,
      stage: 'awaiting_flow_response',
    });

    const message = await whatsappService.sendRatingFlowMessage(
      pending.contact_number,
      { flowId, flowToken: String(pending.id), bodyText: introText },
      pending.conversation_id,
      pending.inbox_id,
      { id: null, name: 'Automation' },
      true
    );
    await conversationRepo.touchConversation(pending.conversation_id);
    if (io && message) {
      emitToPrivilegedRoom(io, 'new_message', { conversationId: pending.conversation_id, message });
    }
  } catch (err) {
    logger.error(
      '⚠️ فشل إرسال WhatsApp Flow للتقييم، هيتم اللجوء للأسلوب المتدرج القديم:',
      err.response?.data?.error?.message || err.message
    );

    const pending = await ratingRepo.createRatingRequest({
      conversationId: conversation.id,
      contactId: conversation.contact_id || null,
      contactNumber: conversation.contact_number,
      inboxId: conversation.inbox_id || null,
      agentId: conversation.assigned_agent_id || conversation.resolved_by || null,
      agentName: conversation.assigned_agent_name || conversation.resolved_agent_name || null,
      stage: 'awaiting_issue_rating',
    });
    await sendStarRatingFlowMessage(pending, introText, io);
  }
}

// بتتنادى لما يوصل رد WhatsApp Flow (nfm_reply) لطلب تقييم لسه مفتوح — بتاخد
// التقييمين + التعليق كلهم مرة واحدة من response_json وتقفل الطلب على طول،
// وبعدين تبعت رسالة الشكر
async function handleFlowSubmit(pending, nfmReply, io) {
  let payload = {};
  try {
    payload = JSON.parse(nfmReply?.response_json || '{}');
  } catch (err) {
    logger.error('❌ تعذر قراءة رد WhatsApp Flow (response_json غير صالح):', err.message);
  }

  const issueRating = parseStarRating(payload.issue_rating);
  const agentRating = parseStarRating(payload.agent_rating);
  const feedbackText = String(payload.feedback_text || '').trim() || null;

  const updated = await ratingRepo.completeFromFlowResponse(pending.id, {
    issueRating,
    agentRating,
    feedbackText,
  });

  const settings = await companyRepo.getAutomationSettings();
  const thanksText = resolveMessage(settings?.rating_thanks_message, DEFAULT_THANKS_MESSAGE);
  await sendPlainFlowMessage(updated || pending, thanksText, io);

  logger.info(
    `⭐ تقييم مكتمل (Flow) لمحادثة #${pending.conversation_id}: حل=${issueRating}, إيجنت=${agentRating}, تعليق=${feedbackText ? 'موجود' : 'مفيش'}`
  );
}

// بتتنادى فور ما محادثة تتقفل (Resolve) لأول مرة — دي المنسّق (orchestrator)
// اللي بيشغّل فعلي "بعد الحل" ورا بعض بالترتيب: رسالة الـ CSAT الأول (لو
// مفعّلة)، وبعدين فلو التقييم (لو مفعّل) — مش واحد بس، والاتنين لو الاتنين
// مفعّلين. لازم تتنادى مرة واحدة بس لكل Resolve فعلي (مش لو اتعمل Resolve
// تاني لمحادثة بعد Reopen — الكنترولر هو اللي بيتحقق من ده)
async function runPostResolveAutomation(conversation, io) {
  await sendCsatMessage(conversation, io);
  await startRatingFlow(conversation, io);
}

// بتتنادى مع أي رسالة واردة من رقم عنده طلب تقييم لسه مفتوح — بترجع true لو
// اتعاملت مع الرسالة دي كرد تقييم (يعني المفروض توقف أي معالجة عادية تانية للرسالة)
async function handleIncomingRatingReply(pending, text, io) {
  const settings = await companyRepo.getAutomationSettings();

  if (pending.stage === 'awaiting_issue_rating') {
    const rating = parseStarRating(text);
    if (rating === null) {
      await sendStarRatingFlowMessage(pending, 'من فضلك اختار تقييم من 1 لـ 5 من القايمة تحت 🙏', io);
      return true;
    }
    const updated = await ratingRepo.setIssueRatingAndAdvance(pending.id, rating);
    const message = resolveMessage(settings?.rating_agent_message, DEFAULT_AGENT_MESSAGE);
    await sendStarRatingFlowMessage(updated, message, io);
    return true;
  }

  if (pending.stage === 'awaiting_agent_rating') {
    const rating = parseStarRating(text);
    if (rating === null) {
      await sendStarRatingFlowMessage(pending, 'من فضلك اختار تقييم من 1 لـ 5 من القايمة تحت 🙏', io);
      return true;
    }
    const updated = await ratingRepo.setAgentRatingAndAdvance(pending.id, rating);
    const message = resolveMessage(settings?.rating_feedback_message, DEFAULT_FEEDBACK_MESSAGE);
    await sendSkippableFlowMessage(updated, message, io);
    return true;
  }

  if (pending.stage === 'awaiting_feedback') {
    const feedbackText = isSkipReply(text) ? null : String(text || '').trim() || null;
    const updated = await ratingRepo.completeWithFeedback(pending.id, feedbackText);
    const message = resolveMessage(settings?.rating_thanks_message, DEFAULT_THANKS_MESSAGE);
    await sendPlainFlowMessage(updated, message, io);
    logger.info(
      `⭐ تقييم مكتمل لمحادثة #${pending.conversation_id}: حل=${updated.issue_rating}, إيجنت=${updated.agent_rating}, تعليق=${updated.feedback_text ? 'موجود' : 'متخطّى'}`
    );
    return true;
  }

  return false;
}

module.exports = {
  runPostResolveAutomation,
  sendCsatMessage,
  startRatingFlow,
  handleIncomingRatingReply,
  handleFlowSubmit,
  parseStarRating,
};
