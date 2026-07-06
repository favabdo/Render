// controllers/inbox.controller.js
const inboxRepo = require('../repositories/inbox.repo');
const userRepo = require('../repositories/user.repo');
const whatsappService = require('../services/whatsapp.service');
const { PHONE_REGEX } = require('../utils/helpers');

// ===== قنوات الاتصال المتاحة (Step 1: Choose Channel) =====
// دلوقتي القناة الوحيدة اللي شغالة فعليًا وبتوصل رسايل لحظية حقيقية هي WhatsApp Cloud API
// (بروتوكول Webhook Push من ميتا + Socket.io بين السيرفر والداشبورد = زيرو تأخير عن الـ polling)
// باقي القنوات موجودة في الواجهة زي شات ووت بالظبط لحد ما نضيف الـ backend integration بتاعها
function listChannels(req, res) {
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
}

const PHONE_ERROR = 'رقم التليفون لازم يبدأ بعلامة + وميكونش فيه مسافات (مثال: +201001234567)';

// ===== Step 2 (جزء "Authenticate your account"): بنتأكد إن الأربعة بيانات دي بتاعة بعض فعلاً =====
// مش مجرد إن التوكن شغال — لازم الرقم يكون هو نفسه المسجل على الـ Phone Number ID ده،
// والـ Phone Number ID ده يكون تابع فعلاً للـ Business Account ID اللي كتبته
async function authenticateWhatsapp(req, res) {
  const { phoneNumber, phoneNumberId, accessToken } = req.body;

  if (!phoneNumber || !phoneNumberId || !accessToken) {
    return res.status(400).json({ error: 'لازم تملأ الرقم و Phone Number ID و API key التلاتة' });
  }
  if (!PHONE_REGEX.test(phoneNumber)) {
    return res.status(400).json({ error: PHONE_ERROR });
  }

  const existing = await inboxRepo.findInboxByPhoneNumberId(phoneNumberId);
  if (existing) {
    return res.status(409).json({ error: 'رقم الواتساب ده متضاف بالفعل في Inbox تاني' });
  }

  try {
    const verified = await whatsappService.verifyWhatsappCredentials({ phoneNumber, phoneNumberId, accessToken });
    res.json({ ok: true, ...verified });
  } catch (err) {
    err.status = err.status || 400;
    throw err;
  }
}

// ===== Step 2: Create Inbox =====
// بنعيد التحقق من الأربعة بيانات تاني هنا (مش بنصدق كلام العميل عن الـ verifiedName/displayPhoneNumber
// اللي بعته)، عشان محدش يقدر يتلاعب ويضيف Inbox ببيانات متطابقة شكليًا بس مش حقيقية
async function createInbox(req, res) {
  const { name, channelType = 'whatsapp', phoneNumber, phoneNumberId, accessToken } = req.body;

  if (channelType !== 'whatsapp') {
    return res.status(400).json({ error: 'القناة دي لسه متاحة في الواجهة بس، هتشتغل قريبًا' });
  }
  if (!name || !phoneNumberId || !accessToken || !phoneNumber) {
    return res.status(400).json({ error: 'لازم تبعت name و phoneNumber و phoneNumberId و accessToken' });
  }
  if (!PHONE_REGEX.test(phoneNumber)) {
    return res.status(400).json({ error: PHONE_ERROR });
  }

  const existing = await inboxRepo.findInboxByPhoneNumberId(phoneNumberId);
  if (existing) {
    return res.status(409).json({ error: 'رقم الواتساب ده متضاف بالفعل في Inbox تاني' });
  }

  // التحقق الحقيقي — لو أي بيانات مش متطابقة مع بعض فعليًا عند ميتا، هيرمي Error وهنوقف هنا
  let verified;
  try {
    verified = await whatsappService.verifyWhatsappCredentials({ phoneNumber, phoneNumberId, accessToken });
  } catch (err) {
    err.status = err.status || 400;
    throw err;
  }

  const inbox = await inboxRepo.createWhatsappInbox({
    name,
    phoneNumber,
    phoneNumberId,
    accessToken,
    verifiedName: verified.verifiedName,
    displayPhoneNumber: verified.displayPhoneNumber,
    createdBy: req.user.userId,
  });

  res.status(201).json({ ok: true, inbox });
}

// ===== قايمة الـ Inboxes (لعرضها في صفحة الإعدادات) =====
async function listInboxes(req, res) {
  const inboxes = await inboxRepo.listInboxes();
  res.json(inboxes);
}

async function updateInboxStatus(req, res) {
  const { status } = req.body;
  if (!['active', 'inactive'].includes(status)) {
    return res.status(400).json({ error: 'status لازم يكون active أو inactive' });
  }
  const inbox = await inboxRepo.updateInboxStatus(req.params.id, status);
  if (!inbox) return res.status(404).json({ error: 'الـ Inbox مش موجود' });
  res.json({ ok: true, inbox });
}

async function deleteInbox(req, res) {
  const deleted = await inboxRepo.deleteInbox(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'الـ Inbox مش موجود' });
  res.json({ ok: true });
}

// ===== Step 3: Add Agents =====
async function getInboxAgents(req, res) {
  const inbox = await inboxRepo.getInboxById(req.params.id);
  if (!inbox) return res.status(404).json({ error: 'الـ Inbox مش موجود' });
  const agents = await inboxRepo.getAgentsForInbox(req.params.id);
  res.json(agents);
}

async function setInboxAgents(req, res) {
  const { agentIds } = req.body;
  if (!Array.isArray(agentIds)) {
    return res.status(400).json({ error: 'لازم تبعت agentIds كـ array' });
  }
  const inbox = await inboxRepo.getInboxById(req.params.id);
  if (!inbox) return res.status(404).json({ error: 'الـ Inbox مش موجود' });

  const agents = await inboxRepo.setAgentsForInbox(req.params.id, agentIds);
  res.json({ ok: true, agents });
}

// بيستخدمها ويزارد الإضافة عشان يعرض قايمة الموظفين المتاحين للاختيار منها
async function listAvailableAgents(req, res) {
  const users = await userRepo.listUsers();
  res.json(users.filter((u) => u.status === 'active'));
}

module.exports = {
  listChannels,
  authenticateWhatsapp,
  createInbox,
  listInboxes,
  updateInboxStatus,
  deleteInbox,
  getInboxAgents,
  setInboxAgents,
  listAvailableAgents,
};
