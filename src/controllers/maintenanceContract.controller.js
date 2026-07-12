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
  const contact = await contactRepo.getContactById(req.params.contactId);
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

  const contracts = await maintenanceContractRepo.listContractsForContact(req.params.contactId);
  res.json(contracts);
}

// إضافة عقد صيانة جديد للعميل (تجديد كامل بتاريخ بدء ونهاية جديدين) — أدمن/أونر
// بس، وممنوع لو لسه فيه عقد "active" شغال للعميل ده. لازم الأدمن يوقف العقد
// الحالي الأول من صفحة سجل الصيانة، وبعدين يقدر يضيف عقد جديد
async function addContractForContact(req, res) {
  const contact = await contactRepo.getContactById(req.params.contactId);
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

  const activeContract = await maintenanceContractRepo.getActiveContractForContact(req.params.contactId);
  if (activeContract) {
    throw httpError(409, 'فيه عقد صيانة شغال بالفعل للعميل ده. لازم توقفه الأول قبل ما تضيف عقد جديد');
  }

  const { startDate, endDate, notes } = req.body || {};
  if (!startDate) throw httpError(400, 'لازم تحدد تاريخ بدء العقد');
  if (!endDate) throw httpError(400, 'لازم تحدد تاريخ انتهاء العقد');
  if (new Date(endDate) < new Date(startDate)) {
    throw httpError(400, 'تاريخ انتهاء العقد لازم يكون بعد تاريخ البدء');
  }

  const trimmedNotes = (notes || '').trim();
  if (trimmedNotes.length > 500) throw httpError(400, 'الملاحظة طويلة أوي');

  const agent = await userRepo.findUserById(req.user.userId);
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

// إيقاف عقد صيانة شغال (status -> 'stopped') — أدمن/أونر بس. بعد ما يتوقف يبقى
// ينفع يتضاف عقد جديد للعميل ده
async function stopContract(req, res) {
  const contact = await contactRepo.getContactById(req.params.contactId);
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

  const existing = await maintenanceContractRepo.getContractById(req.params.contractId);
  if (!existing || String(existing.contact_id) !== String(req.params.contactId)) {
    return res.status(404).json({ error: 'عقد الصيانة ده مش موجود' });
  }

  const contract = await maintenanceContractRepo.stopContract(req.params.contractId);
  if (!contract) return res.status(409).json({ error: 'عقد الصيانة ده متوقف بالفعل' });

  // العقد الموقوف ده لسه هو "آخر عقد مضاف"، فأرقام الكروت مش بتتغير، لكن حالته
  // اتغيرت، فبنبعت الكونتاكت المحدّث عشان أي حد فاتح صفحة تفاصيله يحدّث فورًا
  const updatedContact = await contactRepo.getContactByIdWithPhones(req.params.contactId);

  const io = req.app.get('io');
  if (io) {
    io.emit('maintenance_contract_stopped', { contactId: req.params.contactId, contract });
    if (updatedContact) io.emit('contact_updated', updatedContact);
  }

  res.json({ ok: true, contract, contact: updatedContact });
}

// مسح عقد صيانة خالص من السجل — أدمن/أونر بس. لو العقد المتمسوح كان هو "آخر عقد
// مضاف"، الأرقام الظاهرة في الكروت هترجع تتحدث على العقد اللي قبله تلقائيًا
async function deleteContract(req, res) {
  const contact = await contactRepo.getContactById(req.params.contactId);
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

  const existing = await maintenanceContractRepo.getContractById(req.params.contractId);
  if (!existing || String(existing.contact_id) !== String(req.params.contactId)) {
    return res.status(404).json({ error: 'عقد الصيانة ده مش موجود' });
  }

  await maintenanceContractRepo.deleteContract(req.params.contractId);
  const updatedContact = await contactRepo.getContactByIdWithPhones(req.params.contactId);

  const io = req.app.get('io');
  if (io) {
    io.emit('maintenance_contract_deleted', { contactId: req.params.contactId, contractId: req.params.contractId });
    if (updatedContact) io.emit('contact_updated', updatedContact);
  }

  res.json({ ok: true, contact: updatedContact });
}

module.exports = { listContractsForContact, addContractForContact, stopContract, deleteContract };
