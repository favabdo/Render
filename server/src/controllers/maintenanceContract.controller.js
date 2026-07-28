// controllers/maintenanceContract.controller.js
// قسم "سجل الصيانة" (Maintenance History): سجل كامل بكل عقود الصيانة اللي اتعملت
// لعميل معين عبر الوقت (مش عقد واحد بس بيتجدد). عرض السجل متاح لكل الصلاحيات
// (زي الزيارات)، لكن إضافة عقد جديد مقصورة على الأدمن/الأونر بس (متأكد منها
// فعليًا في الراوت بـ requireAdmin) — نفس صلاحية إضافة/تعديل كارت عميل الصيانة.
const maintenanceContractRepo = require('../repositories/maintenanceContract.repo');
const contactRepo = require('../repositories/contact.repo');
const userRepo = require('../repositories/user.repo');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// كل عقود الصيانة الخاصة بعميل معين — بتتعرض في صفحة تفاصيل العميل تحت
// "سجل الصيانة"، جمب سيكشن الزيارات بالظبط
async function listContractsForContact(req, res) {
  const [contact, contracts] = await Promise.all([
    contactRepo.getContactById(req.params.contactId),
    maintenanceContractRepo.listContractsForContact(req.params.contactId),
  ]);
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });
  res.json(contracts);
}

// إضافة عقد صيانة جديد للعميل (تجديد كامل بتاريخ بدء ونهاية جديدين، حتى لو عقده
// القديم لسه ساري أو لو خلص من مدة) — أدمن/أونر بس
async function addContractForContact(req, res) {
  // الاستعلامين مستقلين تمامًا عن بعض — بنجيبهم مع بعض، وترتيب التحقق (وجود
  // الكونتاكت الأول، بعدين صحة التواريخ) فاضل زي ما هو بالظبط تحت
  const [contact, agent] = await Promise.all([
    contactRepo.getContactById(req.params.contactId),
    userRepo.findUserById(req.user.userId),
  ]);
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

  const { startDate, endDate, notes } = req.body || {};
  if (!startDate) throw httpError(400, 'لازم تحدد تاريخ بدء العقد');
  if (!endDate) throw httpError(400, 'لازم تحدد تاريخ انتهاء العقد');
  if (new Date(endDate) < new Date(startDate)) {
    throw httpError(400, 'تاريخ انتهاء العقد لازم يكون بعد تاريخ البدء');
  }

  const trimmedNotes = (notes || '').trim();
  if (trimmedNotes.length > 500) throw httpError(400, 'الملاحظة طويلة أوي');

  const agentName = agent ? userRepo.resolveDisplayName(agent) : (req.user.email || 'Unknown');

  const contract = await maintenanceContractRepo.addContract({
    contactId: req.params.contactId,
    startDate,
    endDate,
    notes: trimmedNotes || null,
    createdBy: req.user.userId,
    createdByName: agentName,
  });

  // العقد الجديد ده ممكن يبقى هو "العقد الحالي" الجديد (لو تاريخه يخليه الساري
  // أو الأحدث)، فبنبعت الكونتاكت المحدّث كامل عشان أي حد فاتح صفحة التفاصيل
  // بتاعته يحدّث الإحصائيات الظاهرة برة فورًا
  const updatedContact = await contactRepo.getContactByIdWithPhones(req.params.contactId);

  const io = req.app.get('io');
  if (io) {
    io.emit('maintenance_contract_added', { contactId: req.params.contactId, contract });
    if (updatedContact) io.emit('contact_updated', updatedContact);
  }

  res.status(201).json({ ok: true, contract, contact: updatedContact });
}

// إيقاف عقد صيانة (بيفضل في السجل بس ملوش تأثير على إحصائيات "العميل الحالي" -
// أدمن/أونر بس، نفس صلاحية الإضافة
async function stopContractForContact(req, res) {
  const [contact, agent] = await Promise.all([
    contactRepo.getContactById(req.params.contactId),
    userRepo.findUserById(req.user.userId),
  ]);
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

  const agentName = agent ? userRepo.resolveDisplayName(agent) : req.user.email || 'Unknown';

  const contract = await maintenanceContractRepo.stopContract(req.params.contractId, {
    stoppedBy: req.user.userId,
    stoppedByName: agentName,
  });
  if (!contract) throw httpError(404, 'العقد ده مش موجود أو متوقف بالفعل');

  const updatedContact = await contactRepo.getContactByIdWithPhones(req.params.contactId);
  const io = req.app.get('io');
  if (io) {
    io.emit('maintenance_contract_stopped', { contactId: req.params.contactId, contract });
    if (updatedContact) io.emit('contact_updated', updatedContact);
  }

  res.json({ ok: true, contract, contact: updatedContact });
}

// مسح عقد صيانة نهائيًا من السجل — أدمن/أونر بس
async function deleteContractForContact(req, res) {
  const contact = await contactRepo.getContactById(req.params.contactId);
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

  const deleted = await maintenanceContractRepo.deleteContract(req.params.contractId);
  if (!deleted) throw httpError(404, 'العقد ده مش موجود');

  const updatedContact = await contactRepo.getContactByIdWithPhones(req.params.contactId);
  const io = req.app.get('io');
  if (io) {
    io.emit('maintenance_contract_deleted', { contactId: req.params.contactId, contractId: req.params.contractId });
    if (updatedContact) io.emit('contact_updated', updatedContact);
  }

  res.json({ ok: true, contact: updatedContact });
}

module.exports = { listContractsForContact, addContractForContact, stopContractForContact, deleteContractForContact };
