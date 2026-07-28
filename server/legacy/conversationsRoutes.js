const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('./authRoutes');
const {
  listConversations,
  getConversationById,
  assignConversation,
  resolveConversation,
  reopenConversation,
  getMessagesForConversation,
  touchConversation,
} = require('./conversationsRepo');
const { sendTextMessage } = require('./whatsappClient');
const { listUsers, createUser, findUserByEmail, updateUser, findUserById, updateDisplayName, resolveDisplayName } = require('./usersRepo');

router.use(requireAuth);

// ===== المحادثات =====

router.get('/api/conversations', async (req, res) => {
  try {
    const conversations = await listConversations();
    res.json(conversations);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/conversations/:id/messages', async (req, res) => {
  try {
    const conversation = await getConversationById(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'المحادثة مش موجودة' });
    const messages = await getMessagesForConversation(req.params.id);
    res.json({ conversation, messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// لو جالك agentId في الـ body بنعين المحادثة للموظف ده (اختيار من قايمة الـ Agents)،
// لو مفيش (زي زرار "Assign to Me") بنعينها للإيجنت اللي عامل لوجين دلوقتي
router.post('/api/conversations/:id/assign', async (req, res) => {
  try {
    const { agentId } = req.body || {};
    let targetAgentId = req.user.userId;

    if (agentId) {
      const agent = await findUserById(agentId);
      if (!agent) return res.status(404).json({ error: 'الموظف ده مش موجود' });
      targetAgentId = agentId;
    }

    await assignConversation(req.params.id, targetAgentId);
    const conversation = await getConversationById(req.params.id);
    const io = req.app.get('io');
    if (io) io.emit('conversation_updated', conversation);
    res.json({ ok: true, conversation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// إغلاق المحادثة فعليًا في الداتابيز (Resolve حقيقي مش شكلي)
router.post('/api/conversations/:id/resolve', async (req, res) => {
  try {
    const { category, notes } = req.body || {};
    const conversation = await getConversationById(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'المحادثة مش موجودة' });

    await resolveConversation(req.params.id, { category, notes, resolvedBy: req.user.userId });
    const updated = await getConversationById(req.params.id);

    const io = req.app.get('io');
    if (io) io.emit('conversation_updated', updated);

    res.json({ ok: true, conversation: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// لو حبيت ترجّع محادثة اتقفلت تفتح تاني (مثلاً العميل رجع يكلم)
router.post('/api/conversations/:id/reopen', async (req, res) => {
  try {
    const conversation = await getConversationById(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'المحادثة مش موجودة' });

    await reopenConversation(req.params.id);
    const updated = await getConversationById(req.params.id);

    const io = req.app.get('io');
    if (io) io.emit('conversation_updated', updated);

    res.json({ ok: true, conversation: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/conversations/:id/reply', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'لازم تبعت text' });

    // بنجيب بيانات المحادثة وبيانات الإيجنت في نفس الوقت (مش الواحدة بعد التانية)
    // لأن الاتنين مستقلين عن بعض تمامًا، وده بيوفر رحلة كاملة (round trip) للداتابيز
    const [conversation, sender] = await Promise.all([
      getConversationById(req.params.id),
      findUserById(req.user.userId),
    ]);
    if (!conversation) return res.status(404).json({ error: 'المحادثة مش موجودة' });
    const senderInfo = sender ? { id: sender.id, name: resolveDisplayName(sender) } : null;

    // بعت الرسالة الفعلية لواتساب، وفي نفس اللحظة حدّث last_message_at
    // (مش لازم نستنى واحد لحد ما التاني يخلص، الاتنين مش معتمدين على نتيجة بعض)
    const [message] = await Promise.all([
      sendTextMessage(conversation.contact_number, text, conversation.id, conversation.inbox_id, senderInfo),
      touchConversation(conversation.id),
    ]);

    const io = req.app.get('io');
    if (io) io.emit('new_message', { conversationId: conversation.id, message });

    res.json({ ok: true, message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ===== البروفايل الشخصي (أي إيجنت مسجل دخول، مش لازم يكون admin) =====

router.get('/api/me', async (req, res) => {
  try {
    const user = await findUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'اليوزر مش موجود' });
    res.json({ ...user, display_name: resolveDisplayName(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// الإيجنت بيغيّر الاسم اللي بيتعرض بيه هو بس (بدل ما يفضل الإيميل ظاهر)
router.patch('/api/me', async (req, res) => {
  try {
    const { display_name } = req.body || {};
    const trimmed = (display_name || '').trim();

    if (!trimmed) {
      return res.status(400).json({ error: 'لازم تكتب اسم' });
    }
    if (trimmed.length < 2 || trimmed.length > 100) {
      return res.status(400).json({ error: 'الاسم لازم يكون بين 2 و 100 حرف' });
    }

    const user = await updateDisplayName(req.user.userId, trimmed);
    if (!user) return res.status(404).json({ error: 'اليوزر مش موجود' });
    res.json({ ok: true, user: { ...user, display_name: resolveDisplayName(user) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// قايمة الإيجنتس الحقيقيين المسجلين — بتتستخدم في صفحة الإعدادات (Agents) وأي حتة
// محتاجة تعرض زملاء الشغل، متاحة لأي إيجنت مسجل دخول (مش admin بس)
router.get('/api/agents-list', async (req, res) => {
  try {
    const users = await listUsers();
    res.json(
      users.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        status: u.status,
        display_name: resolveDisplayName(u),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ===== إدارة المستخدمين (admin فقط) =====

router.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const users = await listUsers();
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/users', requireAdmin, async (req, res) => {
  try {
    const { email, password, role = 'agent', status = 'active' } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'لازم تبعت email و password' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'كلمة المرور لازم تكون 6 حروف على الأقل' });
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'فيه يوزر بنفس الإيميل ده بالفعل' });
    }

    const user = await createUser({ email, password, role, status });
    res.status(201).json({ ok: true, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    const { role, status, password } = req.body;
    const user = await updateUser(req.params.id, { role, status, password });
    if (!user) return res.status(404).json({ error: 'اليوزر مش موجود' });
    res.json({ ok: true, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
