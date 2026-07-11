// controllers/contact.controller.js
const contactRepo = require('../repositories/contact.repo');
const conversationRepo = require('../repositories/conversation.repo');
const contactService = require('../services/contact.service');
const webhookDispatchService = require('../services/webhookDispatch.service');
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

module.exports = { listContacts, getContact, getContactConversations, updateContact, updatePhoneLabel, linkConversationContact };
