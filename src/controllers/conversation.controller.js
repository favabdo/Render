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
  let targetAgentId = req.user.userId;
  const isSelfAssign = !agentId || String(agentId) === String(req.user.userId);

  if (agentId) {
    const agent = await userRepo.findUserById(agentId);
    if (!agent) return res.status(404).json({ error: 'الموظف ده مش موجود' });
    targetAgentId = agentId;
  }

  // بنجيب اسم الإيجنت اللي عامل الفعل (اللي بعت الـ request) واسم الإيجنت المستهدف
  // (لو مختلف) عشان نكتب رسالة النظام المناسبة قبل ما نعمل الـ assign
  const actingUser = await userRepo.findUserById(req.user.userId);
  const actingName = actingUser ? userRepo.resolveDisplayName(actingUser) : 'إيجنت';

  let targetName = actingName;
  if (!isSelfAssign) {
    const targetUser = await userRepo.findUserById(targetAgentId);
    targetName = targetUser ? userRepo.resolveDisplayName(targetUser) : 'إيجنت';
  }

  await conversationRepo.assignConversation(req.params.id, targetAgentId);

  const systemText = isSelfAssign
    ? `${actingName} self-assigned this conversation`
    : `Assigned to ${targetName} by ${actingName}`;
  const systemMessage = await conversationRepo.addSystemMessage(req.params.id, systemText);
  // من غيرها، رسايل النظام كانت مش بتحدّث last_message_at، فلو الـ socket event
  // ضاع لأي سبب (اتقطع الاتصال لحظتها مثلاً)، الـ polling الاحتياطي في الفرونت
  // كان عمره ما هيلاحظ إن فيه حاجة جديدة غير بريفريش يدوي كامل للصفحة
  await conversationRepo.touchConversation(req.params.id);

  const conversation = await conversationRepo.getConversationById(req.params.id);
  const io = req.app.get('io');
  if (io) {
    io.emit('conversation_updated', conversation);
    io.emit('new_message', { conversationId: conversation.id, message: systemMessage });
  }
  res.json({ ok: true, conversation });
}

// إغلاق المحادثة فعليًا في الداتابيز (Resolve حقيقي مش شكلي)
async function resolve(req, res) {
  const { category, notes } = req.body || {};
  const conversation = await conversationRepo.getConversationById(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'المحادثة مش موجودة' });

  await conversationRepo.resolveConversation(req.params.id, { category, notes, resolvedBy: req.user.userId });

  const actingUser = await userRepo.findUserById(req.user.userId);
  const actingName = actingUser ? userRepo.resolveDisplayName(actingUser) : 'إيجنت';
  const systemMessage = await conversationRepo.addSystemMessage(
    req.params.id,
    `Conversation was marked resolved by ${actingName}`
  );
  await conversationRepo.touchConversation(req.params.id);

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
  const conversation = await conversationRepo.getConversationById(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'المحادثة مش موجودة' });

  await conversationRepo.reopenConversation(req.params.id);

  const actingUser = await userRepo.findUserById(req.user.userId);
  const actingName = actingUser ? userRepo.resolveDisplayName(actingUser) : 'إيجنت';
  const systemMessage = await conversationRepo.addSystemMessage(
    req.params.id,
    `Conversation was reopened by ${actingName}`
  );
  await conversationRepo.touchConversation(req.params.id);

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

  const conversation = await conversationRepo.getConversationById(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'المحادثة مش موجودة' });

  const sender = await userRepo.findUserById(req.user.userId);
  const senderName = sender ? userRepo.resolveDisplayName(sender) : null;

  const note = await conversationRepo.addPrivateNote(req.params.id, {
    text: text.trim(),
    senderId: req.user.userId,
    senderName,
  });

  // بنبعتها لايف لكل الإيجنتس الفاتحين المحادثة دي عن طريق socket منفصل (new_note)
  // عشان محدش يخلطها بـ 'new_message' (اللي مرتبط بمنطق العميل/واتساب)
  const io = req.app.get('io');
  if (io) io.emit('new_note', { conversationId: conversation.id, note });

  res.json({ ok: true, note });
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

  const senderInfo = sender ? { id: sender.id, name: userRepo.resolveDisplayName(sender) } : null;

  const io = req.app.get('io');

  // بترجع فورًا من غير ما تستنى ميتا خالص — عشان الرسالة تبان لايف عند كل
  // الإيجنتس فورًا (مش بس اللي بعتها)، من غير أي انتظار لرد واتساب الفعلي.
  // ملحوظة: فكرة "تيك واحد / تيكين" اتشالت خالص بناءً على طلب صاحب المشروع —
  // الرسالة بتتسجل وتتحدّث حالتها (sent/failed) في الداتابيز في الخلفية بس من
  // غير ما نبعت أي حدث socket تاني عليها (مفيش حاجة في الواجهة بتعرضها أصلًا)
  const message = await conversationService.sendReplyLive(conversation, text, senderInfo, () => {});

  if (io) io.emit('new_message', { conversationId: conversation.id, message });

  res.json({ ok: true, message });
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
