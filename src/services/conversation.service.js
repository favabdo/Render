// services/conversation.service.js
// منطق المحادثات اللي بيلف أكتر من repository/service مع بعض: بعت رد، ومعالجة رسايل الـ webhook

const conversationRepo = require('../repositories/conversation.repo');
const inboxRepo = require('../repositories/inbox.repo');
const companyRepo = require('../repositories/company.repo');
const userRepo = require('../repositories/user.repo');
const teamRepo = require('../repositories/team.repo');
const webhookDispatchService = require('./webhookDispatch.service');
const contactService = require('./contact.service');
const whatsappService = require('./whatsapp.service');
const logger = require('../utils/logger');
const { isWithinBusinessHours } = require('../utils/welcomeSchedule');

// بيبعت رد من الإيجنت للعميل عن طريق واتساب، وبيسجله ويحدّث آخر وقت نشاط للمحادثة
// (النسخة القديمة المتزامنة، بتستنى ميتا كاملة قبل ما ترجع — لسه موجودة لأي حد بيستخدمها مباشرة)
async function sendReply(conversation, text, sender) {
  const message = await whatsappService.sendTextMessage(
    conversation.contact_number,
    text,
    conversation.id,
    conversation.inbox_id,
    sender
  );
  await conversationRepo.touchConversation(conversation.id);
  return message;
}

// النسخة اللايف: بتسجل الرسالة فورًا (حالة 'sending') وترجعها على طول من غير
// ما تستنى ميتا، وبعدين تكمل الإرسال الفعلي في الخلفية وتنادي onFinalized
// بالحالة النهائية (sent/failed) أول ما توصل — عشان الكنترولر يقدر يبعت
// حدثين منفصلين على الـ socket: واحد فوري ("بيتبعت")، وواحد لما فعلاً يتبعت/يفشل
async function sendReplyLive(conversation, text, sender, onFinalized) {
  // بنسجل الرسالة وبنحدّث آخر وقت للمحادثة في نفس الوقت (مش الواحدة بعد التانية)
  // — الاتنين مش معتمدين على نتيجة بعض، والفرق ده بيوفر رحلة كاملة (round trip) للداتابيز
  const [savedMessage] = await Promise.all([
    whatsappService.createOutgoingMessage(
      conversation.contact_number,
      text,
      conversation.id,
      conversation.inbox_id,
      sender
    ),
    conversationRepo.touchConversation(conversation.id),
  ]);

  // مش بنعمل await هنا عمدًا — الكنترولر لازم يرجع للإيجنت فورًا من غير ما يستنى ميتا
  whatsappService
    .deliverOutgoingMessage(
      savedMessage,
      { toNumber: conversation.contact_number, text, inboxId: conversation.inbox_id },
      async (finalRow) => {
        if (finalRow) await conversationRepo.touchConversation(conversation.id);
        if (onFinalized) onFinalized(finalRow);
      }
    )
    .catch(() => {
      /* أي استثناء غير متوقع اتلقط واتسجل جوه deliverOutgoingMessage نفسها بالفعل */
    });

  return savedMessage;
}

