// controllers/company.controller.js
// إعدادات الحساب (Account Name + Auto Resolve After Inactivity)

const companyRepo = require('../repositories/company.repo');
const userRepo = require('../repositories/user.repo');

// أي قيمة مسموحة لعدد أيام الـ Auto Resolve — null يعني الخاصية متوقفة
const ALLOWED_AUTO_RESOLVE_DAYS = [null, 1, 2, 3, 5, 7, 14, 30];

async function getSettings(req, res) {
  const user = await userRepo.findUserById(req.user.userId);
  const company = await companyRepo.getCompanyForUser(user);

  if (!company) {
    return res.status(404).json({ error: 'مفيش شركة مربوطة بالحساب ده' });
  }

  res.json({
    id: company.id,
    name: company.name,
    code: company.code,
    auto_resolve_days: company.auto_resolve_days,
  });
}

// admin/owner بس هما اللي يقدروا يعدّلوا إعدادات الشركة (نفس صلاحية باقي صفحة الـ Settings)
async function updateSettings(req, res) {
  const { name, auto_resolve_days } = req.body || {};

  const user = await userRepo.findUserById(req.user.userId);
  const company = await companyRepo.getCompanyForUser(user);
  if (!company) {
    return res.status(404).json({ error: 'مفيش شركة مربوطة بالحساب ده' });
  }

  const fields = {};

  if (name !== undefined) {
    const trimmed = String(name || '').trim();
    if (!trimmed || trimmed.length < 2 || trimmed.length > 200) {
      return res.status(400).json({ error: 'اسم الحساب لازم يكون بين 2 و 200 حرف' });
    }
    fields.name = trimmed;
  }

  if (auto_resolve_days !== undefined) {
    // ممكن تيجي null (يعني "Disabled") أو رقم صحيح من القائمة المسموحة
    const normalized = auto_resolve_days === null || auto_resolve_days === ''
      ? null
      : Number(auto_resolve_days);

    if (normalized !== null && (!Number.isInteger(normalized) || !ALLOWED_AUTO_RESOLVE_DAYS.includes(normalized))) {
      return res.status(400).json({ error: 'عدد أيام الـ Auto Resolve مش مسموح بيه' });
    }
    fields.autoResolveDays = normalized;
  }

  const updated = await companyRepo.updateCompany(company.id, fields);
  res.json({
    ok: true,
    id: updated.id,
    name: updated.name,
    code: updated.code,
    auto_resolve_days: updated.auto_resolve_days,
  });
}

module.exports = { getSettings, updateSettings, getAutomationSettings, updateAutomationSettings };

// ===== إعدادات الأتمتة (Automation) =====
// أي إيجنت مسجل دخول يقدر يشوف حالة القواعد (عرض بس)، والتعديل للـ admin/owner بس
async function getAutomationSettings(req, res) {
  const user = await userRepo.findUserById(req.user.userId);
  const company = await companyRepo.getCompanyForUser(user);
  if (!company) {
    return res.status(404).json({ error: 'مفيش شركة مربوطة بالحساب ده' });
  }

  const settings = await companyRepo.getAutomationSettings(company.id);

  // بنرجع اسم الإيجنت المختار للـ Auto-assign جنب الـ id، عشان الواجهة تقدر تعرضه
  // من غير ما تحتاج تجيب ليستة الإيجنتس كلها وتدور فيها بنفسها
  let autoAssignAgentName = null;
  if (settings.auto_assign_agent_id) {
    const agent = await userRepo.findUserById(settings.auto_assign_agent_id);
    autoAssignAgentName = agent ? userRepo.resolveDisplayName(agent) : null;
  }

  res.json({ ...settings, auto_assign_agent_name: autoAssignAgentName });
}

async function updateAutomationSettings(req, res) {
  const {
    auto_assign_enabled,
    auto_assign_agent_id,
    welcome_enabled,
    welcome_message,
    csat_enabled,
    csat_message,
  } = req.body || {};

  const user = await userRepo.findUserById(req.user.userId);
  const company = await companyRepo.getCompanyForUser(user);
  if (!company) {
    return res.status(404).json({ error: 'مفيش شركة مربوطة بالحساب ده' });
  }

  const fields = {};

  if (auto_assign_enabled !== undefined) {
    fields.autoAssignEnabled = Boolean(auto_assign_enabled);
  }
  if (auto_assign_agent_id !== undefined) {
    const agentId = auto_assign_agent_id === null || auto_assign_agent_id === '' ? null : Number(auto_assign_agent_id);
    if (agentId !== null) {
      const agent = await userRepo.findUserById(agentId);
      if (!agent) {
        return res.status(400).json({ error: 'الموظف المختار للتعيين التلقائي مش موجود' });
      }
    }
    fields.autoAssignAgentId = agentId;
  }
  if (welcome_enabled !== undefined) {
    fields.welcomeEnabled = Boolean(welcome_enabled);
  }
  if (welcome_message !== undefined) {
    const trimmed = String(welcome_message || '').trim();
    if (trimmed.length > 4000) {
      return res.status(400).json({ error: 'رسالة الترحيب طويلة أوي' });
    }
    fields.welcomeMessage = trimmed;
  }
  if (csat_enabled !== undefined) {
    fields.csatEnabled = Boolean(csat_enabled);
  }
  if (csat_message !== undefined) {
    const trimmed = String(csat_message || '').trim();
    if (trimmed.length > 4000) {
      return res.status(400).json({ error: 'رسالة الـ CSAT طويلة أوي' });
    }
    fields.csatMessage = trimmed;
  }

  // لو حد فعّل قاعدة الـ Auto-assign لازم يكون في إيجنت مختار (سواء دلوقتي أو
  // متحدد من قبل كده وموجود في الداتابيز بالفعل)
  const willBeEnabled = fields.autoAssignEnabled !== undefined ? fields.autoAssignEnabled : undefined;
  if (willBeEnabled) {
    const existing = await companyRepo.getAutomationSettings(company.id);
    const finalAgentId = fields.autoAssignAgentId !== undefined ? fields.autoAssignAgentId : existing.auto_assign_agent_id;
    if (!finalAgentId) {
      return res.status(400).json({ error: 'لازم تختار الإيجنت اللي هيتعينله المحادثات الجديدة الأول' });
    }
  }

  const updated = await companyRepo.updateAutomationSettings(company.id, fields);
  res.json({ ok: true, ...updated });
}
