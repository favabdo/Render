// services/contact.service.js
// منطق الكونتاكتس اللي مش مجرد استعلام DB مباشر: إيجاد/إنشاء تلقائي، ودمج/ربط الأرقام

const contactRepo = require('../repositories/contact.repo');
const conversationRepo = require('../repositories/conversation.repo');
const externalContactRepo = require('../repositories/externalContact.repo');
const webhookDispatchService = require('./webhookDispatch.service');
const logger = require('../utils/logger');

// لو الكونتاكت القديم (اللي هيتشال بعد الدمج) كان أصلًا مربوط (ميرج) بصف
// External_Contacts_byA (كونتاكت جاي من شات ووت مثلًا)، لازم الصف ده يتبع
// الكونتاكت الجديد بعد الدمج بدل ما يفضل واقف على كونتاكت هيتمسح بعد شوية
async function reassignExternalLinksAfterMerge(sourceContactId, targetContactId) {
  try {
    const linkedRows = await externalContactRepo.findByNileContactId(sourceContactId);
    for (const row of linkedRows) {
      await externalContactRepo.mergeContactToNileContact(row.id, targetContactId);
    }
  } catch (err) {
    logger.error('❌ فشل نقل ربط الكونتاكت الخارجي بعد الدمج:', err.message);
  }
}

// بيدور على الكونتاكت الحقيقي بتاع الرقم ده، ولو مش موجود بينشئه تلقائيًا باسمه اللي ظاهر
// على واتساب (الإيجنت يقدر يغيّره بعدين براحته). بتُستخدم لما رسالة واتساب جديدة توصل.
async function findOrCreateContactForIncoming(phoneNumber, waProfileName, companyId = null) {
  try {
    let contact = await contactRepo.findContactByPhone(phoneNumber);
    if (!contact) {
      contact = await contactRepo.createContactWithPhone(waProfileName || phoneNumber, phoneNumber, companyId);
      if (contact) {
        webhookDispatchService.dispatchEvent(webhookDispatchService.EVENT_TYPES.CONTACT_CREATED, {
          contact_id: contact.id,
          name: contact.name,
          phone: phoneNumber,
        }).catch((err) => logger.error('❌ فشل إرسال Webhook contact_created:', err.message));
      }
    }
    return contact;
  } catch (err) {
    logger.error('❌ خطأ أثناء إيجاد/إنشاء الكونتاكت:', err.message);
    return null;
  }
}

// بيربط رقم المحادثة دي بكونتاكت موجود بالفعل (دمج) — أو ينشئ كونتاكت جديد منفصل بيه
// mode: 'link' (لازم contactId) أو 'new' (لازم name)
async function linkContactToConversation(conversation, { mode, contactId, name }, companyId = null) {
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
      // قبل المسح: أي صف External_Contacts_byA مرتبط بالكونتاكت القديم ده
      // (ميرج سابق من شات ووت مثلًا) لازم يتبع الكونتاكت الجديد بدل القديم
      await reassignExternalLinksAfterMerge(sourceContact.id, contactId);

      await contactRepo.deletePhonelessContact(sourceContact.id).catch((err) => {
        logger.error('❌ خطأ أثناء تنظيف الكونتاكت الفاضي:', err.message);
      });
    }

    webhookDispatchService.dispatchEvent(webhookDispatchService.EVENT_TYPES.CONTACT_UPDATED, {
      contact_id: targetContact.id,
      name: targetContact.name,
      linked_phone: conversation.contact_number,
    }).catch((err) => logger.error('❌ فشل إرسال Webhook contact_updated:', err.message));
  } else if (mode === 'new') {
    const trimmed = (name || '').trim();
    if (!trimmed) {
      const err = new Error('لازم تكتب اسم للكونتاكت الجديد');
      err.status = 400;
      throw err;
    }
    targetContact = await contactRepo.createContactWithPhone(trimmed, conversation.contact_number, companyId);

    webhookDispatchService.dispatchEvent(webhookDispatchService.EVENT_TYPES.CONTACT_CREATED, {
      contact_id: targetContact.id,
      name: targetContact.name,
      phone: conversation.contact_number,
    }).catch((err) => logger.error('❌ فشل إرسال Webhook contact_created:', err.message));
  } else {
    const err = new Error("الـ mode لازم يكون 'link' أو 'new'");
    err.status = 400;
    throw err;
  }

  await conversationRepo.setConversationContact(conversation.id, targetContact.id);
  return targetContact;
}

