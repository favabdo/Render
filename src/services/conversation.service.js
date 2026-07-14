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
const notificationService = require('./notification.service');
const ratingRepo = require('../repositories/rating.repo');
const ratingFlowService = require('./ratingFlow.service');
const socketService = require('../socket/socket');
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

// نفس فلسفة sendReplyLive بالظبط بس لرسايل الوسائط (صورة/فيديو/صوت/مستند):
// بتسجل الرسالة فورًا برابط الملف المحلي (بيظهر في الشات على طول) وترجعها،
// وفي الخلفية بترفع الملف لواتساب فعليًا وتبعت الرسالة، وتنادي onFinalized
// بالنتيجة النهائية (sent/failed) عشان الكنترولر يبعتها لايف على الـ socket
async function sendMediaReplyLive(conversation, fileInfo, sender, onFinalized) {
  const { buffer, mimeType, fileName, messageType, caption } = fileInfo;

  const [savedMessage] = await Promise.all([
    whatsappService.createOutgoingMediaMessage(
      conversation.contact_number,
      { messageType, mediaUrl: fileInfo.publicUrl, mimeType, fileName, caption },
      conversation.id,
      conversation.inbox_id,
      sender
    ),
    conversationRepo.touchConversation(conversation.id),
  ]);

  whatsappService
    .deliverOutgoingMediaMessage(
      savedMessage,
      {
        toNumber: conversation.contact_number,
        buffer,
        messageType,
        mimeType,
        fileName,
        caption,
        inboxId: conversation.inbox_id,
      },
      async (finalRow) => {
        if (finalRow) await conversationRepo.touchConversation(conversation.id);
        if (onFinalized) onFinalized(finalRow);
      }
    )
    .catch(() => {
      /* أي استثناء غير متوقع اتلقط واتسجل جوه deliverOutgoingMediaMessage نفسها بالفعل */
    });

  return savedMessage;
}

const STARS_BY_RATING = { 1: '⭐', 2: '⭐⭐', 3: '⭐⭐⭐', 4: '⭐⭐⭐⭐', 5: '⭐⭐⭐⭐⭐' };

// بتحوّل رد فورم WhatsApp Flow (تقييم بعد الحل) لنص مقروء يتحط في فقاعة الشات
// بدل الـ JSON الخام اللي واتساب بيرجعه فعليًا
function buildFlowReplySummaryText(nfmReply) {
  let payload = {};
  try {
    payload = JSON.parse(nfmReply?.response_json || '{}');
  } catch (err) {
    return 'تم إرسال تقييم';
  }
  const issue = Number(payload.issue_rating) || null;
  const agent = Number(payload.agent_rating) || null;
  const lines = ['تقييم الخدمة:'];
  lines.push(`حل المشكلة: ${issue ? `${STARS_BY_RATING[issue] || ''} (${issue}/5)` : '—'}`);
  lines.push(`الإيجنت: ${agent ? `${STARS_BY_RATING[agent] || ''} (${agent}/5)` : '—'}`);
  if (payload.feedback_text) {
    lines.push(`تعليق: ${payload.feedback_text}`);
  }
  return lines.join('\n');
}

