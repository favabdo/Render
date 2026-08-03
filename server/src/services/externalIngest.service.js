// services/externalIngest.service.js
// معالجة كل event وارد من شات ووت (بعد ما اتسجل في External_Event_byA من
// chatwoot.controller.js). هنا بيحصل الـ mapping الفعلي: كونتاكت/محادثة/رسالة
// شات ووت بيتحول لصف حقيقي في جداول نايل شات العادية، بنفس تجربة الإيجنت
// المعتادة (socket + إشعارات + webhooks صادرة) اللي بيحصلها لرسايل واتساب
// المباشرة بالظبط.
//
// الكونتاكتس: بيتم مطابقة/إنشاء كونتاكت نايل شات تلقائي بالرقم — بالظبط زي
// واتساب المباشر بالضبط (contactService.findOrCreateContactForIncoming):
// لو الرقم موجود عندنا خلاص بيتربط بيه، ولو لأ بيتعمله كونتاكت "غير مسجل"
// جديد (بيظهر تحت تاب "أرقام غير مسجلة" في صفحة العملاء لحد ما حد يسجله
// بيانات فعلية). الميرج الصريح (mergeContactToNileContact) بيفضل موجود
// كأداة "إعادة توجيه" لو الإداري عايز يربط الكونتاكت الخارجي ده بكونتاكت
// تاني غير اللي اتطابق تلقائيًا بالرقم.
//
// الإيجنتس مختلفين: nile_user_id بيفضل NULL دايمًا هنا (شوف
// externalAgent.repo.js) — ميرج صريح بس هو اللي يقدر يحطه، من غير أي مطابقة
// تلقائية، لإن ربط حساب إيجنت حساس أمنيًا عكس كونتاكت عميل عادي.

const conversationRepo = require('../repositories/conversation.repo');
const userRepo = require('../repositories/user.repo');
const externalContactRepo = require('../repositories/externalContact.repo');
const externalConversationRepo = require('../repositories/externalConversation.repo');
const externalMessageRepo = require('../repositories/externalMessage.repo');
const externalAgentRepo = require('../repositories/externalAgent.repo');
const contactService = require('./contact.service');
const conversationService = require('./conversation.service');
const chatwootService = require('./chatwoot.service');
const ratingFlowService = require('./ratingFlow.service');
const webhookDispatchService = require('./webhookDispatch.service');
const socketService = require('../sockets/socket');
const logger = require('../utils/logger');

async function processChatwootEvent(provider, eventType, payload, io) {
  switch (eventType) {
    case 'message_created':
    case 'message_updated':
      return handleMessageEvent(provider, payload, io, eventType);
    case 'contact_created':
    case 'contact_updated':
      return handleContactEvent(provider, payload);
    case 'conversation_status_changed':
    case 'conversation_updated':
      return handleConversationStatusEvent(provider, payload, io);
    default:
      logger.info(`ℹ️ حدث شات ووت مش متعامل معاه دلوقتي: ${eventType}`);
  }
}

// ===== Contact =====
function extractContactInfo(rawContact) {
  if (!rawContact || !rawContact.id) return null;
  return {
    id: rawContact.id,
    name: rawContact.name || rawContact.identifier || null,
    phone: rawContact.phone_number ? String(rawContact.phone_number).replace(/^\+/, '') : null,
  };
}

