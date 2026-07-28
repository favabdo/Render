const express = require('express');
const router = express.Router();
const { requireAuth } = require('./authRoutes');
const {
  listContacts,
  getContactByIdWithPhones,
  updateContactName,
  linkPhoneToContact,
  createContactWithPhone,
  findContactByPhone,
  deletePhonelessContact,
} = require('./contactsRepo');
const { getConversationById, setConversationContact } = require('./conversationsRepo');

router.use(requireAuth);

// كل الكونتاكتس الحقيقيين (لصفحة Contacts، وكمان لاختيار "اربط بكونتاكت موجود")
router.get('/api/contacts', async (req, res) => {
  try {
    const contacts = await listContacts();
    res.json(contacts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/contacts/:id', async (req, res) => {
  try {
    const contact = await getContactByIdWithPhones(req.params.id);
    if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });
    res.json(contact);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// تعديل اسم العميل (بدل ما يفضل اسم واتساب الخام أو رقم التليفون)
router.patch('/api/contacts/:id', async (req, res) => {
  try {
    const { name } = req.body || {};
    const trimmed = (name || '').trim();
    if (!trimmed) return res.status(400).json({ error: 'لازم تكتب اسم' });
    if (trimmed.length > 200) return res.status(400).json({ error: 'الاسم طويل أوي' });

    const contact = await updateContactName(req.params.id, trimmed);
    if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

    const io = req.app.get('io');
    if (io) io.emit('contact_updated', contact);

    res.json({ ok: true, contact });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// بيربط رقم المحادثة دي بكونتاكت موجود بالفعل (دمج) — أو ينشئ كونتاكت جديد منفصل بيه
// body: { mode: 'link', contactId } أو { mode: 'new', name }
router.post('/api/conversations/:id/contact', async (req, res) => {
  try {
    const { mode, contactId, name } = req.body || {};
    const conversation = await getConversationById(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'المحادثة مش موجودة' });

    let targetContact;

    if (mode === 'link') {
      if (!contactId) return res.status(400).json({ error: 'لازم تحدد الكونتاكت اللي هتربط بيه' });
      targetContact = await getContactByIdWithPhones(contactId);
      if (!targetContact) return res.status(404).json({ error: 'الكونتاكت المطلوب مش موجود' });

      const sourceContact = await findContactByPhone(conversation.contact_number);
      await linkPhoneToContact(conversation.contact_number, contactId);

      // لو الكونتاكت القديم بقى من غير أرقام خالص بعد النقل، امسحه عشان مايفضلش فاضي
      if (sourceContact && String(sourceContact.id) !== String(contactId)) {
        await deletePhonelessContact(sourceContact.id).catch((err) => {
          console.error('❌ خطأ أثناء تنظيف الكونتاكت الفاضي:', err.message);
        });
      }
    } else if (mode === 'new') {
      const trimmed = (name || '').trim();
      if (!trimmed) return res.status(400).json({ error: 'لازم تكتب اسم للكونتاكت الجديد' });
      targetContact = await createContactWithPhone(trimmed, conversation.contact_number);
    } else {
      return res.status(400).json({ error: "الـ mode لازم يكون 'link' أو 'new'" });
    }

    await setConversationContact(conversation.id, targetContact.id);

    const updated = await getConversationById(req.params.id);
    const io = req.app.get('io');
    if (io) io.emit('conversation_updated', updated);

    res.json({ ok: true, conversation: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
