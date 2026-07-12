// controllers/visit.controller.js
// قسم "الزيارات" (Visits): تسجيل زيارة الإيجنت للعميل (تاريخ، اللي اتعمل، وساعات
// وصول/انصراف اختيارية). متاح لكل الصلاحيات (حتى الإيجنت العادي)، عكس كارت عميل
// الصيانة اللي مقصور على الأدمن/الأونر. اسم الإيجنت بييجي من جلسة تسجيل الدخول
// (req.user) زي باقي الأقسام المشابهة، مش من حاجة بتتبعت من الفرونت.
const visitRepo = require('../repositories/visit.repo');
const contactRepo = require('../repositories/contact.repo');
const userRepo = require('../repositories/user.repo');

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// بتتحقق من بيانات الزيارة المشتركة، وترجع الـ payload الجاهز للتخزين
async function buildVisitPayload(req, { contactId, contactName }) {
  const { customerName, visitDate, workDone, arrivalTime, departureTime } = req.body || {};

  const trimmedWork = (workDone || '').trim();
  if (!trimmedWork) throw httpError(400, 'لازم تكتب اللي اتعمل في الزيارة');
  if (!visitDate) throw httpError(400, 'لازم تحدد تاريخ الزيارة');

  const finalName = (contactName || customerName || '').trim();
  if (!contactId && !finalName) throw httpError(400, 'لازم تكتب اسم العميل أو تختاره');

  if (arrivalTime && !TIME_REGEX.test(arrivalTime)) throw httpError(400, 'صيغة ساعة الوصول غلط');
  if (departureTime && !TIME_REGEX.test(departureTime)) throw httpError(400, 'صيغة ساعة الانصراف غلط');

  const agent = await userRepo.findUserById(req.user.userId);
  const agentName = agent ? userRepo.resolveDisplayName(agent) : (req.user.email || 'Unknown');

  return {
    contactId: contactId || null,
    customerName: finalName || null,
    visitDate,
    workDone: trimmedWork,
    arrivalTime: arrivalTime || null,
    departureTime: departureTime || null,
    agentId: req.user.userId,
    agentName,
  };
}

// كل الزيارات الخاصة بعميل معين — بتتعرض في صفحة تفاصيل العميل تحت "الزيارات"
async function listVisitsForContact(req, res) {
  const contact = await contactRepo.getContactById(req.params.contactId);
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

  const visits = await visitRepo.listVisitsForContact(req.params.contactId);
  res.json(visits);
}

// إضافة زيارة من جوه صفحة تفاصيل العميل — اسم العميل بيتسجل تلقائي من الكونتاكت نفسه
async function addVisitForContact(req, res) {
  const contact = await contactRepo.getContactById(req.params.contactId);
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

  const payload = await buildVisitPayload(req, { contactId: req.params.contactId, contactName: contact.name });
  const visit = await visitRepo.addVisit(payload);

  const io = req.app.get('io');
  if (io) io.emit('visit_added', { contactId: req.params.contactId, visit });

  res.status(201).json({ ok: true, visit });
}

// إضافة زيارة من الزرار البرّاني (جمب Add Contact في صفحة Contacts) — الإيجنت
// إما يختار كونتاكت موجود فعليًا (contactId في الـ body) أو يكتب اسم عميل يدوي
// (customerName) لو العميل ده مش متسجل كـ كونتاكت أصلًا
async function addVisitStandalone(req, res) {
  const { contactId } = req.body || {};
  let contactName = null;

  if (contactId) {
    const contact = await contactRepo.getContactById(contactId);
    if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });
    contactName = contact.name;
  }

  const payload = await buildVisitPayload(req, { contactId: contactId || null, contactName });
  const visit = await visitRepo.addVisit(payload);

  const io = req.app.get('io');
  if (io) io.emit('visit_added', { contactId: contactId || null, visit });

  res.status(201).json({ ok: true, visit });
}

module.exports = { listVisitsForContact, addVisitForContact, addVisitStandalone };