// بيعمل insert/update لصف External_Contacts_byA، وبعدين لو لسه من غير
// nile_contact_id (يعني لسه محدش عمله ميرج صريح)، بيحاول يطابق/ينشئ كونتاكت
// نايل شات بالرقم تلقائيًا — بالظبط زي واتساب المباشر. كده أي عميل جاي من
// شات ووت بيظهر فورًا في صفحة العملاء (تحت "أرقام غير مسجلة" لو مفيش تطابق)
async function upsertContactFromPayload(provider, rawContact) {
  const info = extractContactInfo(rawContact);
  if (!info) return null;

  let row = await externalContactRepo.upsertExternalContact(provider.id, info.id, {
    name: info.name,
    phone: info.phone,
    rawJson: JSON.stringify(rawContact),
  });

  if (!row.nile_contact_id && info.phone) {
    try {
      const nileContact = await contactService.findOrCreateContactForIncoming(info.phone, info.name, provider.company_id);
      if (nileContact) {
        row = await externalContactRepo.mergeContactToNileContact(row.id, nileContact.id);
      }
    } catch (err) {
      logger.error('❌ فشل مطابقة/إنشاء كونتاكت نايل شات تلقائيًا لعميل شات ووت:', err.message);
    }
  }

  return row;
}

async function handleContactEvent(provider, payload) {
  await upsertContactFromPayload(provider, payload);
}

// ===== Conversation status =====
// المزامنة هنا اتجاه واحد بس عمدًا: شات ووت "Resolved" → نايل شات "Resolved".
// أي حالة تانية (open/pending من شات ووت) مبتتزامنش، عشان منتدخلش في قرار
// الإيجنت لو هو Reopen المحادثة يدوي من نايل شات نفسه
async function handleConversationStatusEvent(provider, payload, io) {
  const externalConversationId = payload?.id;
  if (!externalConversationId) return;

  const row = await externalConversationRepo.findByProviderAndExternalId(provider.id, externalConversationId);
  if (!row) return;

  await externalConversationRepo.updateStatus(row.id, payload.status || null);

  if (row.nile_conversation_id) {
    await syncAssigneeFromPayload(provider, payload, row.nile_conversation_id, io, row.id).catch((err) =>
      logger.error('❌ فشل مزامنة تعيين الإيجنت (شات ووت):', err.message)
    );
  }

  if (payload.status !== 'resolved' || !row.nile_conversation_id) return;

  const conversation = await conversationRepo.getConversationById(row.nile_conversation_id);
  if (!conversation || conversation.status === 'closed') return; // اتحل خلاص، مفيش داعي نكرر

  // نفس منطق isFirstResolve بتاع الـ Resolve اليدوي بالظبط — لو locked_at
  // متسجل قبل كده، يبقى دي مش أول مرة (بعد Reopen)، فأتمتة الـ CSAT متتبعتش تاني
  const isFirstResolve = !conversation.locked_at;
  const actingName = 'شات ووت (مزامنة تلقائية)';

  const [, systemMessage] = await Promise.all([
    conversationRepo.resolveConversation(row.nile_conversation_id, {
      category: null,
      notes: 'اتقفلت تلقائيًا لإن المحادثة اتحلت في شات ووت',
      resolvedBy: null,
    }),
    conversationRepo.addSystemMessage(row.nile_conversation_id, `Conversation was marked resolved from Chatwoot`),
    conversationRepo.touchConversation(row.nile_conversation_id),
  ]);

  const updated = await conversationRepo.getConversationById(row.nile_conversation_id);

  if (io) {
    socketService.emitToCompany(io, provider.company_id, 'conversation_updated', updated);
    socketService.emitToConversationRoom(io, updated.id, 'new_message', { conversationId: updated.id, message: systemMessage });
  }

  webhookDispatchService
    .dispatchEvent(webhookDispatchService.EVENT_TYPES.CONVERSATION_STATUS_CHANGED, {
      conversation_id: updated.id,
      status: updated.status,
      resolved_by: actingName,
      category: null,
      notes: null,
    })
    .catch((err) => logger.error('❌ فشل إرسال Webhook conversation_status_changed (شات ووت):', err.message));

  if (isFirstResolve) {
    ratingFlowService.runPostResolveAutomation(updated, io).catch((err) => {
      logger.error('❌ فشل تنفيذ أتمتة ما بعد الحل (شات ووت):', err.message);
    });
  }
}

