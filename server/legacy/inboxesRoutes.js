const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('./authRoutes');
const {
  listInboxes,
  getInboxById,
  findInboxByPhoneNumberId,
  createWhatsappInbox,
  updateInboxStatus,
  deleteInbox,
  getAgentsForInbox,
  setAgentsForInbox,
} = require('./inboxesRepo');
const { listUsers } = require('./usersRepo');
const { verifyWhatsappCredentials } = require('./whatsappVerify');

router.use(requireAuth);

// ===== قنوات الاتصال المتاحة (Step 1: Choose Channel) =====
// دلوقتي القناة الوحيدة اللي شغالة فعليًا وبتوصل رسايل لحظية حقيقية هي WhatsApp Cloud API
// (بروتوكول Webhook Push من ميتا + Socket.io بين السيرفر والداشبورد = زيرو تأخير عن الـ polling)
// باقي القنوات موجودة في الواجهة زي شات ووت بالظبط لحد ما نضيف الـ backend integration بتاعها
router.get('/api/inboxes/channels', (req, res) => {
  res.json([
    {
      key: 'whatsapp',
      name: 'WhatsApp',
      group: 'الأكثر استخدامًا',
      description: 'واتساب Cloud API الرسمي من ميتا — Webhook حقيقي لحظي',
      icon: 'message-circle',
      color: '#25D366',
      available: true,
      recommended: true,
      protocolNote: 'بروتوكول Webhook (Push) — أسرع بروتوكول متاح للرسائل اللحظية، من غير أي Polling',
    },
    { key: 'website', name: 'Website', group: 'الأكثر استخدامًا', description: 'ويدجت شات مباشر على موقعك', icon: 'globe', color: '#6C5CE7', available: false },
    { key: 'facebook', name: 'Messenger', group: 'التواصل الاجتماعي', description: 'صفحة فيسبوك بتاعتك', icon: 'facebook', color: '#1877F2', available: false },
    { key: 'instagram', name: 'Instagram', group: 'التواصل الاجتماعي', description: 'رسايل الـ Direct بتاعة إنستجرام', icon: 'instagram', color: '#E1306C', available: false },
    { key: 'telegram', name: 'Telegram', group: 'التواصل الاجتماعي', description: 'بوت تليجرام', icon: 'send', color: '#26A5E4', available: false },
    { key: 'line', name: 'Line', group: 'التواصل الاجتماعي', description: 'قناة Line الرسمية', icon: 'message-square', color: '#00C300', available: false },
    { key: 'email', name: 'Email', group: 'قنوات تانية', description: 'استقبال ورد على الإيميلات', icon: 'mail', color: '#f59e0b', available: false },
    { key: 'sms', name: 'SMS', group: 'قنوات تانية', description: 'رسائل نصية قصيرة', icon: 'smartphone', color: '#00D2FF', available: false },
    { key: 'voice', name: 'Voice', group: 'قنوات تانية', description: 'مكالمات صوتية (Twilio)', icon: 'phone-call', color: '#ef4444', available: false },
    { key: 'api', name: 'API', group: 'قنوات تانية', description: 'اربط أي مصدر مخصص عن طريق API', icon: 'webhook', color: '#64748b', available: false },
  ]);
});

const PHONE_REGEX = /^\+[1-9]\d{6,14}$/; // لازم يبدأ بـ + وبدون مسافات (زي شات ووت بالظبط)

