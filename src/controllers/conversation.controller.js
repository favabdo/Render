// controllers/conversation.controller.js
// المحادثات (لوحة التحكم) + webhook واتساب (استقبال الرسائل من ميتا)

const conversationRepo = require('../repositories/conversation.repo');
const userRepo = require('../repositories/user.repo');
const conversationService = require('../services/conversation.service');
const env = require('../config/env');
const logger = require('../utils/logger');

// ===== المحادثات =====

async function listConversations(req, res) {
  const conversations = await conversationRepo.listConversations();
  res.json(conversations);
}

async function getConversationMessages(req, res) {
  const conversation = await conversationRepo.getConversationById(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'المحادثة مش موجودة' });
  const messages = await conversationRepo.getMessagesForConversation(req.params.id);
  res.json({ conversation, messages });
}

// لو جالك agentId في الـ body بنعين المحادثة للموظف ده (اختيار من قايمة الـ Agents)،
// لو مفيش (زي زرار "Assign to Me") بنعينها للإيجنت اللي عامل لوجين دلوقتي
async function assign(req, res) {
  const { agentId } = req.body || {};
  const isSelfAssign = !agentId || String(agentId) === String(req.user.userId);
  const targetAgentId = agentId || req.user.userId;

  // بنجيب بيانات اليوزر اللي بعت الطلب وبيانات الإيجنت المستهدف في نفس الوقت (مش
  // الواحد بعد التاني)، وكمان لو self-assign مبنجيبش نفس اليوزر مرتين — قبل كده كان
  // بيتقرا 3 مرات في أسوأ حالة (once للتأكد إنه موجود، once كـ actingUser، once كـ targetUser)
  const [actingUser, targetUser] = await Promise.all([
    userRepo.findUserById(req.user.userId),
    isSelfAssign ? Promise.resolve(null) : userRepo.findUserById(targetAgentId),
  ]);

  if (!isSelfAssign && !targetUser) {
    return res.status(404).json({ error: 'الموظف ده مش موجود' });
  }

  const actingName = actingUser ? userRepo.resolveDisplayName(actingUser) : 'إيجنت';
  const targetName = isSelfAssign ? actingName : userRepo.resolveDisplayName(targetUser);

  const systemText = isSelfAssign
    ? `${actingName} self-assigned this conversation`
    : `Assigned to ${targetName} by ${actingName}`;

  // التلات عمليات دول (تعيين المحادثة، تسجيل رسالة النظام، تحديث آخر وقت) مش معتمدين
  // على نتيجة بعض خالص، فبدل ما ننفذهم واحد ورا التاني (3 رحلات كاملة للداتابيز)
  // بنشغلهم سوا في نفس اللحظة (رحلة واحدة بس فعليًا، أطول واحد فيهم هو اللي بيحدد الوقت)
  const [, systemMessage] = await Promise.all([
    conversationRepo.assignConversation(req.params.id, targetAgentId),
    conversationRepo.addSystemMessage(req.params.id, systemText),
    conversationRepo.touchConversation(req.params.id),
  ]);

  // بنرجع للإيجنت فورًا من غير ما نستنى نقرا المحادثة تاني من الداتابيز — إحنا أصلاً
  // عارفين القيمتين الوحيدتين اللي الواجهة محتاجاهم من الرد ده (assigned_agent_name
  // و status) لأننا إحنا اللي كتبناهم بإيدينا في نفس الاستعلام اللي فوق، فمفيش أي
  // داعي نتأكد منهم بقراءة تانية. القراءة الكاملة (بالـ joins) بتحصل تحت في الخلفية
  // بس عشان نبعت تحديث لباقي الإيجنتس الفاتحين نفس المحادثة عن طريق الـ socket.
  res.json({
    ok: true,
    conversation: { id: req.params.id, assigned_agent_id: targetAgentId, assigned_agent_name: targetName, status: 'assigned' },
  });

  const io = req.app.get('io');
  conversationRepo
    .getConversationById(req.params.id)
    .then((conversation) => {
      if (io && conversation) {
        io.emit('conversation_updated', conversation);
        io.emit('new_message', { conversationId: conversation.id, message: systemMessage });
      }
    })
    .catch((err) => logger.error('❌ فشل تحديث المحادثة بعد الأسين (broadcast خلفي):', err.message));
}