// بيرجع صف External_Conversation_byA (يعمله لو مش موجود)، ومعاه nile_conversation_id
// مربوط دايمًا. الربط ده تقني إجباري (مش ميرج اختياري) عشان المحادثة أصلًا
// تظهر وتترد عليها من لوحة نايل شات — شوف التعليق في externalConversation.repo.js
async function ensureExternalConversation(provider, rawConversation, externalContactRow) {
  const externalConversationId = rawConversation?.id;
  let row = await externalConversationRepo.findByProviderAndExternalId(provider.id, externalConversationId);
  if (row) return { row, isNewNileConversation: false };

  try {
    row = await externalConversationRepo.createExternalConversation(provider.id, externalConversationId, {
      externalContactRowId: externalContactRow?.id || null,
      status: rawConversation?.status || null,
      rawJson: JSON.stringify(rawConversation || {}),
    });
  } catch (err) {
    // نفس فكرة الـ race في upsertExternalContact بالظبط: لو حدثين وصلوا سوا
    // لأول مرة لنفس المحادثة الجديدة، ممكن الاتنين يشوفوا "مش موجودة" قبل ما
    // أي واحد يخلّص الإنشاء. اللي يخسر السباق يجيب الصف اللي الطرف التاني
    // عمله بدل ما يرمي استثناء يضيع بيه الرسالة اللي جايه مع الحدث ده
    if (String(err.message || '').includes('UQ_ExternalConversation_ProviderExternalId')) {
      let winner = await externalConversationRepo.findByProviderAndExternalId(provider.id, externalConversationId);
      // اللي كسب السباق ممكن يكون لسه في نص عملية الربط بـ NileChat_Conversations_byA
      // (بين الـ INSERT والـ linkNileConversation) — بنستنى شوية صغير ونعيد المحاولة
      // بدل ما نستسلم على طول ونضيع الرسالة
      for (let attempt = 0; attempt < 5 && winner && !winner.nile_conversation_id; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        winner = await externalConversationRepo.findByProviderAndExternalId(provider.id, externalConversationId);
      }
      if (winner) return { row: winner, isNewNileConversation: false };
    }
    throw err;
  }

  // لو مفيش رقم فعلي (نادر لقناة واتساب، بس دفاعيًا)، بنعمل رقم صناعي ثابت
  // مبني على external_contact_id عشان يفضل نفس المحادثة تتلاقى في المرات الجاية
  const contactPhone =
    externalContactRow?.phone || `chatwoot-${externalContactRow?.external_contact_id || externalConversationId}`;
  const contactName = externalContactRow?.name || null;

  const { id: nileConversationId, isNew } = await conversationRepo.findOrCreateConversation(
    contactPhone,
    contactName,
    null, // مفيش Inbox ميتا مباشر مرتبط بمحادثات شات ووت
    externalContactRow?.nile_contact_id || null, // NULL لحد ما يحصل ميرج صريح
    provider.company_id
  );

  await externalConversationRepo.linkNileConversation(row.id, nileConversationId);
  row.nile_conversation_id = nileConversationId;
  return { row, isNewNileConversation: isNew };
}

// شات ووت بيرجع file_type: image/audio/video/file (فايلات عامة) وأنواع تانية
// زي location/contact مش محتاجين نتعامل معاها هنا. بنحول 'file' لـ 'document'
// عشان يتوافق مع أنواع الرسايل المستخدمة أصلًا في نايل شات (زي رسايل واتساب)
function mapAttachmentType(fileType) {
  if (fileType === 'file') return 'document';
  if (['image', 'audio', 'video'].includes(fileType)) return fileType;
  return null;
}

