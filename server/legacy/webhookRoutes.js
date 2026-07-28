const express = require('express');
const router = express.Router();
const { saveMessage, saveStatusUpdate } = require('./messagesRepo');
const { findOrCreateConversation, touchConversation } = require('./conversationsRepo');
const { findInboxByPhoneNumberId } = require('./inboxesRepo');
const { findContactByPhone, createContactWithPhone } = require('./contactsRepo');

// ===== 1) التحقق من الـ Webhook (Meta بتعمل GET request مرة واحدة وقت الإعداد) =====
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('✅ تم التحقق من الـ webhook بنجاح');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ===== 2) استقبال الأحداث (رسائل جديدة + تحديثات حالة) =====
router.post('/webhook', async (req, res) => {
  // لازم نرد بسرعة على Meta عشان متعتبرش الـ webhook فاشل
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value) return;

    // --- رسائل واردة من العملاء ---
    if (Array.isArray(value.messages)) {
      const contact = value.contacts?.[0];
      const io = req.app.get('io');

      // بنحدد أي Inbox (رقم واتساب) استقبل الرسالة دي، عشان نربط المحادثة بيه
      // ولو مفيش Inbox متضاف بالطريقة الجديدة من الإعدادات، هنسيب inboxId فاضي
      // (النظام هيفضل شغال زي الأول بمتغيرات الـ .env عادي، من غير أي كسر)
      const incomingPhoneNumberId = value.metadata?.phone_number_id || null;
      let matchedInbox = null;
      try {
        matchedInbox = await findInboxByPhoneNumberId(incomingPhoneNumberId);
      } catch (lookupErr) {
        console.error('❌ خطأ أثناء البحث عن الـ Inbox المطابق:', lookupErr.message);
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

        // أول ما رقم يبعت رسالة: لو عندنا كونتاكت مسجل بالرقم ده نستخدمه، ولو لأ ننشئ
        // كونتاكت جديد تلقائيًا باسمه اللي ظاهر على واتساب (الإيجنت يقدر يغيّره بعدين براحته)
        let matchedContact = null;
        try {
          matchedContact = await findContactByPhone(msg.from);
          if (!matchedContact) {
            matchedContact = await createContactWithPhone(contactName || msg.from, msg.from);
          }
        } catch (contactErr) {
          console.error('❌ خطأ أثناء إيجاد/إنشاء الكونتاكت:', contactErr.message);
        }

        const conversationId = await findOrCreateConversation(
          msg.from,
          contactName,
          matchedInbox?.id || null,
          matchedContact?.id || null
        );
        await touchConversation(conversationId);

        const saved = await saveMessage({
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

    // --- تحديثات حالة الرسائل اللي بعتناها (sent/delivered/read/failed) ---
    if (Array.isArray(value.statuses)) {
      for (const st of value.statuses) {
        await saveStatusUpdate({
          waMessageId: st.id,
          status: st.status,
          rawPayload: JSON.stringify(st),
        });
      }
    }
  } catch (err) {
    console.error('❌ خطأ أثناء معالجة الـ webhook:', err);
  }
});

module.exports = router;