// بيتعامل مع الرسائل الواردة من webhook واتساب (رسائل جديدة من عملاء)
async function processIncomingMessages(value, io) {
  const contact = value.contacts?.[0];

  // بنحدد أي Inbox (رقم واتساب) استقبل الرسالة دي، عشان نربط المحادثة بيه
  const incomingPhoneNumberId = value.metadata?.phone_number_id || null;
  let matchedInbox = null;
  try {
    matchedInbox = await inboxRepo.findInboxByPhoneNumberId(incomingPhoneNumberId);
  } catch (err) {
    logger.error('❌ خطأ أثناء البحث عن الـ Inbox المطابق:', err.message);
  }

  for (const msg of value.messages) {
    const messageType = msg.type;
    let messageText = null;
    let mediaUrl = null;

    if (messageType === 'text') {
      messageText = msg.text?.body || null;
    } else if (['image', 'video', 'audio', 'document', 'sticker'].includes(messageType)) {
      mediaUrl = msg[messageType]?.id || null; // ده media id من ميتا، محتاج استدعاء API تاني عشان تجيب الرابط الفعلي
      messageText = msg[messageType]?.caption || null;
    } else if (messageType === 'button') {
      messageText = msg.button?.text || null;
    } else if (messageType === 'interactive') {
      messageText =
        msg.interactive?.button_reply?.title ||
        msg.interactive?.list_reply?.title ||
        null;
    }

    const contactName = contact?.profile?.name || null;

    // أول ما رقم يبعت رسالة: لو عندنا كونتاكت مسجل بالرقم ده نستخدمه، ولو لأ ننشئ كونتاكت جديد تلقائيًا
    const matchedContact = await contactService.findOrCreateContactForIncoming(msg.from, contactName);

    const { id: conversationId, isNew } = await conversationRepo.findOrCreateConversation(
      msg.from,
      contactName,
      matchedInbox?.id || null,
      matchedContact?.id || null
    );
    await conversationRepo.touchConversation(conversationId);

    const saved = await conversationRepo.saveMessage({
      waMessageId: msg.id,
      conversationId,
      direction: 'in',
      fromNumber: msg.from,
      toNumber: value.metadata?.display_phone_number || null,
      contactName,
      messageType,
      messageText,
      mediaUrl,
      rawPayload: JSON.stringify(msg),
    });

    if (io) {
      io.emit('new_message', { conversationId, message: saved });
    }

    // Webhooks الصادرة: بنبعت حدث "رسالة جديدة" فورًا لأي Webhook مسجل ومشترك في
    // الحدث ده (direction: in لأنها جاية من العميل)، وحدث "محادثة جديدة" لو دي فعلاً أول رسالة
    webhookDispatchService.dispatchEvent(webhookDispatchService.EVENT_TYPES.MESSAGE_CREATED, {
      conversation_id: conversationId,
      message: {
        id: saved.id,
        text: messageText,
        from: msg.from,
        type: messageType,
        direction: 'in',
        created_at: saved.created_at,
      },
    }).catch((err) => logger.error('❌ فشل إرسال Webhook message_created:', err.message));

    if (isNew) {
      webhookDispatchService.dispatchEvent(webhookDispatchService.EVENT_TYPES.CONVERSATION_CREATED, {
        conversation_id: conversationId,
        contact_name: contactName,
        phone: msg.from,
      }).catch((err) => logger.error('❌ فشل إرسال Webhook conversation_created:', err.message));
    }

    // قاعدة الـ Keyword Routing: بتتفحص مع كل رسالة نصية جاية من العميل (مش
    // بس أول رسالة بتفتح المحادثة)، عشان لو العميل ذكر كلمة زي "فاتورة" في
    // نص المحادثة في أي وقت، تتحول المحادثة فورًا للتيم المحدد
    if (messageText) {
      applyKeywordRoutingForMessage(conversationId, messageText, io).catch((err) => {
        logger.error('❌ فشل تنفيذ قاعدة الـ Keyword Routing:', err.message);
      });
    }

    // قواعد الأتمتة (Automation) اللي بتتفعّل أول ما محادثة جديدة تتفتح فعليًا —
    // بتتنفذ مرة واحدة بس (أول رسالة فعلاً بتنشئ المحادثة)، مش مع كل رسالة جاية
    // بعد كده على نفس المحادثة المفتوحة
    if (isNew) {
      applyAutomationForNewConversation(conversationId, matchedInbox?.id || null, msg.from, io).catch((err) => {
        logger.error('❌ فشل تنفيذ قواعد الأتمتة على محادثة جديدة:', err.message);
      });
    }
  }
}

