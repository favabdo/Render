// controllers/externalMerge.controller.js
// الإجراء الصريح الوحيد اللي ممكن يحط قيمة في nile_contact_id / nile_user_id.
// أدمن بس، وبيتأكد إن كل حاجة (المزود + الكونتاكت/اليوزر الهدف) تابعين لنفس
// شركة الإداري قبل ما يعمل أي ربط — عشان مايحصلش تسريب بيانات بين الشركات

const externalProviderRepo = require('../repositories/externalProvider.repo');
const externalContactRepo = require('../repositories/externalContact.repo');
const externalAgentRepo = require('../repositories/externalAgent.repo');
const chatwootService = require('../services/chatwoot.service');
const contactRepo = require('../repositories/contact.repo');
const userRepo = require('../repositories/user.repo');
const logger = require('../utils/logger');

// بيتأكد إن المزود بتاع الصف ده هو فعلاً مزود شركة الإداري الحالي
async function assertProviderOwnedByCompany(providerId, companyId) {
  const provider = await externalProviderRepo.getProviderById(providerId);
  if (!provider || String(provider.company_id) !== String(companyId)) return null;
  return provider;
}

// ===== كونتاكتس =====

async function listUnmergedContacts(req, res) {
  const provider = await assertProviderOwnedByCompany(req.params.providerId, req.companyId);
  if (!provider) return res.status(404).json({ error: 'المزود ده مش موجود' });

  const contacts = await externalContactRepo.listUnmerged(provider.id);
  res.json(contacts);
}

async function mergeContact(req, res) {
  const { nileContactId } = req.body || {};
  if (!nileContactId) return res.status(400).json({ error: 'لازم تبعت nileContactId' });

  const row = await externalContactRepo.getById(req.params.id);
  if (!row) return res.status(404).json({ error: 'الكونتاكت الخارجي ده مش موجود' });

  const provider = await assertProviderOwnedByCompany(row.provider_id, req.companyId);
  if (!provider) return res.status(403).json({ error: 'مالكش صلاحية على المزود ده' });

  const targetContact = await contactRepo.getContactById(nileContactId);
  if (!targetContact) return res.status(404).json({ error: 'الكونتاكت المطلوب الربط بيه مش موجود' });
  // company_id بيفضل NULL لبيانات قديمة (زي باقي النظام) — بنرفض بس لو
  // الكونتاكت الهدف مؤكد إنه تابع شركة تانية صراحةً
  if (targetContact.company_id && String(targetContact.company_id) !== String(req.companyId)) {
    return res.status(403).json({ error: 'الكونتاكت ده تابع شركة تانية' });
  }

  const updated = await externalContactRepo.mergeContactToNileContact(row.id, nileContactId);
  res.json({ ok: true, externalContact: updated });
}

async function unmergeContact(req, res) {
  const row = await externalContactRepo.getById(req.params.id);
  if (!row) return res.status(404).json({ error: 'الكونتاكت الخارجي ده مش موجود' });

  const provider = await assertProviderOwnedByCompany(row.provider_id, req.companyId);
  if (!provider) return res.status(403).json({ error: 'مالكش صلاحية على المزود ده' });

  await externalContactRepo.unmergeContact(row.id);
  res.json({ ok: true });
}

// ===== إيجنتس =====

async function listUnmergedAgents(req, res) {
  const provider = await assertProviderOwnedByCompany(req.params.providerId, req.companyId);
  if (!provider) return res.status(404).json({ error: 'المزود ده مش موجود' });

  const agents = await externalAgentRepo.listUnmerged(provider.id);
  res.json(agents);
}

// كل الإيجنتس (مربوطين أو لأ) — مستخدمة في شاشة "كل الإيجنتس" بالإعدادات
async function listAllAgents(req, res) {
  const provider = await assertProviderOwnedByCompany(req.params.providerId, req.companyId);
  if (!provider) return res.status(404).json({ error: 'المزود ده مش موجود' });

  const agents = await externalAgentRepo.listAll(provider.id);
  res.json(agents);
}