// دمج كونتاكت كامل (كل أرقامه ومحادثاته) جوه كونتاكت تاني — عكس بالظبط
// linkContactToConversation اللي بيدمج رقم واحد بس. هنا بيتنقل كل رقم تابع
// للـ sourceContactId لحساب targetContactId (نفس منطق linkPhoneToContact بس
// لكل الأرقام مش رقم واحد)، وكل المحادثات (المفتوحة والمقفولة/التاريخية)
// المرتبطة بالأرقام دي بتتبع الكونتاكت الجديد كمان، وفي الآخر الكونتاكت
// القديم (اللي بقى من غير أرقام) بيتمسح. المفروض تُستخدم من كارت العميل نفسه
// (مش من جوه محادثة)، فمنطقيًا الاتجاه هنا هو "دمج العميل ده في عميل تاني"
async function mergeContactIntoContact(sourceContactId, targetContactId) {
  if (String(sourceContactId) === String(targetContactId)) {
    const err = new Error('مينفعش تدمج العميل في نفسه');
    err.status = 400;
    throw err;
  }

  const [sourceContact, targetContact] = await Promise.all([
    contactRepo.getContactByIdWithPhones(sourceContactId),
    contactRepo.getContactByIdWithPhones(targetContactId),
  ]);
  if (!sourceContact) {
    const err = new Error('العميل المطلوب دمجه مش موجود');
    err.status = 404;
    throw err;
  }
  if (!targetContact) {
    const err = new Error('العميل المستهدف بالدمج مش موجود');
    err.status = 404;
    throw err;
  }

  const phones = sourceContact.phones || [];
  if (phones.length === 0) {
    const err = new Error('العميل ده معندوش أي رقم يتدمج بيه');
    err.status = 400;
    throw err;
  }

  for (const p of phones) {
    await contactRepo.linkPhoneToContact(p.phone_number, targetContactId);
    // كل المحادثات (المفتوحة والتاريخية) بتاعة الرقم ده لازم تتبع الكونتاكت
    // الجديد فورًا، مش بس المحادثة المفتوحة دلوقتي
    await conversationRepo.reassignConversationsContactByNumber(p.phone_number, targetContactId);
  }

  // أي صف External_Contacts_byA مرتبط بالكونتاكت القديم (ميرج سابق من شات
  // ووت مثلًا) لازم يتبع الكونتاكت الجديد بدل القديم
  await reassignExternalLinksAfterMerge(sourceContactId, targetContactId);

  await contactRepo.deletePhonelessContact(sourceContactId).catch((err) => {
    logger.error('❌ خطأ أثناء تنظيف الكونتاكت الفاضي بعد دمج العميل:', err.message);
  });

  webhookDispatchService.dispatchEvent(webhookDispatchService.EVENT_TYPES.CONTACT_UPDATED, {
    contact_id: targetContactId,
    name: targetContact.name,
    merged_from_contact_id: sourceContactId,
  }).catch((err) => logger.error('❌ فشل إرسال Webhook contact_updated:', err.message));

  return contactRepo.getContactByIdWithPhones(targetContactId);
}

// بيفصل رقم تليفون من كونتاكت عنده أكتر من رقم، وينشئ كونتاكت جديد منفصل بيه
// (بنفس الاسم افتراضيًا أو باسم تاني لو اتبعت)، وبينقل كل المحادثات القديمة
// بتاعة الرقم ده تتبع الكونتاكت الجديد بدل القديم
async function unlinkContactPhone(contactId, phoneNumber, newName) {
  const phones = await contactRepo.getPhonesForContact(contactId);
  if (phones.length <= 1) {
    const err = new Error('العميل ده رقم واحد بس، مينفعش تفصله');
    err.status = 400;
    throw err;
  }
  const belongsToThisContact = phones.some((p) => p.phone_number === phoneNumber);
  if (!belongsToThisContact) {
    const err = new Error('الرقم ده مش تابع للعميل ده');
    err.status = 404;
    throw err;
  }

  const newContact = await contactRepo.unlinkPhoneToNewContact(contactId, phoneNumber, newName);
  if (!newContact) {
    const err = new Error('تعذر فصل الرقم');
    err.status = 500;
    throw err;
  }

  await conversationRepo.reassignConversationsContactByNumber(phoneNumber, newContact.id);

  webhookDispatchService.dispatchEvent(webhookDispatchService.EVENT_TYPES.CONTACT_CREATED, {
    contact_id: newContact.id,
    name: newContact.name,
    phone: phoneNumber,
  }).catch((err) => logger.error('❌ فشل إرسال Webhook contact_created:', err.message));

  return newContact;
}

module.exports = { findOrCreateContactForIncoming, linkContactToConversation, mergeContactIntoContact, unlinkContactPhone };