// إغلاق المحادثة فعليًا في الداتابيز (Resolve حقيقي مش شكلي)
async function resolve(req, res) {
  const { category, notes } = req.body || {};
  const [conversation, actingUser] = await Promise.all([
    conversationRepo.getConversationById(req.params.id),
    userRepo.findUserById(req.user.userId),
  ]);
  if (!conversation) return res.status(404).json({ error: 'المحادثة مش موجودة' });

  const actingName = actingUser ? userRepo.resolveDisplayName(actingUser) : 'إيجنت';

  // التلات عمليات دول مش معتمدين على نتيجة بعض، فبنشغلهم سوا بدل الواحد بعد التاني
  const [, systemMessage] = await Promise.all([
    conversationRepo.resolveConversation(req.params.id, { category, notes, resolvedBy: req.user.userId }),
    conversationRepo.addSystemMessage(req.params.id, `Conversation was marked resolved by ${actingName}`),
    conversationRepo.touchConversation(req.params.id),
  ]);

  const updated = await conversationRepo.getConversationById(req.params.id);

  const io = req.app.get('io');
  if (io) {
    io.emit('conversation_updated', updated);
    io.emit('new_message', { conversationId: updated.id, message: systemMessage });
  }

  res.json({ ok: true, conversation: updated });
}

// لو حبيت ترجّع محادثة اتقفلت تفتح تاني (مثلاً العميل رجع يكلم)
async function reopen(req, res) {
  const [conversation, actingUser] = await Promise.all([
    conversationRepo.getConversationById(req.params.id),
    userRepo.findUserById(req.user.userId),
  ]);
  if (!conversation) return res.status(404).json({ error: 'المحادثة مش موجودة' });

  const actingName = actingUser ? userRepo.resolveDisplayName(actingUser) : 'إيجنت';

  // نفس الفكرة: التلات عمليات مش معتمدين على بعض، فبنشغلهم سوا
  const [, systemMessage] = await Promise.all([
    conversationRepo.reopenConversation(req.params.id),
    conversationRepo.addSystemMessage(req.params.id, `Conversation was reopened by ${actingName}`),
    conversationRepo.touchConversation(req.params.id),
  ]);

  const updated = await conversationRepo.getConversationById(req.params.id);

  const io = req.app.get('io');
  if (io) {
    io.emit('conversation_updated', updated);
    io.emit('new_message', { conversationId: updated.id, message: systemMessage });
  }

  res.json({ ok: true, conversation: updated });
}

// ملاحظة خاصة بين الإيجنتس بس — مش بتتبعت لواتساب ومش بتظهر للعميل أبدًا
async function addNote(req, res) {
  const { text } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'لازم تكتب نص الملاحظة' });
  }
  const trimmedText = text.trim();

  const [conversation, sender] = await Promise.all([
    conversationRepo.getConversationById(req.params.id),
    userRepo.findUserById(req.user.userId),
  ]);
  if (!conversation) return res.status(404).json({ error: 'المحادثة مش موجودة' });

  const senderName = sender ? userRepo.resolveDisplayName(sender) : null;
  const io = req.app.get('io');

  // بنرجع للإيجنت فورًا من غير ما نستنى تسجيل الملاحظة في الداتابيز خالص — الواجهة
  // أصلاً بتضيفها optimistically في الشات لحظة الضغط على إرسال (قبل حتى ما الريكوست
  // يوصل هنا)، وبتستنى تأكيدها الحقيقي عن طريق حدث الـ socket 'new_note' مش من رد
  // الـ HTTP ده. التسجيل الفعلي بيحصل دلوقتي في الخلفية على طول.
  res.json({ ok: true });

  conversationRepo
    .addPrivateNote(req.params.id, { text: trimmedText, senderId: req.user.userId, senderName })
    .then((note) => {
      // بنبعتها لايف لكل الإيجنتس الفاتحين المحادثة دي عن طريق socket منفصل (new_note)
      // عشان محدش يخلطها بـ 'new_message' (اللي مرتبط بمنطق العميل/واتساب)
      if (io) io.emit('new_note', { conversationId: conversation.id, note });
    })
    .catch((err) => {
      // حالة نادرة جدًا (مشكلة اتصال لحظية بالداتابيز) — بما إننا رجّعنا "ok" فعلاً،
      // لازم نبلّغ الواجهة بشكل صريح إن الملاحظة دي معملتش عشان الإيجنت يبعتها تاني
      logger.error('❌ فشل تسجيل ملاحظة خاصة:', err.message);
      if (io) io.emit('note_failed', { conversationId: conversation.id, text: trimmedText });
    });
}