async function mergeAgent(req, res) {
  const { nileUserId, agentApiAccessToken, agentEmail, agentPassword } = req.body || {};
  if (!nileUserId) return res.status(400).json({ error: 'لازم تبعت nileUserId' });

  const row = await externalAgentRepo.getById(req.params.id);
  if (!row) return res.status(404).json({ error: 'الإيجنت الخارجي ده مش موجود' });

  const provider = await assertProviderOwnedByCompany(row.provider_id, req.companyId);
  if (!provider) return res.status(403).json({ error: 'مالكش صلاحية على المزود ده' });

  const targetUser = await userRepo.findUserById(nileUserId);
  if (!targetUser) return res.status(404).json({ error: 'اليوزر المطلوب الربط بيه مش موجود' });
  if (targetUser.company_id && String(targetUser.company_id) !== String(req.companyId)) {
    return res.status(403).json({ error: 'اليوزر ده تابع شركة تانية' });
  }

  // لو الإداري بعت إيميل وباسورد الإيجنت في شات ووت بدل التوكن، نجيب التوكن
  // الدائم بتاعه دلوقتي تلقائيًا (بدل ما يحتاج يفتح شات ووت وينسخه يدويًا).
  // لو التسجيل فشل (بيانات غلط)، الميرج نفسه بيكمل عادي — بس هيتبعت بتوكن
  // الاتصال العام لحد ما الإيميل/الباسورد يتصلحوا (نظام الإرسال هيحاول يجدد
  // تلقائيًا في كل مرة بعدين برضه، شوف chatwoot.service.js)
  let finalToken = agentApiAccessToken || null;
  if (!finalToken && agentEmail && agentPassword) {
    try {
      finalToken = await chatwootService.loginAndFetchToken(provider.base_url, agentEmail, agentPassword);
    } catch (err) {
      logger.error(`❌ فشل تسجيل دخول الإيجنت بالإيميل/الباسورد وقت الميرج: ${err.message}`);
    }
  }

  const updated = await externalAgentRepo.mergeAgentToNileUser(row.id, nileUserId, finalToken, agentEmail, agentPassword);
  res.json({ ok: true, externalAgent: updated });
}

// بيحدّث/يمسح توكن الإيجنت الشخصي لوحده من غير ما يمس الميرج نفسه — لو حصل
// الميرج قبل كده من غير توكن، أو الإيجنت غيّر التوكن بتاعه في شات ووت
async function setAgentToken(req, res) {
  const { agentApiAccessToken, agentEmail, agentPassword, refreshTokenNow } = req.body || {};
  const row = await externalAgentRepo.getById(req.params.id);
  if (!row) return res.status(404).json({ error: 'الإيجنت الخارجي ده مش موجود' });

  const provider = await assertProviderOwnedByCompany(row.provider_id, req.companyId);
  if (!provider) return res.status(403).json({ error: 'مالكش صلاحية على المزود ده' });

  // لو الإداري بعت إيميل وباسورد الإيجنت (أو ضغط "جدد التوكن دلوقتي")، نجيب
  // توكن دائم جديد بتسجيل الدخول بيهم بدل النسخ اليدوي
  let finalToken = agentApiAccessToken || null;
  if (!finalToken && (refreshTokenNow || (agentEmail && agentPassword))) {
    const emailToUse = agentEmail || row.agent_email;
    const passwordToUse = agentPassword || row.agent_password;
    if (emailToUse && passwordToUse) {
      try {
        finalToken = await chatwootService.loginAndFetchToken(provider.base_url, emailToUse, passwordToUse);
      } catch (err) {
        return res.status(400).json({ error: `فشل تسجيل الدخول بالإيميل والباسورد: ${err.message}` });
      }
    }
  }

  if (agentEmail || agentPassword) {
    await externalAgentRepo.setAgentCredentials(row.id, agentEmail, agentPassword);
  }
  const updated = await externalAgentRepo.setAgentPersonalToken(row.id, finalToken);
  res.json({ ok: true, externalAgent: updated });
}

// بيجيب كل إيجنتس الحساب من شات ووت دفعة واحدة ويسجلهم في External_Agent_byA
// (بدون ميرج تلقائي — بس عشان يظهروا في قايمة "ربط بإيجنت موجود" فورًا)
async function syncAgents(req, res) {
  const provider = await assertProviderOwnedByCompany(req.params.providerId, req.companyId);
  if (!provider) return res.status(404).json({ error: 'المزود ده مش موجود' });

  const chatwootAgents = await chatwootService.fetchAgents(provider);
  const synced = await externalAgentRepo.syncAgentsFromList(provider.id, chatwootAgents);
  res.json({ ok: true, count: synced.length });
}

async function unmergeAgent(req, res) {
  const row = await externalAgentRepo.getById(req.params.id);
  if (!row) return res.status(404).json({ error: 'الإيجنت الخارجي ده مش موجود' });

  const provider = await assertProviderOwnedByCompany(row.provider_id, req.companyId);
  if (!provider) return res.status(403).json({ error: 'مالكش صلاحية على المزود ده' });

  await externalAgentRepo.unmergeAgent(row.id);
  res.json({ ok: true });
}

module.exports = {
  listUnmergedContacts,
  mergeContact,
  unmergeContact,
  listUnmergedAgents,
  listAllAgents,
  mergeAgent,
  unmergeAgent,
  setAgentToken,
  syncAgents,
};