// بتنفذ قاعدتين من قواعد الأتمتة على أي محادثة جديدة اتفتحت فعلاً:
// 1) Auto-assign: لو مفعّلة، بتعين المحادثة فورًا للإيجنت المحدد في الإعدادات
// 2) رسالة الترحيب: لو مفعّلة، بتبعت نص ثابت للعميل بمجرد ما المحادثة تتفتح
async function applyAutomationForNewConversation(conversationId, inboxId, contactNumber, io) {
  const settings = await companyRepo.getAutomationSettings();
  if (!settings) return;

  // بتحدد نص رسالة الترحيب اللي هتتبعت فعليًا: لو خاصية الجدول مش مفعّلة
  // بيبقى فيه رسالة واحدة ثابتة زي الأول، ولو مفعّلة بيتم اختيار الرسالة
  // المناسبة حسب الوقت الحالي (جوه أوقات العمل ولا برّاها)
  function resolveWelcomeText() {
    if (!settings.welcome_enabled) return null;
    if (!settings.welcome_schedule_enabled) {
      return settings.welcome_message || null;
    }
    const inHours = isWithinBusinessHours(settings.welcome_schedule);
    return (inHours ? settings.welcome_message : settings.welcome_offhours_message) || null;
  }

  if (settings.auto_assign_enabled && settings.auto_assign_agent_id) {
    try {
      const agent = await userRepo.findUserById(settings.auto_assign_agent_id);
      if (agent) {
        const agentName = userRepo.resolveDisplayName(agent);
        const [, systemMessage] = await Promise.all([
          conversationRepo.assignConversation(conversationId, settings.auto_assign_agent_id),
          conversationRepo.addSystemMessage(
            conversationId,
            `Auto-assigned to ${agentName} (Automation rule: Auto-assign new WhatsApp conversations)`
          ),
        ]);
        const updated = await conversationRepo.getConversationById(conversationId);
        if (io && updated) {
          io.emit('conversation_updated', updated);
          io.emit('new_message', { conversationId, message: systemMessage });
        }
      }
    } catch (err) {
      logger.error('❌ فشل الـ Auto-assign التلقائي للمحادثة الجديدة:', err.message);
    }
  }

  const welcomeText = resolveWelcomeText();
  if (welcomeText) {
    try {
      const message = await whatsappService.sendTextMessage(
        contactNumber,
        welcomeText,
        conversationId,
        inboxId,
        { id: null, name: 'Automation' }
      );
      await conversationRepo.touchConversation(conversationId);
      if (io && message) {
        io.emit('new_message', { conversationId, message });
      }
    } catch (err) {
      logger.error('❌ فشل إرسال رسالة الترحيب التلقائية:', err.message);
    }
  }
}

