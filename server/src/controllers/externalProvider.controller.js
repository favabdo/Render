// controllers/externalProvider.controller.js
// إدارة اتصالات المصادر الخارجية (شات ووت) — إنشاء/عرض/تعديل. أدمن بس، ومربوط
// بشركة الإداري اللي بيسجل الدخول (req.companyId) زي باقي الإعدادات في النظام

const crypto = require('crypto');
const externalProviderRepo = require('../repositories/externalProvider.repo');

// بيبني رابط الـ webhook الكامل الجاهز للنسخ ولصقه في إعدادات شات ووت
function buildWebhookUrl(req, provider) {
  return `${req.protocol}://${req.get('host')}/webhook/chatwoot/${provider.id}/${provider.webhook_secret}`;
}

async function createProvider(req, res) {
  const { name = 'chatwoot', baseUrl, accountId, inboxIdOnProvider, apiAccessToken } = req.body || {};

  if (!baseUrl || !accountId || !apiAccessToken) {
    return res.status(400).json({ error: 'لازم تبعت baseUrl و accountId و apiAccessToken' });
  }

  const webhookSecret = crypto.randomBytes(24).toString('hex');

  const provider = await externalProviderRepo.createProvider({
    name,
    companyId: req.companyId,
    baseUrl,
    accountId,
    inboxIdOnProvider: inboxIdOnProvider || null,
    apiAccessToken,
    webhookSecret,
  });

  res.status(201).json({ ok: true, provider, webhookUrl: buildWebhookUrl(req, provider) });
}

async function listProviders(req, res) {
  const providers = await externalProviderRepo.listProvidersByCompany(req.companyId);
  const withUrls = providers.map((p) => ({ ...p, webhookUrl: buildWebhookUrl(req, p) }));
  res.json(withUrls);
}

async function getProvider(req, res) {
  const provider = await externalProviderRepo.getProviderById(req.params.id);
  if (!provider || String(provider.company_id) !== String(req.companyId)) {
    return res.status(404).json({ error: 'المزود ده مش موجود' });
  }
  res.json({ ...provider, webhookUrl: buildWebhookUrl(req, provider) });
}

async function updateProvider(req, res) {
  const provider = await externalProviderRepo.getProviderById(req.params.id);
  if (!provider || String(provider.company_id) !== String(req.companyId)) {
    return res.status(404).json({ error: 'المزود ده مش موجود' });
  }

  const { name, baseUrl, accountId, inboxIdOnProvider, apiAccessToken } = req.body || {};
  const updated = await externalProviderRepo.updateProvider(provider.id, {
    name,
    baseUrl,
    accountId,
    inboxIdOnProvider,
    apiAccessToken,
  });

  res.json({ ok: true, provider: updated, webhookUrl: buildWebhookUrl(req, updated) });
}

async function setActive(req, res) {
  const provider = await externalProviderRepo.getProviderById(req.params.id);
  if (!provider || String(provider.company_id) !== String(req.companyId)) {
    return res.status(404).json({ error: 'المزود ده مش موجود' });
  }
  const { isActive } = req.body || {};
  await externalProviderRepo.setActive(provider.id, Boolean(isActive));
  res.json({ ok: true });
}

// لو حصل تسريب للسيكرت القديم بالغلط، الإداري يقدر يولّد واحد جديد فورًا —
// لازم يحدّث رابط الـ webhook في إعدادات شات ووت بعدها بنفس اللحظة عشان
// الأحداث الجديدة متترفضش
async function regenerateSecret(req, res) {
  const provider = await externalProviderRepo.getProviderById(req.params.id);
  if (!provider || String(provider.company_id) !== String(req.companyId)) {
    return res.status(404).json({ error: 'المزود ده مش موجود' });
  }
  const webhookSecret = crypto.randomBytes(24).toString('hex');
  const updated = await externalProviderRepo.updateProvider(provider.id, { webhookSecret });
  res.json({ ok: true, provider: updated, webhookUrl: buildWebhookUrl(req, updated) });
}

// بيمسح الاتصال بالكامل. المحادثات/الرسايل الحقيقية في نايل شات متتأثرش —
// بتفضل موجودة، بس من غير ربط بمزود خارجي بعد كده (زي فصل إنبوكس عادي)
async function deleteProvider(req, res) {
  const provider = await externalProviderRepo.getProviderById(req.params.id);
  if (!provider || String(provider.company_id) !== String(req.companyId)) {
    return res.status(404).json({ error: 'المزود ده مش موجود' });
  }
  await externalProviderRepo.deleteProvider(provider.id);
  res.json({ ok: true });
}

module.exports = {
  createProvider,
  listProviders,
  getProvider,
  updateProvider,
  setActive,
  regenerateSecret,
  deleteProvider,
};