async function reply(req, res) {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'لازم تبعت text' });

  // بنجيب المحادثة وبيانات الإيجنت في نفس الوقت (مش الواحدة بعد التانية)
  // لأن الاتنين مستقلين عن بعض تمامًا، وده بيوفر رحلة كاملة (round trip) للداتابيز
  const [conversation, sender] = await Promise.all([
    conversationRepo.getConversationById(req.params.id),
    userRepo.findUserById(req.user.userId),
  ]);
  if (!conversation) return res.status(404).json({ error: 'المحادثة مش موجودة' });

  // ممنوع تبعت رسالة لمحادثة مقفولة (Resolved) — لازم تعمل Reopen الأول
  // عشان نضمن إن الرد بيوصل بس للمحادثات المفتوحة فعليًا، حتى لو حصل Reopen قبل كده وقفلها تاني
  if (conversation.status === 'closed') {
    return res.status(409).json({ error: 'المحادثة دي متقفلة (Resolved) — لازم تعمل Reopen الأول عشان تقدر تبعت رسالة' });
  }

  const senderInfo = sender ? { id: sender.id, name: userRepo.resolveDisplayName(sender) } : null;

  const io = req.app.get('io');

  // بترجع فورًا من غير ما تستنى تسجيل الرسالة في الداتابيز ولا رد واتساب خالص —
  // الواجهة أصلاً بتضيف الرسالة optimistically لحظة الضغط على إرسال، وبتستنى
  // تأكيدها الحقيقي عن طريق حدث الـ socket 'new_message' مش من رد الـ HTTP ده.
  // لو التسجيل فشل فعليًا في الخلفية (حالة نادرة)، بنبعت 'message_failed' عشان
  // الواجهة توضح للإيجنت إنها معملتش وتحتاج تتبعت تاني.
  res.json({ ok: true });

  conversationService
    .sendReplyLive(conversation, text, senderInfo, () => {})
    .then((message) => {
      if (io) io.emit('new_message', { conversationId: conversation.id, message });
    })
    .catch((err) => {
      logger.error('❌ فشل تسجيل/إرسال الرد:', err.message);
      if (io) io.emit('message_failed', { conversationId: conversation.id, text });
    });
}

// ===== WhatsApp Webhook =====

// Meta بتعمل GET request مرة واحدة وقت الإعداد للتحقق من الـ webhook
function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
    logger.info('✅ تم التحقق من الـ webhook بنجاح');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
}

// استقبال الأحداث (رسائل جديدة + تحديثات حالة)
async function receiveWebhook(req, res) {
  // لازم نرد بسرعة على Meta عشان متعتبرش الـ webhook فاشل
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value) return;

    const io = req.app.get('io');

    // --- رسائل واردة من العملاء ---
    if (Array.isArray(value.messages)) {
      await conversationService.processIncomingMessages(value, io);
    }

    // --- تحديثات حالة الرسائل اللي بعتناها (sent/delivered/read/failed) ---
    if (Array.isArray(value.statuses)) {
      await conversationService.processStatusUpdates(value);
    }
  } catch (err) {
    logger.error('❌ خطأ أثناء معالجة الـ webhook:', err);
  }
}

module.exports = {
  listConversations,
  getConversationMessages,
  assign,
  resolve,
  reopen,
  reply,
  addNote,
  verifyWebhook,
  receiveWebhook,
};