// شات ووت → نايل شات بس (نفس فلسفة اتجاه الـ Resolve). بتاخد الـ assignee
// الحالي من أي payload فيه بيانات محادثة (رسالة عادية أو تحديث حالة).
// بتسجل اسم/آيدي المعيّن له الخام من شات ووت دايمًا (external_assignee_id/name)
// حتى لو لسه مش متعمله ميرج، عشان الواجهة تقدر تعرضه كـ fallback. ولو الإيجنت
// ده متربط (ميرج) بإيجنت نايل شات، بتعيّن المحادثة له فعليًا (assigned_agent_id) —
// لكن بس لو التعيين اتغيّر فعلًا (مش بتكرر نفس التعيين كل رسالة جايه)
async function syncAssigneeFromPayload(provider, rawConversationOrPayload, nileConversationId, io, externalConversationRowId = null) {
  const rawAssignee = rawConversationOrPayload?.meta?.assignee;
  if (!rawAssignee?.id) return;

  const agentRow = await externalAgentRepo.findByProviderAndExternalId(provider.id, rawAssignee.id);

  // نسجل الاسم الخام من شات ووت دايمًا (fallback للعرض لو لسه مفيش ميرج)
  if (externalConversationRowId) {
    externalConversationRepo
      .updateExternalAssignee(externalConversationRowId, rawAssignee.id, rawAssignee.name || null)
      .catch((err) => logger.error('❌ فشل تسجيل اسم المعيّن له الخام من شات ووت:', err.message));
  }

  if (!agentRow?.nile_user_id) return; // الإيجنت ده لسه مش مربوط بحد عندنا — منعيّنش فعليًا

  const conversation = await conversationRepo.getConversationById(nileConversationId);
  if (!conversation || String(conversation.assigned_agent_id) === String(agentRow.nile_user_id)) return;

  const nileUser = await userRepo.findUserById(agentRow.nile_user_id);
  const agentName = nileUser ? userRepo.resolveDisplayName(nileUser) : agentRow.name || 'إيجنت';

  // 1) نحدّث الواجهة فورًا (optimistic) قبل ما ننتظر كتابة قاعدة البيانات —
  // ده اللي بيلغي اللاج اللي كان حاصل، لأن التعيين من شات ووت لازم يظهر
  // في الواجهة فورًا من غير ما يستنى كل عمليات الحفظ (تعيين + رسالة نظام +
  // touch) تخلص الأول
  if (io) {
    socketService.emitToCompany(io, provider.company_id, 'conversation_updated', {
      ...conversation,
      assigned_agent_id: agentRow.nile_user_id,
      assigned_agent_name: agentName,
    });
  }

  // 2) دلوقتي نحفظ فعليًا في السيكوال. لو حصل أي إيرور، نرجّع الواجهة
  // لحالتها الأصلية ونبعت حدث واضح إن الحفظ فشل عشان يظهر تنبيه للمستخدم
  try {
    await conversationRepo.assignConversation(nileConversationId, agentRow.nile_user_id);

    const systemMessage = await conversationRepo.addSystemMessage(
      nileConversationId,
      `Conversation was assigned to ${agentName} (synced from Chatwoot)`
    );
    await conversationRepo.touchConversation(nileConversationId);

    if (io) {
      socketService.emitToConversationRoom(io, nileConversationId, 'new_message', {
        conversationId: nileConversationId,
        message: systemMessage,
      });
      const updated = await conversationRepo.getConversationById(nileConversationId);
      socketService.emitToCompany(io, provider.company_id, 'conversation_updated', updated);
    }
  } catch (err) {
    logger.error('❌ فشل حفظ تعيين المحادثة (متزامن من شات ووت) في السيكوال:', err.message);
    if (io) {
      // رجّع الواجهة للحالة القديمة (قبل التحديث الفوري) واظهرلها تنبيه واضح
      socketService.emitToCompany(io, provider.company_id, 'conversation_updated', conversation);
      socketService.emitToCompany(io, provider.company_id, 'assign_sync_failed', {
        conversationId: nileConversationId,
        agentName,
      });
    }
  }
}

