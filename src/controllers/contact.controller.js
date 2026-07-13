// controllers/contact.controller.js
const contactRepo = require('../repositories/contact.repo');
const conversationRepo = require('../repositories/conversation.repo');
const contactService = require('../services/contact.service');
const webhookDispatchService = require('../services/webhookDispatch.service');
const userRepo = require('../repositories/user.repo');
const logger = require('../utils/logger');

// كل الكونتاكتس الحقيقيين (لصفحة Contacts، وكمان لاختيار "اربط بكونتاكت موجود")
async function listContacts(req, res) {
  const contacts = await contactRepo.listContacts();
  res.json(contacts);
}

async function getContact(req, res) {
  const contact = await contactRepo.getContactByIdWithPhones(req.params.id);
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });
  res.json(contact);
}

// كل المحادثات السابقة لنفس الكونتاكت (حتى لو من أرقام مختلفة مرتبطة بيه)،
// بتتعرض في لوحة العميل تحت "Previous Conversations"
async function getContactConversations(req, res) {
  const excludeId = req.query.exclude || null;
  const conversations = await conversationRepo.getConversationsForContact(req.params.id, excludeId);
  res.json(conversations);
}

// تعديل اسم العميل (بدل ما يفضل اسم واتساب الخام أو رقم التليفون)
async function updateContact(req, res) {
  const { name } = req.body || {};
  const trimmed = (name || '').trim();
  if (!trimmed) return res.status(400).json({ error: 'لازم تكتب اسم' });
  if (trimmed.length > 200) return res.status(400).json({ error: 'الاسم طويل أوي' });

  const contact = await contactRepo.updateContactName(req.params.id, trimmed);
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

  const io = req.app.get('io');
  if (io) io.emit('contact_updated', contact);

  webhookDispatchService.dispatchEvent(webhookDispatchService.EVENT_TYPES.CONTACT_UPDATED, {
    contact_id: contact.id,
    name: contact.name,
  }).catch((err) => logger.error('❌ فشل إرسال Webhook contact_updated:', err.message));

  res.json({ ok: true, contact });
}

// بنحط/بنعدّل ليبل على رقم معين بتاع الكونتاكت ده (مفيد لو عنده أكتر من رقم واحد،
// مثلاً "الشغل" أو "الرقم الشخصي") — الرقم برضه بيفضل تحت نفس اسم العميل
async function updatePhoneLabel(req, res) {
  const { phone, label } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'لازم تبعت رقم التليفون' });
  if (label && label.length > 100) return res.status(400).json({ error: 'اسم الليبل طويل أوي' });

  const updated = await contactRepo.updatePhoneLabel(req.params.id, phone, label);
  if (!updated) return res.status(404).json({ error: 'الرقم ده مش مرتبط بالكونتاكت ده' });

  const contact = await contactRepo.getContactByIdWithPhones(req.params.id);
  const io = req.app.get('io');
  if (io) io.emit('contact_updated', contact);

  webhookDispatchService.dispatchEvent(webhookDispatchService.EVENT_TYPES.CONTACT_UPDATED, {
    contact_id: contact.id,
    name: contact.name,
  }).catch((err) => logger.error('❌ فشل إرسال Webhook contact_updated:', err.message));

  res.json({ ok: true, contact });
}

// بيربط رقم المحادثة دي بكونتاكت موجود بالفعل (دمج) — أو ينشئ كونتاكت جديد منفصل بيه
// body: { mode: 'link', contactId } أو { mode: 'new', name }
async function linkConversationContact(req, res) {
  const { mode, contactId, name } = req.body || {};
  const conversation = await conversationRepo.getConversationById(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'المحادثة مش موجودة' });

  await contactService.linkContactToConversation(conversation, { mode, contactId, name });

  const updated = await conversationRepo.getConversationById(req.params.id);
  const io = req.app.get('io');
  if (io) io.emit('conversation_updated', updated);

  webhookDispatchService.dispatchEvent(webhookDispatchService.EVENT_TYPES.CONVERSATION_UPDATED, {
    conversation_id: updated.id,
    contact_id: updated.contact_id || null,
  }).catch((err) => logger.error('❌ فشل إرسال Webhook conversation_updated:', err.message));

  res.json({ ok: true, conversation: updated });
}

// إضافة "كارت عميل صيانة" جديد (زرار Add Contact في صفحة Contacts) — أدمن بس
// (متأكد منها فعليًا في الراوت بـ requireAdmin). بيطلب: اسم العميل، مكانه، رقم
// تليفونه، وممكن اختياريًا تاريخ بدء/انتهاء أول عقد صيانة ليه (لو مش عايز يحددها
// دلوقتي، يقدر يضيفها بعدين من زرار "إضافة عقد صيانة" في صفحة تفاصيل العميل)
// نفس الصيغة اللي بنفرضها في الفرونت إند: كود مصر الدولي (20) وبعده رقم
// الموبايل من غير الصفر اللي في الأول، يعني 12 رقم بالظبط (مثال: 201010293696)
const EGYPT_PHONE_REGEX = /^201[0125]\d{8}$/;

