// controllers/contact.controller.js
const contactRepo = require('../repositories/contact.repo');
const conversationRepo = require('../repositories/conversation.repo');
const contactService = require('../services/contact.service');
const webhookDispatchService = require('../services/webhookDispatch.service');
const userRepo = require('../repositories/user.repo');
const notificationService = require('../services/notification.service');
const logger = require('../utils/logger');

// بينضف قايمة الموديولات الجاية من الفرونت (كارت العميل): بيشيل الفاضي
// والمكرر، وبيحد أقصى عدد وطول لكل اسم عشان محدش يبعت حاجة غريبة تعطل الداتابيز
const MAX_MODULES_PER_CONTACT = 50;
function sanitizeModulesList(modules) {
  if (!Array.isArray(modules)) return [];
  const cleaned = modules
    .map((m) => (typeof m === 'string' ? m.trim() : ''))
    .filter(Boolean)
    .map((m) => m.slice(0, 300));
  return [...new Set(cleaned)].slice(0, MAX_MODULES_PER_CONTACT);
}

// كل الكونتاكتس الحقيقيين (لصفحة Contacts، وكمان لاختيار "اربط بكونتاكت موجود")
async function listContacts(req, res) {
  const contacts = await contactRepo.listContacts();
  res.json(contacts);
}

// نسخة بصفحات لشبكة العملاء في صفحة Contacts — أقصى حاجة 20 عميل في كل طلب،
// مع دعم البحث بالاسم أو رقم التليفون على مستوى السيرفر نفسه
async function listContactsPaginated(req, res) {
  const result = await contactRepo.listContactsPage({
    page: req.query.page,
    pageSize: req.query.pageSize,
    search: req.query.q,
    registered: req.query.registered, // 'yes' | 'no' | 'all' (تاب "عملاء مسجلين" / "لسه بس واتساب")
  });
  res.json(result);
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

  notificationService.logActivity(req, `غيّر اسم العميل إلى ${contact.name}`, contact.id);
}