// ===== Message (المسار الأساسي) =====
async function handleMessageEvent(provider, payload, io, eventType) {
  const externalMessageId = payload?.id;
  if (!externalMessageId) return;

  // idempotency: لو الرسالة دي مسجلة خلاص (رد بعتناه إحنا عن طريق
  // chatwoot.service.js، أو retry حقيقي من شات ووت لنفس الحدث)، متعملش حاجة —
  // إلا لو ده تحديث حالة (message_updated) لرسالة صادرة بعتناها إحنا، وقتها
  // بنزامن حالة التسليم/القراءة (تيكين) بدل ما نتجاهل الحدث بالكامل
  const existing = await externalMessageRepo.findByProviderAndExternalId(provider.id, externalMessageId);
  if (existing) {
    if (eventType === 'message_updated' && existing.direction === 'out' && existing.nile_message_id) {
      const chatwootStatus = payload.status; // شات ووت بيبعت: sent/delivered/read/failed
      if (['sent', 'delivered', 'read', 'failed'].includes(chatwootStatus)) {
        const updated = await conversationRepo
          .updateMessageStatusByNileId(existing.nile_message_id, chatwootStatus)
          .catch((err) => {
            logger.error('❌ فشل مزامنة حالة رسالة (تسليم/قراءة) من شات ووت:', err.message);
            return null;
          });
        if (updated && io) {
          socketService.emitToConversationRoom(io, updated.conversation_id, 'message_status_updated', {
            conversationId: updated.conversation_id,
            message: { id: updated.id, status: updated.status },
          });
        }
      }
    }
    return;
  }

  const rawConversation = payload.conversation || null;
  const rawSender = payload.sender || rawConversation?.meta?.sender || null;

  // شات ووت بيبعت message_type كـ: 'incoming' (من العميل) / 'outgoing' (من
  // الإيجنت) / 'activity' (رسالة نظام تلقائية من شات ووت زي "X عيّن المحادثة
  // لـ Y") / 'template'. وبيبعت private=true منفصل للملاحظات الخاصة بين
  // الإيجنتس (مش نوع رسالة، فلاج مستقل)
  const isPrivateNote = Boolean(payload.private);
  const isActivity = payload.message_type === 'activity';
  const direction = payload.message_type === 'incoming' ? 'in' : 'out';

  // الكونتاكت (العميل) بياخد دايمًا من meta.sender بتاع المحادثة نفسها، سواء
  // الرسالة واردة أو صادرة، عشان يفضل موحّد مهما مين اللي بعت
  const rawContact = rawConversation?.meta?.sender || (direction === 'in' ? rawSender : null);
  const externalContactRow = rawContact ? await upsertContactFromPayload(provider, rawContact) : null;

  const { row: externalConversationRow, isNewNileConversation } = await ensureExternalConversation(
    provider,
    rawConversation,
    externalContactRow
  );
  if (!externalConversationRow?.nile_conversation_id) {
    logger.error('❌ مقدرناش نربط رسالة شات ووت بمحادثة حقيقية في نايل شات');
    return;
  }

  const conversationId = externalConversationRow.nile_conversation_id;

  // مزامنة تعيين الإيجنت لو اتغيّر — بغض النظر عن نوع الرسالة، لإن شات ووت
  // بيحط الـ assignee الحالي جوه meta بتاع أي محادثة مع أي رسالة
  await syncAssigneeFromPayload(provider, rawConversation, conversationId, io, externalConversationRow.id).catch((err) =>
    logger.error('❌ فشل مزامنة تعيين الإيجنت (شات ووت):', err.message)
  );

  const contactName = externalContactRow?.name || null;
  const messageText = payload.content || null;

  // لو إيجنت حقيقي كتب الرد/الأكتيفيتي مباشرة من واجهة شات ووت، بنسجله كمتابعة
  // بسيطة في External_Agent_byA (nile_user_id بيفضل NULL لحد ما يتعمله ميرج)،
  // وبنحدد كمان الاسم اللي المفروض يظهر بيه الرد في نايل شات:
  //  - لو الإيجنت ده متعمله ميرج بحد عندنا -> اسمه في نايل شات
  //  - لو مش متعمله ميرج -> اسمه الخام في شات ووت
  //  - لو مفيش إيجنت حقيقي خالص (بوت/رد تلقائي/Automation Rule) -> "Automation"،
  //    مش اسم العميل زي ما كان بيحصل قبل كده
  let resolvedSentByName = null;
  if (direction === 'out') {
    if (rawSender?.type === 'user' && rawSender?.id) {
      const agentRow = await externalAgentRepo
        .findOrCreateAgent(provider.id, rawSender.id, rawSender.name)
        .catch(() => null);
      if (agentRow?.nile_user_id) {
        const nileUser = await userRepo.findUserById(agentRow.nile_user_id).catch(() => null);
        resolvedSentByName = nileUser ? userRepo.resolveDisplayName(nileUser) : rawSender.name || null;
      } else {
        resolvedSentByName = rawSender?.name || null;
      }
    } else {
      resolvedSentByName = 'Automation';
    }
  }


  // "حجز" الرسالة أولًا — INSERT في External_Messages_byA بـ nile_message_id
  // فاضي، قبل أي حاجة تانية. ده اللي بيمنع التكرار فعليًا (مش فحص findByProviderAndExternalId
  // فوق لوحده، لإنه check-then-act ومش atomic): لو حدثين متطابقين وصلوا سوا،
  // الاتنين ممكن يعدّوا من الفحص فوق قبل ما أي واحد يسجل، لكن الـ UNIQUE
  // constraint هنا في الداتابيز نفسها هو الحكم النهائي — واحد بس هيعدي
  const nileDirection = isPrivateNote ? 'note' : isActivity ? 'system' : direction;
  let reservedMessage;
  try {
    reservedMessage = await externalMessageRepo.createExternalMessage(provider.id, externalMessageId, {
      externalConversationRowId: externalConversationRow.id,
      nileMessageId: null,
      direction: nileDirection,
      messageType: 'text',
      rawJson: JSON.stringify(payload),
    });
  } catch (err) {
    if (String(err.message || '').includes('UQ_ExternalMessages_ProviderExternalId')) {
      return; // حدث تاني كسب السباق وسجّل نفس الرسالة، مفيش داعي نكررها
    }
    throw err;
  }

  // ===== ملاحظة خاصة (Private Note) — بتتسجل كملاحظة داخلية عندنا برضو،
  // بنفس شكل الملاحظات اللي الإيجنت بيكتبها من جوه نايل شات نفسه =====
  if (isPrivateNote) {
    const note = await conversationRepo.addPrivateNote(conversationId, {
      text: messageText || '',
      senderId: null,
      senderName: rawSender?.name || 'شات ووت',
    });
    await externalMessageRepo.linkNileMessage(reservedMessage.id, note.id);
    if (io) socketService.emitToCompany(io, provider.company_id, 'new_note', { conversationId, note });
    return;
  }

  // ===== رسالة نظام تلقائية من شات ووت (Activity) — زي "X عيّن المحادثة لـ Y"
  // أو "تم الحل"، بتتسجل كرسالة نظام عندنا بنفس شكل رسايل النظام التانية =====
  if (isActivity) {
    const systemMessage = await conversationRepo.addSystemMessage(conversationId, messageText || 'Activity');
    await conversationRepo.touchConversation(conversationId);
    await externalMessageRepo.linkNileMessage(reservedMessage.id, systemMessage.id);
    if (io) {
      socketService.emitToConversationRoom(io, conversationId, 'new_message', { conversationId, message: systemMessage });
    }
    return;
  }

  // ===== رسالة عادية (من عميل أو رد إيجنت) — المسار الكامل زي قبل كده بالظبط =====
  // مرفقات (صور/فيديو/صوت/مستندات) — بنسجل الرسالة فورًا من غير ما نستنى
  // التنزيل (بالظبط زي تعامل ميتا)، وبنكمل التنزيل في الخلفية تحت
  const attachment = Array.isArray(payload.attachments) && payload.attachments.length > 0 ? payload.attachments[0] : null;
  const mappedType = attachment ? mapAttachmentType(attachment.file_type) : null;
  const messageType = mappedType || 'text';
  const mediaFileName = attachment?.data_url ? decodeURIComponent(attachment.data_url.split('/').pop() || '') || null : null;

  const [, saved] = await Promise.all([
    conversationRepo.touchConversation(conversationId),
    conversationRepo.saveMessage({
      waMessageId: null,
      conversationId,
      direction,
      fromNumber: direction === 'in' ? externalContactRow?.phone || null : null,
      toNumber: direction === 'in' ? null : externalContactRow?.phone || null,
      contactName,
      messageType,
      messageText,
      mediaFileName,
      rawPayload: JSON.stringify(payload),
      sentByName: direction === 'out' ? resolvedSentByName : null,
    }),
  ]);

  await externalMessageRepo.linkNileMessage(reservedMessage.id, saved.id);

  if (io) {
    socketService.emitToConversationRoom(io, conversationId, 'new_message', { conversationId, message: saved });
    socketService.emitToCompany(
      io,
      provider.company_id,
      'conversation_updated',
      socketService.buildConversationSummary(conversationId, saved)
    );
  }

  // لو الرسالة معاها مرفق، بننزّله في الخلفية (من غير await هنا عمدًا) وبمجرد
  // ما يخلص بنحدّث الرسالة ونبعت حدث socket يملي الصورة/الملف في فقاعة الشات
  // مباشرة من غير ما الإيجنت يعمل ريفريش — بالظبط زي تعامل ميتا
  if (attachment?.data_url) {
    chatwootService
      .downloadAttachment(attachment.data_url)
      .then(async (downloaded) => {
        if (!downloaded) {
          logger.error(`⚠️ تعذر تنزيل مرفق وارد من شات ووت (type=${attachment.file_type})`);
          return;
        }
        const updated = await conversationRepo.updateMessageMedia(saved.id, {
          mediaUrl: downloaded.url,
          mediaMime: downloaded.mimeType,
        });
        if (io && updated) {
          socketService.emitToConversationRoom(io, conversationId, 'message_media_ready', { conversationId, message: updated });
        }
      })
      .catch((err) => logger.error('❌ خطأ غير متوقع أثناء تنزيل مرفق وارد من شات ووت:', err.message));
  }

  // بس للرسايل الواردة فعليًا من عميل (مش رد إيجنت اتكتب من شات ووت مباشرة) —
  // نفس منطق الإشعارات والـ webhooks الصادرة المستخدم لرسايل واتساب المباشرة
  if (direction === 'in') {
    webhookDispatchService
      .dispatchEvent(webhookDispatchService.EVENT_TYPES.MESSAGE_CREATED, {
        conversation_id: conversationId,
        message: { id: saved.id, text: messageText, type: 'text', direction: 'in', created_at: saved.created_at },
      })
      .catch((err) => logger.error('❌ فشل إرسال Webhook message_created (شات ووت):', err.message));

    if (isNewNileConversation) {
      webhookDispatchService
        .dispatchEvent(webhookDispatchService.EVENT_TYPES.CONVERSATION_CREATED, {
          conversation_id: conversationId,
          contact_name: contactName,
          phone: externalContactRow?.phone || null,
        })
        .catch((err) => logger.error('❌ فشل إرسال Webhook conversation_created (شات ووت):', err.message));
    }

    conversationService
      .notifyAgentsAboutIncomingMessage({
        conversationId,
        isNew: isNewNileConversation,
        contactName,
        phoneNumber: externalContactRow?.phone || null,
      })
      .catch((err) => logger.error('❌ فشل تنفيذ إشعارات الرسالة الواردة (شات ووت):', err.message));
  }
}

module.exports = {
  processChatwootEvent,
};
