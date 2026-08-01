// controllers/externalProvider.controller.js
// إدارة اتصالات المصادر الخارجية (شات ووت) — إنشاء/عرض/تعديل. أدمن بس، ومربوط
// بشركة الإداري اللي بيسجل الدخول (req.companyId) زي باقي الإعدادات في النظام

const crypto = require('crypto');
const externalProviderRepo = require('../repositories/externalProvider.repo');
const chatwootService = require('../services/chatwoot.service');

// بيبني رابط الـ webhook الكامل الجاهز للنسخ ولصقه في إعدادات شات ووت
function buildWebhookUrl(req, provider) {
  return `${req.protocol}://${req.get('host')}/webhook/chatwoot/${provider.id}/${provider.webhook_secret}`;
}

async function createProvider(req, res) {
  const {
    name = 'chatwoot',
    baseUrl,
    accountId,
    inboxIdOnProvider,
    apiAccessToken,
    loginEmail,
    loginPassword,
  } = req.body || {};

  if (!baseUrl || !accountId) {
    return res.status(400).json({ error: 'لازم تبعت baseUrl و accountId' });
  }
  if (!apiAccessToken && !(loginEmail && loginPassword)) {
    return res.status(400).json({ error: 'لازم تبعت apiAccessToken، أو الإيميل والباسورد بديلًا عنه' });
  }

  // لو مبعتش توكن بس بعت إيميل وباسورد، نسجل دخول شات ووت دلوقتي ونجيب
  // التوكن الدائم منهم تلقائيًا بدل ما نطلب من الإداري ينسخه يدويًا
  let finalToken = apiAccessToken || null;
  if (!finalToken) {
    try {
      finalToken = await chatwootService.loginAndFetchToken(baseUrl, loginEmail, loginPassword);
    } catch (err) {
      return res.status(400).json({ error: `فشل تسجيل الدخول بالإيميل والباسورد: ${err.message}` });
    }
  }

  const webhookSecret = crypto.randomBytes(24).toString('hex');

  const provider = await externalProviderRepo.createProvider({
    name,
    companyId: req.companyId,
    baseUrl,
    accountId,
    inboxIdOnProvider: inboxIdOnProvider || null,
    apiAccessToken: finalToken,
    webhookSecret,
    loginEmail: loginEmail || null,
    loginPassword: loginPassword || null,
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

  const { name, baseUrl, accountId, inboxIdOnProvider, apiAccessToken, loginEmail, loginPassword, refreshTokenNow } = req.body || {};

  // لو الإداري ضغط "جدد التوكن دلوقتي" (أو بعت إيميل/باسورد جداد من غير
  // توكن)، نسجل دخول بالإيميل/الباسورد (الجداد لو اتبعتوا، وإلا المخزنين
  // خلاص) ونجيب توكن دائم جديد بدل ما يحتاج ينسخه يدويًا من شات ووت
  let finalToken = apiAccessToken || null;
  if (!finalToken && (refreshTokenNow || (loginEmail && loginPassword))) {
    const emailToUse = loginEmail || provider.login_email;
    const passwordToUse = loginPassword || provider.login_password;
    const baseUrlToUse = baseUrl || provider.base_url;
    if (emailToUse && passwordToUse) {
      try {
        finalToken = await chatwootService.loginAndFetchToken(baseUrlToUse, emailToUse, passwordToUse);
      } catch (err) {
        return res.status(400).json({ error: `فشل تسجيل الدخول بالإيميل والباسورد: ${err.message}` });
      }
    }
  }

  const updated = await externalProviderRepo.updateProvider(provider.id, {
    name,
    baseUrl,
    accountId,
    inboxIdOnProvider,
    apiAccessToken: finalToken,
    loginEmail,
    loginPassword,
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