// بيضيف رقم تليفون جديد لعميل موجود بالفعل (زرار "إضافة رقم" في صفحة تفاصيل
// العميل أو جوه المحادثة نفسها)
async function addPhone(req, res) {
  const { phone } = req.body || {};
  const trimmedPhone = (phone || '').trim();
  if (!trimmedPhone) return res.status(400).json({ error: 'لازم تبعت رقم التليفون' });

  const result = await contactRepo.addPhoneToContact(req.params.id, trimmedPhone);
  if (result.error === 'phone_taken') {
    return res.status(409).json({ error: 'الرقم ده مرتبط بعميل بالفعل' });
  }
  if (!result.contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

  const io = req.app.get('io');
  if (io) io.emit('contact_updated', result.contact);

  webhookDispatchService.dispatchEvent(webhookDispatchService.EVENT_TYPES.CONTACT_UPDATED, {
    contact_id: result.contact.id,
    name: result.contact.name,
  }).catch((err) => logger.error('❌ فشل إرسال Webhook contact_updated:', err.message));

  res.status(201).json({ ok: true, contact: result.contact });
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

// بتنضّف قايمة الفروع الجاية من الفورم: بتشيل أي فرع فاضي تمامًا (من غير اسم
// ولا مكان)، وبتقص المسافات الزيادة من اسم/مكان كل فرع
function sanitizeBranchesList(branches) {
  if (!Array.isArray(branches)) return undefined;
  return branches
    .map((b) => ({
      name: String(b?.name || '').trim() || null,
      location: String(b?.location || '').trim() || null,
    }))
    .filter((b) => b.name || b.location);
}

// إضافة "كارت عميل صيانة" جديد (زرار Add Contact في صفحة Contacts) — أدمن بس
// (متأكد منها فعليًا في الراوت بـ requireAdmin). بيطلب: اسم العميل، مكانه، رقم
// تليفونه، وممكن اختياريًا تاريخ بدء/انتهاء أول عقد صيانة ليه (لو مش عايز يحددها
// دلوقتي، يقدر يضيفها بعدين من زرار "إضافة عقد صيانة" في صفحة تفاصيل العميل)
async function createCustomerCard(req, res) {
  const { name, location, branches, phone, contractDate, maintenanceEndDate, signedContractDate, managerName, managerPhone, modules } = req.body || {};

  const trimmedName = (name || '').trim();
  const trimmedPhone = (phone || '').trim();
  if (!trimmedName) return res.status(400).json({ error: 'لازم تكتب اسم الشركة' });
  if (!trimmedPhone) return res.status(400).json({ error: 'لازم تكتب رقم تليفون العميل' });
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
    branches: sanitizeBranchesList(branches),
    signedContractDate: signedContractDate || null,
    managerName: (managerName || '').trim() || null,
    managerPhone: (managerPhone || '').trim() || null,
    contractDate: contractDate || null,
    maintenanceEndDate: maintenanceEndDate || null,
    modules: sanitizeModulesList(modules),
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

  notificationService.logActivity(req, `أضاف عميل جديد باسم "${contact.name}"`, contact.id);
}

// تعديل بيانات كارت عميل الصيانة (زرار Edit في صفحة التفاصيل) — أدمن بس.
// الاسم والمكان بس؛ عقود الصيانة بقت بتتضاف من سجل الصيانة نفسه (شوف
// maintenanceContract.controller.js)
async function updateCustomerCard(req, res) {
  const { name, location, branches, signedContractDate, managerName, managerPhone, modules } = req.body || {};

  const trimmedName = (name || '').trim();
  if (!trimmedName) return res.status(400).json({ error: 'لازم تكتب اسم الشركة' });

  const contact = await contactRepo.updateCustomerDetails(req.params.id, {
    name: trimmedName,
    location: (location || '').trim() || null,
    branches: sanitizeBranchesList(branches),
    signedContractDate: signedContractDate || null,
    managerName: (managerName || '').trim() || null,
    managerPhone: (managerPhone || '').trim() || null,
    modules: sanitizeModulesList(modules),
  });
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

  const io = req.app.get('io');
  if (io) io.emit('contact_updated', contact);

  webhookDispatchService.dispatchEvent(webhookDispatchService.EVENT_TYPES.CONTACT_UPDATED, {
    contact_id: contact.id,
    name: contact.name,
  }).catch((err) => logger.error('❌ فشل إرسال Webhook contact_updated:', err.message));

  res.json({ ok: true, contact });

  notificationService.logActivity(req, `عدّل معلومات العميل "${contact.name}"`, contact.id);
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

// "مسح" عميل (Soft Delete): بيحول status بتاعه لـ 0 بس، فبيختفي من صفحة
// Contacts ومن قايمة "اربط بكونتاكت موجود" — لكن بياناته كلها (المحادثات،
// الرسايل، الأجهزة، التاسكات، الزيارات، عقود الصيانة...) فاضلة زي ما هي في
// الداتابيز، مش بتتمسح. أدمن بس (متأكد منها في الراوت بـ requireAdmin)، وكمان
// لازم يأكد بكلمة سره الشخصية (مش كلمة سر حد تاني) زي بالظبط منطق مسح الإيجنت
// في auth.controller.deleteUserAccount
async function deleteContact(req, res) {
  const { password } = req.body || {};

  if (!password) {
    return res.status(400).json({ error: 'لازم تأكد بكلمة سرك الشخصية عشان تمسح العميل ده' });
  }

  const contact = await contactRepo.getContactByIdWithPhones(req.params.id);
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

  const actingUser = await userRepo.findUserByEmail(req.user.email);
  if (!actingUser) {
    return res.status(401).json({ error: 'الجلسة غير صالحة، سجل دخول تاني' });
  }

  const validPassword = await userRepo.verifyPassword(password, actingUser.password);
  if (!validPassword) {
    return res.status(401).json({ error: 'كلمة السر غلط' });
  }

  const deleted = await contactRepo.softDeleteContact(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'العميل مش موجود أو تم مسحه بالفعل' });
  }

  const io = req.app.get('io');
  if (io) io.emit('contact_deleted', { id: deleted.id });

  webhookDispatchService.dispatchEvent(webhookDispatchService.EVENT_TYPES.CONTACT_DELETED, {
    contact_id: deleted.id,
    name: deleted.name,
  }).catch((err) => logger.error('❌ فشل إرسال Webhook contact_deleted:', err.message));

  res.json({ ok: true });

  notificationService.logActivity(req, `مسح العميل ${deleted.name} (اتخفى من القايمة، بياناته لسه محفوظة)`, deleted.id);
}

module.exports = {
  listContacts,
  listContactsPaginated,
  getContact,
  getContactConversations,
  updateContact,
  addPhone,
  updatePhoneLabel,
  linkConversationContact,
  unlinkPhone,
  createCustomerCard,
  updateCustomerCard,
  deleteContact,
};
