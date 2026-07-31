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

async function mergeAgent(req, res) {
  const { nileUserId, agentApiAccessToken } = req.body || {};
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

  const updated = await externalAgentRepo.mergeAgentToNileUser(row.id, nileUserId, agentApiAccessToken);
  res.json({ ok: true, externalAgent: updated });
}

// بيحدّث/يمسح توكن الإيجنت الشخصي لوحده من غير ما يمس الميرج نفسه — لو حصل
// الميرج قبل كده من غير توكن، أو الإيجنت غيّر التوكن بتاعه في شات ووت
async function setAgentToken(req, res) {
  const { agentApiAccessToken } = req.body || {};
  const row = await externalAgentRepo.getById(req.params.id);
  if (!row) return res.status(404).json({ error: 'الإيجنت الخارجي ده مش موجود' });

  const provider = await assertProviderOwnedByCompany(row.provider_id, req.companyId);
  if (!provider) return res.status(403).json({ error: 'مالكش صلاحية على المزود ده' });

  const updated = await externalAgentRepo.setAgentPersonalToken(row.id, agentApiAccessToken || null);
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
  mergeAgent,
  unmergeAgent,
  setAgentToken,
  syncAgents,
};