// ===== Step 2 (جزء "Authenticate your account"): بنتأكد إن الأربعة بيانات دي بتاعة بعض فعلاً =====
// مش مجرد إن التوكن شغال — لازم الرقم يكون هو نفسه المسجل على الـ Phone Number ID ده،
// والـ Phone Number ID ده يكون تابع فعلاً للـ Business Account ID اللي كتبته
router.post('/api/inboxes/whatsapp/authenticate', requireAdmin, async (req, res) => {
  try {
    const { phoneNumber, phoneNumberId, accessToken } = req.body;

    if (!phoneNumber || !phoneNumberId || !accessToken) {
      return res.status(400).json({
        error: 'لازم تملأ الرقم و Phone Number ID و API key التلاتة',
      });
    }
    if (!PHONE_REGEX.test(phoneNumber)) {
      return res.status(400).json({
        error: 'رقم التليفون لازم يبدأ بعلامة + وميكونش فيه مسافات (مثال: +201001234567)',
      });
    }

    const existing = await findInboxByPhoneNumberId(phoneNumberId);
    if (existing) {
      return res.status(409).json({ error: 'رقم الواتساب ده متضاف بالفعل في Inbox تاني' });
    }

    const verified = await verifyWhatsappCredentials({
      phoneNumber,
      phoneNumberId,
      accessToken,
    });

    res.json({ ok: true, ...verified });
  } catch (err) {
    console.error('[Inboxes] whatsapp authenticate failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ===== Step 2: Create Inbox =====
// بنعيد التحقق من الأربعة بيانات تاني هنا (مش بنصدق كلام العميل عن الـ verifiedName/displayPhoneNumber
// اللي بعته)، عشان محدش يقدر يتلاعب ويضيف Inbox ببيانات متطابقة شكليًا بس مش حقيقية
router.post('/api/inboxes', requireAdmin, async (req, res) => {
  try {
    const { name, channelType = 'whatsapp', phoneNumber, phoneNumberId, accessToken } = req.body;

    if (channelType !== 'whatsapp') {
      return res.status(400).json({ error: 'القناة دي لسه متاحة في الواجهة بس، هتشتغل قريبًا' });
    }
    if (!name || !phoneNumberId || !accessToken || !phoneNumber) {
      return res.status(400).json({
        error: 'لازم تبعت name و phoneNumber و phoneNumberId و accessToken',
      });
    }
    if (!PHONE_REGEX.test(phoneNumber)) {
      return res.status(400).json({
        error: 'رقم التليفون لازم يبدأ بعلامة + وميكونش فيه مسافات (مثال: +201001234567)',
      });
    }

    const existing = await findInboxByPhoneNumberId(phoneNumberId);
    if (existing) {
      return res.status(409).json({ error: 'رقم الواتساب ده متضاف بالفعل في Inbox تاني' });
    }

    // التحقق الحقيقي — لو أي بيانات مش متطابقة مع بعض فعليًا عند ميتا، هيرمي Error وهنوقف هنا
    const verified = await verifyWhatsappCredentials({ phoneNumber, phoneNumberId, accessToken });

    const inbox = await createWhatsappInbox({
      name,
      phoneNumber,
      phoneNumberId,
      accessToken,
      verifiedName: verified.verifiedName,
      displayPhoneNumber: verified.displayPhoneNumber,
      createdBy: req.user.userId,
    });

    res.status(201).json({ ok: true, inbox });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// ===== قايمة الـ Inboxes (لعرضها في صفحة الإعدادات) =====
router.get('/api/inboxes', async (req, res) => {
  try {
    const inboxes = await listInboxes();
    res.json(inboxes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/api/inboxes/:id', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'status لازم يكون active أو inactive' });
    }
    const inbox = await updateInboxStatus(req.params.id, status);
    if (!inbox) return res.status(404).json({ error: 'الـ Inbox مش موجود' });
    res.json({ ok: true, inbox });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/inboxes/:id', requireAdmin, async (req, res) => {
  try {
    const deleted = await deleteInbox(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'الـ Inbox مش موجود' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ===== Step 3: Add Agents =====
router.get('/api/inboxes/:id/agents', async (req, res) => {
  try {
    const inbox = await getInboxById(req.params.id);
    if (!inbox) return res.status(404).json({ error: 'الـ Inbox مش موجود' });
    const agents = await getAgentsForInbox(req.params.id);
    res.json(agents);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/inboxes/:id/agents', requireAdmin, async (req, res) => {
  try {
    const { agentIds } = req.body;
    if (!Array.isArray(agentIds)) {
      return res.status(400).json({ error: 'لازم تبعت agentIds كـ array' });
    }
    const inbox = await getInboxById(req.params.id);
    if (!inbox) return res.status(404).json({ error: 'الـ Inbox مش موجود' });

    const agents = await setAgentsForInbox(req.params.id, agentIds);
    res.json({ ok: true, agents });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// بيستخدمها ويزارد الإضافة عشان يعرض قايمة الموظفين المتاحين للاختيار منها
router.get('/api/inboxes-available-agents', async (req, res) => {
  try {
    const users = await listUsers();
    res.json(users.filter((u) => u.status === 'active'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
