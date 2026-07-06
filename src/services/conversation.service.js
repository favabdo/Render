// services/conversation.service.js
// منطق المحادثات اللي بيلف أكتر من repository/service مع بعض: بعت رد، ومعالجة رسايل الـ webhook

const conversationRepo = require('../repositories/conversation.repo');
const inboxRepo = require('../repositories/inbox.repo');
const contactService = require('./contact.service');
const whatsappService = require('./whatsapp.service');
const logger = require('../utils/logger');

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

    const conversationId = await conversationRepo.findOrCreateConversation(
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
  }
}

// تحديثات حالة الرسائل اللي بعتناها (sent/delivered/read/failed) — بنسجلها في
// عمود status بس عشان الأرشفة/الداتا، من غير ما نبعتها لايف على الـ socket
// (مفيش تيك بيتعرض في الواجهة يستخدمها أصلًا بعد ما اتشالت فكرة الصح/الصحين)
async function processStatusUpdates(value) {
  for (const st of value.statuses) {
    await conversationRepo.updateMessageStatusByWaId(st.id, st.status);
  }
}

module.exports = { sendReply, sendReplyLive, processIncomingMessages, processStatusUpdates };