// بيتعامل مع الرسائل الواردة من webhook واتساب (رسائل جديدة من عملاء)
// wabaId: الـ Business Account ID اللي ميتا بعتته مع الـ webhook ده (entry.id) —
// لو الـ Inbox المطابق لسه مالوش business_account_id متسجل، بنسجله هنا تلقائيًا
// (لازم لإنشاء WhatsApp Flow "تقييم بعد الحل" بعدين، من غير أي إدخال يدوي)
async function processIncomingMessages(value, io, wabaId = null) {
  const contact = value.contacts?.[0];

  // بنحدد أي Inbox (رقم واتساب) استقبل الرسالة دي، عشان نربط المحادثة بيه
  const incomingPhoneNumberId = value.metadata?.phone_number_id || null;
  let matchedInbox = null;
  try {
    matchedInbox = await inboxRepo.findInboxByPhoneNumberId(incomingPhoneNumberId);
  } catch (err) {
    logger.error('❌ خطأ أثناء البحث عن الـ Inbox المطابق:', err.message);
  }

  if (matchedInbox && wabaId && !matchedInbox.business_account_id) {
    try {
      await inboxRepo.setBusinessAccountId(matchedInbox.id, wabaId);
      matchedInbox.business_account_id = wabaId;
      logger.info(`✅ اتسجل Business Account ID تلقائيًا لـ Inbox #${matchedInbox.id} من الـ webhook`);
    } catch (err) {
      logger.error('❌ فشل تسجيل Business Account ID تلقائيًا:', err.message);
    }
  }

  for (const msg of value.messages) {
    const messageType = msg.type;
    let messageText = null;
    let mediaUrl = null;
    let mediaMime = null;
    let mediaFileName = null;

    if (messageType === 'text') {
      messageText = msg.text?.body || null;
    } else if (['image', 'video', 'audio', 'document', 'sticker'].includes(messageType)) {
      const mediaId = msg[messageType]?.id || null;
      messageText = msg[messageType]?.caption || null;
      mediaFileName = msg[messageType]?.filename || null;

      // بننزّل الملف فعليًا من ميتا ونخزنه عندنا (الـ media id لوحده مش كافي —
      // محتاج توكن صالح كل مرة وبينتهي، فبنحوّله لرابط ثابت نقدر نعرضه في الشات مباشرة)
      const downloaded = await whatsappService.downloadIncomingMedia(mediaId, matchedInbox?.id || null);
      if (downloaded) {
        mediaUrl = downloaded.url;
        mediaMime = downloaded.mimeType;
      } else {
        // فشل التنزيل (توكن منتهي، الملف اتمسح من عند ميتا...) — بنسجل الرسالة برضه
        // من غير رابط عشان الإيجنت على الأقل يشوف إنها كانت وسائط، مش تختفي تمامًا
        logger.error(`⚠️ تعذر تنزيل ميديا واردة (type=${messageType}, id=${mediaId})`);
      }
    } else if (messageType === 'button') {
      messageText = msg.button?.text || null;
    } else if (messageType === 'interactive') {
      if (msg.interactive?.type === 'nfm_reply') {
        // رد فورم WhatsApp Flow (تقييم بعد الحل) — بنبني نص مقروء يتحط في
        // فقاعة الشات بدل الـ JSON الخام، وده اللي هيتعرض للإيجنت في اللوحة
        messageText = buildFlowReplySummaryText(msg.interactive.nfm_reply);
      } else {
        messageText =
          msg.interactive?.button_reply?.title ||
          msg.interactive?.list_reply?.title ||
          null;
      }
    }

    const contactName = contact?.profile?.name || null;

    // لو الرقم ده عنده طلب تقييم "ما بعد الحل" لسه مفتوح، بنعامل الرسالة دي كرد
    // على فلو التقييم (رقم نجوم أو تعليق نصي) مش كرسالة عادية — بنسجلها جوه نفس
    // المحادثة المقفولة اللي فتح التقييم عليها، من غير ما نفتح تذكرة جديدة أو
    // نبعت أي إشعارات للإيجنتس أو نطبّق قواعد أتمتة/توجيه عليها
    if (['text', 'button', 'interactive'].includes(messageType) && messageText) {
      const pendingRating = await ratingRepo.getPendingRatingByContactNumber(msg.from);
      if (pendingRating) {
        const saved = await conversationRepo.saveMessage({
          waMessageId: msg.id,
          conversationId: pendingRating.conversation_id,
          direction: 'in',
          fromNumber: msg.from,
          toNumber: value.metadata?.display_phone_number || null,
          contactName,
          messageType,
          messageText,
          rawPayload: JSON.stringify(msg),
          isPostResolve: true,
        });
        if (io) {
          socketService.emitToPrivilegedRoom(io, 'new_message', { conversationId: pendingRating.conversation_id, message: saved });
        }
        try {
          if (messageType === 'interactive' && msg.interactive?.type === 'nfm_reply') {
            // رد الـ Flow الموحّد (تقييمين + تعليق مع بعض) — بيتقفل الطلب مرة واحدة
            await ratingFlowService.handleFlowSubmit(pendingRating, msg.interactive.nfm_reply, io);
          } else {
            // fallback: أسلوب الأسئلة المتدرجة القديم (استُخدم لو الـ Flow فشل إنشاؤه)
            await ratingFlowService.handleIncomingRatingReply(pendingRating, messageText, io);
          }
        } catch (err) {
          logger.error('❌ فشل تنفيذ رد فلو تقييم ما بعد الحل:', err.message);
        }
        continue;
      }
    }

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
      mediaMime,
      mediaFileName,
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

    // إشعارات الإيجنتس: "محادثة جديدة" لكل الإيجنتس النشطين لو دي فعلاً أول رسالة،
    // و"رسالة جديدة في محادثة معينة عليك" للإيجنت المعين، و"رسالة جديدة في محادثة
    // أنت مشارك فيها" لأي إيجنت رد فيها قبل كده (غير المعين نفسه)
    notifyAgentsAboutIncomingMessage({ conversationId, isNew, contactName, phoneNumber: msg.from }).catch(
      (err) => logger.error('❌ فشل تنفيذ إشعارات الرسالة الواردة:', err.message)
    );

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
// بيبعت إشعارات الرسايل الواردة: محادثة جديدة (للكل)، رسالة في محادثة معينة عليك
// (للإيجنت المعين)، ورسالة في محادثة أنت مشارك فيها (لأي إيجنت رد فيها قبل كده)
async function notifyAgentsAboutIncomingMessage({ conversationId, isNew, contactName, phoneNumber }) {
  const displayName = contactName || phoneNumber;

  if (isNew) {
    const allAgents = await userRepo.listUsers();
    const allAgentIds = allAgents.filter((u) => u.status === 'active').map((u) => u.id);
    await notificationService.notifyEvent(notificationService.NOTIFICATION_TYPES.CONVERSATION_CREATED, {
      title: 'محادثة جديدة',
      message: `بدأت محادثة جديدة مع ${displayName}`,
      referenceId: conversationId,
      targetUserIds: allAgentIds,
    });
    return; // أول محادثة لسه معملهاش حد assign ولا رد عليها، فمفيش participants/assigned agent لسه
  }

  const conversation = await conversationRepo.getConversationById(conversationId);
  if (!conversation) return;

  const assignedAgentId = conversation.assigned_agent_id || null;

  if (assignedAgentId) {
    await notificationService.notifyEvent(notificationService.NOTIFICATION_TYPES.ASSIGNED_CONVERSATION_MESSAGE, {
      title: 'رسالة جديدة في محادثة معينة عليك',
      message: `وصلت رسالة جديدة من ${displayName} في محادثة معينة عليك`,
      referenceId: conversationId,
      targetUserIds: [assignedAgentId],
    });
  }

  const participantIds = await conversationRepo.getParticipantAgentIds(
    conversationId,
    assignedAgentId ? [assignedAgentId] : []
  );
  if (participantIds.length) {
    await notificationService.notifyEvent(notificationService.NOTIFICATION_TYPES.PARTICIPATING_CONVERSATION_MESSAGE, {
      title: 'رسالة جديدة في محادثة أنت مشارك فيها',
      message: `وصلت رسالة جديدة من ${displayName} في محادثة أنت شاركت فيها قبل كده`,
      referenceId: conversationId,
      targetUserIds: participantIds,
    });
  }
}

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

module.exports = { sendReply, sendReplyLive, sendMediaReplyLive, processIncomingMessages, processStatusUpdates };
