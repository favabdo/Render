// controllers/visit.controller.js
// قسم "الزيارات" (Visits): تسجيل زيارة الإيجنت للعميل (تاريخ، اللي اتعمل، وساعات
// وصول/انصراف اختيارية). متاح لكل الصلاحيات (حتى الإيجنت العادي)، عكس كارت عميل
// الصيانة اللي مقصور على الأدمن/الأونر. اسم الإيجنت بييجي من جلسة تسجيل الدخول
// (req.user) زي باقي الأقسام المشابهة، مش من حاجة بتتبعت من الفرونت — ما عدا
// استثناء واحد: CRM Agent (role 3) نفسه مش بيعمل زيارات ميدانية، فلما يضيف
// زيارة لازم يختار مين من الإيجنتس العاديين (role 2) اللي عملها فعليًا عن طريق
// performedByAgentId في الـ body، وده اللي بيتسجل كصاحب الزيارة بدل ما تتسجل
// باسمه هو (شوف resolvePerformingAgent تحت).
const visitRepo = require('../repositories/visit.repo');
const contactRepo = require('../repositories/contact.repo');
const userRepo = require('../repositories/user.repo');
const socketService = require('../sockets/socket');

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const CRM_AGENT_ROLE = 3;
const REGULAR_AGENT_ROLE = 2;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// بيحدد مين "صاحب" الزيارة فعليًا: أي حد عادي (أدمن/أونر/إيجنت) بتتسجل الزيارة
// باسمه هو نفسه. أما CRM Agent فمش بيعمل زيارات بنفسه، فلازم يختار إيجنت عادي
// (role 2) من قايمة performedByAgentId اللي جايه من الفرونت، وبنتحقق إنه فعلاً
// إيجنت عادي شغال في نفس الشركة قبل ما نسجل الزيارة باسمه
async function resolvePerformingAgent(req) {
  if (req.user.role === CRM_AGENT_ROLE) {
    const chosenId = Number(req.body?.performedByAgentId);
    if (!chosenId) throw httpError(400, 'لازم تختار الإيجنت اللي عمل الزيارة');

    const chosen = await userRepo.findUserById(chosenId);
    if (!chosen || chosen.role !== REGULAR_AGENT_ROLE || (req.companyId && chosen.company_id !== req.companyId)) {
      throw httpError(400, 'اختار إيجنت عادي موجود فعليًا');
    }
    return chosen;
  }
  return userRepo.findUserById(req.user.userId);
}

// بتتحقق من بيانات الزيارة المشتركة، وترجع الـ payload الجاهز للتخزين
async function buildVisitPayload(req, { contactId, contactName, agent: preResolvedAgent }) {
  const { customerName, visitDate, workDone, arrivalTime, departureTime } = req.body || {};

  const trimmedWork = (workDone || '').trim();
  if (!trimmedWork) throw httpError(400, 'لازم تكتب اللي اتعمل في الزيارة');
  if (!visitDate) throw httpError(400, 'لازم تحدد تاريخ الزيارة');

  const finalName = (contactName || customerName || '').trim();
  if (!contactId && !finalName) throw httpError(400, 'لازم تكتب اسم العميل أو تختاره');

  if (arrivalTime && !TIME_REGEX.test(arrivalTime)) throw httpError(400, 'صيغة ساعة الوصول غلط');
  if (departureTime && !TIME_REGEX.test(departureTime)) throw httpError(400, 'صيغة ساعة الانصراف غلط');

  const agent = preResolvedAgent !== undefined ? preResolvedAgent : await resolvePerformingAgent(req);
  const agentName = agent ? userRepo.resolveDisplayName(agent) : (req.user.email || 'Unknown');

  return {
    contactId: contactId || null,
    customerName: finalName || null,
    visitDate,
    workDone: trimmedWork,
    arrivalTime: arrivalTime || null,
    departureTime: departureTime || null,
    agentId: agent ? agent.id : req.user.userId,
    agentName,
    companyId: req.companyId,
  };
}

// كل الزيارات الخاصة بعميل معين — بتتعرض في صفحة تفاصيل العميل تحت "الزيارات"
async function listVisitsForContact(req, res) {
  const [contact, visits] = await Promise.all([
    contactRepo.getContactById(req.params.contactId),
    visitRepo.listVisitsForContact(req.params.contactId),
  ]);
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });
  res.json(visits);
}

// إضافة زيارة من جوه صفحة تفاصيل العميل — اسم العميل بيتسجل تلقائي من الكونتاكت نفسه
async function addVisitForContact(req, res) {
  // الكونتاكت واسم الإيجنت مستقلين تمامًا عن بعض — بنجيبهم مع بعض
  const [contact, agent] = await Promise.all([
    contactRepo.getContactById(req.params.contactId),
    resolvePerformingAgent(req),
  ]);
  if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });

  const payload = await buildVisitPayload(req, { contactId: req.params.contactId, contactName: contact.name, agent });
  const visit = await visitRepo.addVisit(payload);

  const io = req.app.get('io');
  if (io) socketService.emitToCompany(io, req.companyId, 'visit_added', { contactId: req.params.contactId, visit });

  res.status(201).json({ ok: true, visit });
}

// إضافة زيارة من الزرار البرّاني (جمب Add Contact في صفحة Contacts) — الإيجنت
// إما يختار كونتاكت موجود فعليًا (contactId في الـ body) أو يكتب اسم عميل يدوي
// (customerName) لو العميل ده مش متسجل كـ كونتاكت أصلًا
async function addVisitStandalone(req, res) {
  const { contactId } = req.body || {};
  let contactName = null;

  // بنبدأ جلب بيانات الإيجنت (أو تحقق الإيجنت المختار لو CRM Agent) فورًا من غير
  // ما نستناها (مش await هنا) عشان تشتغل بالتوازي مع جلب الكونتاكت (لو محتاج)
  // بدل ما تستنى لحد ما ده يخلص الأول
  const agentPromise = resolvePerformingAgent(req);

  if (contactId) {
    const contact = await contactRepo.getContactById(contactId);
    if (!contact) return res.status(404).json({ error: 'الكونتاكت مش موجود' });
    contactName = contact.name;
  }

  const agent = await agentPromise;
  const payload = await buildVisitPayload(req, { contactId: contactId || null, contactName, agent });
  const visit = await visitRepo.addVisit(payload);

  const io = req.app.get('io');
  if (io) socketService.emitToCompany(io, req.companyId, 'visit_added', { contactId: contactId || null, visit });

  res.status(201).json({ ok: true, visit });
}

module.exports = { listVisitsForContact, addVisitForContact, addVisitStandalone };