// قاعدة أتمتة "التوجيه بالكلمات المفتاحية" (Keyword Routing): بتدعم أكتر من
// قاعدة مستقلة، كل واحدة فيها مجموعة كلمات + تيم مختلف. لو نص رسالة العميل فيه
// أي واحدة من كلمات قاعدة معينة، بتتحط المحادثة على تيم القاعدة دي فورًا —
// بحث بسيط بالـ substring، case-insensitive. بتشتغل مع كل رسالة نصية جاية، مش
// أول رسالة بس. لو أكتر من قاعدة اتحققت في نفس الرسالة، كل التيمز المطابقة
// بتتحط على المحادثة. وبتتم بنفس الطريقة بالظبط اللي بتحصل بيها لو اليوزر حط
// التيم يدويًا من كارت العميل (نفس الـ repo function ونفس حدث الـ socket
// conversation_teams_updated)، عشان تظهر فورًا في كارت العميل وكارت المحادثة
// من برا بالظبط زي ما لو كانت اتحطت يدوي
async function applyKeywordRoutingForMessage(conversationId, messageText, io) {
  const settings = await companyRepo.getAutomationSettings();
  if (!settings || !settings.keyword_routing_enabled) return;

  const rules = settings.keyword_routing_rules || [];
  if (!rules.length) return;

  const normalizedText = String(messageText).toLocaleLowerCase();

  // بنجمع كل التيمز اللي قواعدهم اتحققت في الرسالة دي (ممكن يكون أكتر من تيم واحد)
  const matches = []; // [{ teamId, matchedKeyword }]
  for (const rule of rules) {
    if (!rule.team_id || !rule.keywords || !rule.keywords.length) continue;
    const matchedKeyword = rule.keywords.find((k) => normalizedText.includes(String(k).toLocaleLowerCase()));
    if (matchedKeyword) matches.push({ teamId: rule.team_id, matchedKeyword });
  }
  if (!matches.length) return;

  try {
    const existingTeams = await teamRepo.listTeamsForConversation(conversationId);
    const existingTeamIds = new Set(existingTeams.map((t) => String(t.id)));

    // لو التيم متحط بالفعل على المحادثة من قبل، متبقاش نعيد نفس الخطوة تاني ليه
    const newMatches = matches.filter((m) => !existingTeamIds.has(String(m.teamId)));
    if (!newMatches.length) return;

    // بنشيل أي تكرار لنفس التيم لو أكتر من قاعدة بتوجه له (كفاية مرة واحدة)
    const seenTeamIds = new Set();
    let latestTeams = existingTeams;
    for (const { teamId, matchedKeyword } of newMatches) {
      if (seenTeamIds.has(String(teamId))) continue;
      seenTeamIds.add(String(teamId));

      const team = await teamRepo.getTeamById(teamId);
      if (!team) continue;

      // نفس الـ repo function المستخدمة بالظبط لما اليوزر يحط تيم يدويًا على
      // محادثة من كارت العميل (شوف team.controller.js -> addToConversation)
      const [teams, systemMessage] = await Promise.all([
        teamRepo.addTeamToConversation(conversationId, teamId),
        conversationRepo.addSystemMessage(
          conversationId,
          `Routed to team ${team.name} (Automation rule: Route conversations by keyword — matched "${matchedKeyword}")`
        ),
      ]);
      latestTeams = teams;

      if (io) {
        // نفس حدث الـ socket بالظبط اللي بيتبعت لما التيم يتحط يدويًا، عشان
        // كارت العميل وكارت المحادثة في القايمة الجانبية يتحدّثوا فورًا بنفس
        // الطريقة تمامًا من غير أي فرق محسوس عن الإضافة اليدوية
        io.emit('conversation_teams_updated', { conversationId, teams: latestTeams });
        if (systemMessage) io.emit('new_message', { conversationId, message: systemMessage });
      }
    }
  } catch (err) {
    logger.error('❌ فشل تنفيذ قاعدة الـ Keyword Routing على المحادثة:', err.message);
  }
}

// تحديثات حالة الرسائل اللي بعتناها (sent/delivered/read/failed) — بنسجلها في
// عمود status بس عشان الأرشفة/الداتا، من غير ما نبعتها لايف على الـ socket
// (مفيش تيك بيتعرض في الواجهة يستخدمها أصلًا بعد ما اتشالت فكرة الصح/الصحين)
async function processStatusUpdates(value) {
  for (const st of value.statuses) {
    const updated = await conversationRepo.updateMessageStatusByWaId(st.id, st.status);

    // حدث "رسالة اتحدثت": بيحصل هنا فعليًا لما ميتا ترجع حالة تسليم/قراءة/فشل
    // لرسالة بعتناها قبل كده (sent/delivered/read/failed)
    if (updated) {
      webhookDispatchService.dispatchEvent(webhookDispatchService.EVENT_TYPES.MESSAGE_UPDATED, {
        conversation_id: updated.conversation_id || null,
        message: { id: updated.id, wa_message_id: st.id, status: st.status },
      }).catch((err) => logger.error('❌ فشل إرسال Webhook message_updated:', err.message));
    }
  }
}

module.exports = { sendReply, sendReplyLive, processIncomingMessages, processStatusUpdates };
