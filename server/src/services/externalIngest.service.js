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
const externalContactRepo = require('../repositories/externalContact.repo');
const externalConversationRepo = require('../repositories/externalConversation.repo');
const externalMessageRepo = require('../repositories/externalMessage.repo');
const externalAgentRepo = require('../repositories/externalAgent.repo');
const contactService = require('./contact.service');
const conversationService = require('./conversation.service');
const chatwootService = require('./chatwoot.service');
const webhookDispatchService = require('./webhookDispatch.service');
const socketService = require('../sockets/socket');
const logger = require('../utils/logger');

async function processChatwootEvent(provider, eventType, payload, io) {
  switch (eventType) {
    case 'message_created':
    case 'message_updated':
      return handleMessageEvent(provider, payload, io);
    case 'contact_created':
    case 'contact_updated':
      return handleContactEvent(provider, payload);
    case 'conversation_status_changed':
    case 'conversation_updated':
      return handleConversationStatusEvent(provider, payload);
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

// ===== Conversation status (خفيف الوزن، بس تتبع الحالة الخارجية) =====
async function handleConversationStatusEvent(provider, payload) {
  const externalConversationId = payload?.id;
  if (!externalConversationId) return;
  const row = await externalConversationRepo.findByProviderAndExternalId(provider.id, externalConversationId);
  if (row) {
    await externalConversationRepo.updateStatus(row.id, payload.status || null);
  }
}

// بيرجع صف External_Conversation_byA (يعمله لو مش موجود)، ومعاه nile_conversation_id
// مربوط دايمًا. الربط ده تقني إجباري (مش ميرج اختياري) عشان المحادثة أصلًا
// تظهر وتترد عليها من لوحة نايل شات — شوف التعليق في externalConversation.repo.js
async function ensureExternalConversation(provider, rawConversation, externalContactRow) {
  const externalConversationId = rawConversation?.id;
  let row = await externalConversationRepo.findByProviderAndExternalId(provider.id, externalConversationId);
  if (row) return { row, isNewNileConversation: false };

  row = await externalConversationRepo.createExternalConversation(provider.id, externalConversationId, {
    externalContactRowId: externalContactRow?.id || null,
    status: rawConversation?.status || null,
    rawJson: JSON.stringify(rawConversation || {}),
  });

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

// ===== Message (المسار الأساسي) =====
async function handleMessageEvent(provider, payload, io) {
  // ملاحظات خاصة جوه شات ووت (private notes) مش رسايل عميل — العميل مايشوفهاش
  if (payload?.private) return;

  const externalMessageId = payload?.id;
  if (!externalMessageId) return;

  // idempotency: لو الرسالة دي مسجلة خلاص (رد بعتناه إحنا عن طريق
  // chatwoot.service.js، أو retry حقيقي من شات ووت لنفس الحدث)، متعملش حاجة
  const existing = await externalMessageRepo.findByProviderAndExternalId(provider.id, externalMessageId);
  if (existing) return;

  const rawConversation = payload.conversation || null;
  const rawSender = payload.sender || rawConversation?.meta?.sender || null;
  // شات ووت: 'incoming' = من العميل، 'outgoing' = من الإيجنت (سواء كتبها في
  // شات ووت مباشرة أو رد من نايل شات ورجعلنا الـ webhook بتاعها — بس دي الحالة
  // التانية بتتوقف عند فحص الـ idempotency فوق قبل ما توصل هنا أصلًا)
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
  const contactName = externalContactRow?.name || null;
  const messageText = payload.content || null;

  // مرفقات (صور/فيديو/صوت/مستندات) — بنسجل الرسالة فورًا من غير ما نستنى
  // التنزيل (بالظبط زي تعامل ميتا)، وبنكمل التنزيل في الخلفية تحت
  const attachment = Array.isArray(payload.attachments) && payload.attachments.length > 0 ? payload.attachments[0] : null;
  const mappedType = attachment ? mapAttachmentType(attachment.file_type) : null;
  const messageType = mappedType || 'text';
  const mediaFileName = attachment?.data_url ? decodeURIComponent(attachment.data_url.split('/').pop() || '') || null : null;

  // لو إيجنت كتب الرد مباشرة من واجهة شات ووت (مش من نايل شات)، بنسجله كمتابعة
  // بسيطة في External_Agent_byA — nile_user_id بيفضل NULL لحد ما يتعمله ميرج
  if (direction === 'out' && rawSender?.type === 'user' && rawSender?.id) {
    externalAgentRepo.findOrCreateAgent(provider.id, rawSender.id, rawSender.name).catch(() => {});
  }

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
      sentByName: direction === 'out' ? rawSender?.name || null : null,
    }),
  ]);

  await externalMessageRepo.createExternalMessage(provider.id, externalMessageId, {
    externalConversationRowId: externalConversationRow.id,
    nileMessageId: saved.id,
    direction,
    messageType,
    rawJson: JSON.stringify(payload),
  });

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
