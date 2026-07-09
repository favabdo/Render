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

module.exports = { getSettings, updateSettings };