async function createCustomerCard(req, res) {
  const { name, location, phone, contractDate, maintenanceEndDate } = req.body || {};

  const trimmedName = (name || '').trim();
  const trimmedPhone = (phone || '').trim();
  if (!trimmedName) return res.status(400).json({ error: 'لازم تكتب اسم العميل' });
  if (!trimmedPhone) return res.status(400).json({ error: 'لازم تكتب رقم تليفون العميل' });
  if (!EGYPT_PHONE_REGEX.test(trimmedPhone)) {
    return res.status(400).json({ error: 'رقم التليفون لازم يكون بالصيغة الدولية بدون + وبدون مسافات، مثال: 201010293696' });
  }
  if ((contractDate && !maintenanceEndDate) || (!contractDate && maintenanceEndDate)) {
    return res.status(400).json({ error: 'لو هتحدد عقد صيانة، لازم تحدد تاريخ البدء والانتهاء مع بعض' });
  }
  if (contractDate && maintenanceEndDate && new Date(maintenanceEndDate) < new Date(contractDate)) {
    return res.status(400).json({ error: 'تاريخ انتهاء العقد لازم يكون بعد تاريخ البدء' });
  }

  const existing = await contactRepo.findContactByPhone(trimmedPhone);
  if (existing) {
    return res.status(409).json({ error: 'الرقم ده مسجل بالفعل لعميل موجود' });
  }

  const agent = await userRepo.findUserById(req.user.userId);
  const agentName = agent ? userRepo.resolveDisplayName(agent) : (req.user.email || 'Unknown');

  const contact = await contactRepo.createCustomerContact({
    name: trimmedName,
    phoneNumber: trimmedPhone,
    location: (location || '').trim() || null,
    contractDate: contractDate || null,
    maintenanceEndDate: maintenanceEndDate || null,
    createdBy: req.user.userId,
    createdByName: agentName,
  });

  const io = req.app.get('io');
  if (io) io.emit('contact_created', contact);

  webhookDispatchService.dispatchEvent(webhookDispatchService.EVENT_TYPES.CONTACT_CREATED, {
    contact_id: contact.id,
    name: contact.name,
    phone: trimmedPhone,
  }).catch((err) => logger.error('❌ فشل إرسال Webhook contact_created:', err.message));

  res.status(201).json({ ok: true, contact });
}

// تعديل بيانات كارت عميل الصيانة (زرار Edit في صفحة التفاصيل) — أدمن بس.
// الاسم والمكان بس؛ عقود الصيانة بقت بتتضاف من سجل الصيانة نفسه (شوف
// maintenanceContract.controller.js)
async function updateCustomerCard(req, res) {
  const { name, location } = req.body || {};

  const trimmedName = (name || '').trim();
  if (!trimmedName) return res.status(400).json({ error: 'لازم تكتب اسم العميل' });

  const contact = await contactRepo.updateCustomerDetails(req.params.id, {
    name: trimmedName,
    location: (location || '').trim() || null,
  });
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

  const io = req.app.get('io');
  if (io) io.emit('contact_updated', contact);

  webhookDispatchService.dispatchEvent(webhookDispatchService.EVENT_TYPES.CONTACT_UPDATED, {
    contact_id: contact.id,
    name: contact.name,
  }).catch((err) => logger.error('❌ فشل إرسال Webhook contact_updated:', err.message));

  res.json({ ok: true, contact });
}

// بيفصل رقم تليفون من كونتاكت عنده أكتر من رقم، وبينشئ كونتاكت جديد منفصل بيه —
// عكس linkConversationContact (اللي بيدمج). متاح لكل الصلاحيات زي الدمج بالظبط
async function unlinkPhone(req, res) {
  const { phone, name } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'لازم تبعت رقم التليفون' });

  const newContact = await contactService.unlinkContactPhone(req.params.id, phone, name);
  const updatedOldContact = await contactRepo.getContactByIdWithPhones(req.params.id);

  const io = req.app.get('io');
  if (io) {
    io.emit('contact_created', newContact);
    if (updatedOldContact) io.emit('contact_updated', updatedOldContact);
  }

  res.status(201).json({ ok: true, contact: newContact, oldContact: updatedOldContact });
}

// بيضيف رقم تليفون جديد لكونتاكت موجود (من صفحة تفاصيل العميل أو من تاب Info
// في المحادثة) — من غير ما يحتاج ميرج، ومن غير ما يحتاج الرقم يبعت رسالة واتساب
// الأول. متاح لكل الصلاحيات زي فصل/دمج الأرقام بالظبط
async function addPhone(req, res) {
  const { phone } = req.body || {};
  const trimmedPhone = (phone || '').trim();
  if (!trimmedPhone) return res.status(400).json({ error: 'لازم تكتب رقم التليفون' });
  if (!EGYPT_PHONE_REGEX.test(trimmedPhone)) {
    return res.status(400).json({ error: 'رقم التليفون لازم يكون بالصيغة الدولية بدون + وبدون مسافات، مثال: 201010293696' });
  }

  const contact = await contactRepo.getContactById(req.params.id);
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

  const existing = await contactRepo.findContactByPhone(trimmedPhone);
  if (existing) {
    return res.status(409).json({
      error: String(existing.id) === String(contact.id)
        ? 'الرقم ده متسجل بالفعل على نفس العميل'
        : 'الرقم ده متسجل بالفعل لعميل تاني — استخدم زرار الدمج لو عايز تربطه بالعميل ده',
    });
  }

  const updated = await contactRepo.addPhoneToContact(req.params.id, trimmedPhone);

  const io = req.app.get('io');
  if (io) io.emit('contact_updated', updated);

  webhookDispatchService.dispatchEvent(webhookDispatchService.EVENT_TYPES.CONTACT_UPDATED, {
    contact_id: updated.id,
    name: updated.name,
  }).catch((err) => logger.error('❌ فشل إرسال Webhook contact_updated:', err.message));

  res.status(201).json({ ok: true, contact: updated });
}

module.exports = {
  listContacts,
  getContact,
  getContactConversations,
  updateContact,
  updatePhoneLabel,
  addPhone,
  linkConversationContact,
  unlinkPhone,
  createCustomerCard,
  updateCustomerCard,
};
