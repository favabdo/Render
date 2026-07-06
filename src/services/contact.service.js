// services/contact.service.js
// منطق الكونتاكتس اللي مش مجرد استعلام DB مباشر: إيجاد/إنشاء تلقائي، ودمج/ربط الأرقام

const contactRepo = require('../repositories/contact.repo');
const conversationRepo = require('../repositories/conversation.repo');
const logger = require('../utils/logger');

// بيدور على الكونتاكت الحقيقي بتاع الرقم ده، ولو مش موجود بينشئه تلقائيًا باسمه اللي ظاهر
// على واتساب (الإيجنت يقدر يغيّره بعدين براحته). بتُستخدم لما رسالة واتساب جديدة توصل.
async function findOrCreateContactForIncoming(phoneNumber, waProfileName) {
  try {
    let contact = await contactRepo.findContactByPhone(phoneNumber);
    if (!contact) {
      contact = await contactRepo.createContactWithPhone(waProfileName || phoneNumber, phoneNumber);
    }
    return contact;
  } catch (err) {
    logger.error('❌ خطأ أثناء إيجاد/إنشاء الكونتاكت:', err.message);
    return null;
  }
}

// بيربط رقم المحادثة دي بكونتاكت موجود بالفعل (دمج) — أو ينشئ كونتاكت جديد منفصل بيه
// mode: 'link' (لازم contactId) أو 'new' (لازم name)
async function linkContactToConversation(conversation, { mode, contactId, name }) {
  let targetContact;

  if (mode === 'link') {
    if (!contactId) {
      const err = new Error('لازم تحدد الكونتاكت اللي هتربط بيه');
      err.status = 400;
      throw err;
    }
    targetContact = await contactRepo.getContactByIdWithPhones(contactId);
    if (!targetContact) {
      const err = new Error('الكونتاكت المطلوب مش موجود');
      err.status = 404;
      throw err;
    }

    const sourceContact = await contactRepo.findContactByPhone(conversation.contact_number);
    await contactRepo.linkPhoneToContact(conversation.contact_number, contactId);

    // لو الكونتاكت القديم بقى من غير أرقام خالص بعد النقل، امسحه عشان مايفضلش فاضي
    if (sourceContact && String(sourceContact.id) !== String(contactId)) {
      await contactRepo.deletePhonelessContact(sourceContact.id).catch((err) => {
        logger.error('❌ خطأ أثناء تنظيف الكونتاكت الفاضي:', err.message);
      });
    }
  } else if (mode === 'new') {
    const trimmed = (name || '').trim();
    if (!trimmed) {
      const err = new Error('لازم تكتب اسم للكونتاكت الجديد');
      err.status = 400;
      throw err;
    }
    targetContact = await contactRepo.createContactWithPhone(trimmed, conversation.contact_number);
  } else {
    const err = new Error("الـ mode لازم يكون 'link' أو 'new'");
    err.status = 400;
    throw err;
  }

  await conversationRepo.setConversationContact(conversation.id, targetContact.id);
  return targetContact;
}

module.exports = { findOrCreateContactForIncoming, linkContactToConversation };
