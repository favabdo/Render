// repositories/company.repo.js
// إدارة بيانات الشركة (Account): الاسم، الكود، وعدد أيام الـ Auto Resolve

const { getPool, sql, generateCompanyCode } = require('../config/db');
const { parseScheduleJson } = require('../utils/welcomeSchedule');

// بيحاول يفك الـ JSON بتاع قواعد الـ Keyword Routing (array من { team_id, keywords }).
// لو مفيش قيمة أو الـ JSON باظ بيرجع array فاضية بدل ما يرمي استثناء
function parseKeywordRoutingRules(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((rule) => ({
        team_id: rule && rule.team_id ? Number(rule.team_id) : null,
        keywords: rule && Array.isArray(rule.keywords)
          ? rule.keywords.filter((k) => typeof k === 'string' && k.trim())
          : [],
      }))
      .filter((rule) => rule.team_id && rule.keywords.length);
  } catch {
    return [];
  }
}

async function getCompanyById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`SELECT * FROM [dbo].[NileChat_Companies_byA] WHERE id = @id`);
  return result.recordset[0] || null;
}

// أول شركة اتعملت في النظام (Nile Techno Support) — بنستخدمها كـ fallback لأي
// يوزر لسه مش مربوط بشركة، ولحد ما يتعمل فعليًا اختيار/إنشاء شركة وقت التسجيل
async function getFirstCompany() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP 1 * FROM [dbo].[NileChat_Companies_byA] ORDER BY id ASC
  `);
  return result.recordset[0] || null;
}

// بيرجع بيانات شركة اليوزر (لو مربوط بواحدة)، وإلا أول شركة في النظام كـ fallback
async function getCompanyForUser(user) {
  if (user && user.company_id) {
    const company = await getCompanyById(user.company_id);
    if (company) return company;
  }
  return getFirstCompany();
}

async function createCompany({ name, autoResolveDays = null }) {
  const pool = await getPool();
  const code = generateCompanyCode();
  const result = await pool
    .request()
    .input('name', sql.NVarChar(200), name)
    .input('code', sql.NVarChar(50), code)
    .input('autoResolveDays', sql.Int, autoResolveDays)
    .query(`
      INSERT INTO [dbo].[NileChat_Companies_byA] (name, code, auto_resolve_days)
      OUTPUT INSERTED.*
      VALUES (@name, @code, @autoResolveDays)
    `);
  return result.recordset[0];
}

async function updateCompany(id, { name, autoResolveDays } = {}) {
  const pool = await getPool();
  const req = pool.request().input('id', sql.BigInt, id);
  const sets = [];

  if (name !== undefined) {
    req.input('name', sql.NVarChar(200), name);
    sets.push('name = @name');
  }
  if (autoResolveDays !== undefined) {
    req.input('autoResolveDays', sql.Int, autoResolveDays);
    sets.push('auto_resolve_days = @autoResolveDays');
  }

  if (sets.length === 0) return getCompanyById(id);

  const result = await req.query(`
    UPDATE [dbo].[NileChat_Companies_byA]
    SET ${sets.join(', ')}
    OUTPUT INSERTED.*
    WHERE id = @id
  `);
  return result.recordset[0] || null;
}

// إعداد الـ Auto Resolve الحالي (بيتاخد من أول شركة في النظام حاليًا، لحد ما
// كل جزء تاني في النظام - المحادثات/الـ Inboxes - يتربط فعليًا بشركة معينة)
async function getPrimaryAutoResolveDays() {
  const company = await getFirstCompany();
  return company ? company.auto_resolve_days : null;
}

// بيرجع إعدادات الأتمتة (Automation) الحالية للشركة المطلوبة (أو أول شركة في
// النظام لو مفيش company اتحددت — نفس فكرة getPrimaryAutoResolveDays بالظبط،
// مستخدمة من webhook/resolve اللي مفيهمش يوزر مسجل دخول أصلاً)
function mapAutomationSettings(company) {
  if (!company) return null;
  return {
    auto_assign_enabled: Boolean(company.automation_auto_assign_enabled),
    auto_assign_agent_id: company.automation_auto_assign_agent_id || null,
    welcome_enabled: Boolean(company.automation_welcome_enabled),
    welcome_message: company.automation_welcome_message || '',
    welcome_schedule_enabled: Boolean(company.automation_welcome_schedule_enabled),
    welcome_offhours_message: company.automation_welcome_offhours_message || '',
    welcome_schedule: parseScheduleJson(company.automation_welcome_schedule),
    csat_enabled: Boolean(company.automation_csat_enabled),
    csat_message: company.automation_csat_message || '',
    keyword_routing_enabled: Boolean(company.automation_keyword_routing_enabled),
    keyword_routing_rules: parseKeywordRoutingRules(company.automation_keyword_routing_rules),
    contract_expired_enabled: Boolean(company.automation_contract_expired_enabled),
    contract_expired_message: company.automation_contract_expired_message || '',
    rating_enabled: Boolean(company.automation_rating_enabled),
    rating_issue_message: company.automation_rating_issue_message || '',
    rating_agent_message: company.automation_rating_agent_message || '',
    rating_feedback_message: company.automation_rating_feedback_message || '',
    rating_thanks_message: company.automation_rating_thanks_message || '',
  };
}

async function getAutomationSettings(companyId = null) {
  const company = companyId ? await getCompanyById(companyId) : await getFirstCompany();
  return mapAutomationSettings(company);
}

async function updateAutomationSettings(companyId, fields = {}) {
  const pool = await getPool();
  const req = pool.request().input('id', sql.BigInt, companyId);
  const sets = [];

  if (fields.autoAssignEnabled !== undefined) {
    req.input('autoAssignEnabled', sql.Bit, fields.autoAssignEnabled ? 1 : 0);
    sets.push('automation_auto_assign_enabled = @autoAssignEnabled');
  }
  if (fields.autoAssignAgentId !== undefined) {
    req.input('autoAssignAgentId', sql.BigInt, fields.autoAssignAgentId);
    sets.push('automation_auto_assign_agent_id = @autoAssignAgentId');
  }
  if (fields.welcomeEnabled !== undefined) {
    req.input('welcomeEnabled', sql.Bit, fields.welcomeEnabled ? 1 : 0);
    sets.push('automation_welcome_enabled = @welcomeEnabled');
  }
  if (fields.welcomeMessage !== undefined) {
    req.input('welcomeMessage', sql.NVarChar(sql.MAX), fields.welcomeMessage);
    sets.push('automation_welcome_message = @welcomeMessage');
  }
  if (fields.welcomeScheduleEnabled !== undefined) {
    req.input('welcomeScheduleEnabled', sql.Bit, fields.welcomeScheduleEnabled ? 1 : 0);
    sets.push('automation_welcome_schedule_enabled = @welcomeScheduleEnabled');
  }
  if (fields.welcomeOffhoursMessage !== undefined) {
    req.input('welcomeOffhoursMessage', sql.NVarChar(sql.MAX), fields.welcomeOffhoursMessage);
    sets.push('automation_welcome_offhours_message = @welcomeOffhoursMessage');
  }
  if (fields.welcomeSchedule !== undefined) {
    req.input('welcomeSchedule', sql.NVarChar(sql.MAX), JSON.stringify(fields.welcomeSchedule));
    sets.push('automation_welcome_schedule = @welcomeSchedule');
  }
  if (fields.csatEnabled !== undefined) {
    req.input('csatEnabled', sql.Bit, fields.csatEnabled ? 1 : 0);
    sets.push('automation_csat_enabled = @csatEnabled');
  }
  if (fields.csatMessage !== undefined) {
    req.input('csatMessage', sql.NVarChar(sql.MAX), fields.csatMessage);
    sets.push('automation_csat_message = @csatMessage');
  }
  if (fields.keywordRoutingEnabled !== undefined) {
    req.input('keywordRoutingEnabled', sql.Bit, fields.keywordRoutingEnabled ? 1 : 0);
    sets.push('automation_keyword_routing_enabled = @keywordRoutingEnabled');
  }
  if (fields.keywordRoutingRules !== undefined) {
    req.input('keywordRoutingRules', sql.NVarChar(sql.MAX), JSON.stringify(fields.keywordRoutingRules));
    sets.push('automation_keyword_routing_rules = @keywordRoutingRules');
  }
  if (fields.contractExpiredEnabled !== undefined) {
    req.input('contractExpiredEnabled', sql.Bit, fields.contractExpiredEnabled ? 1 : 0);
    sets.push('automation_contract_expired_enabled = @contractExpiredEnabled');
  }
  if (fields.contractExpiredMessage !== undefined) {
    req.input('contractExpiredMessage', sql.NVarChar(sql.MAX), fields.contractExpiredMessage);
    sets.push('automation_contract_expired_message = @contractExpiredMessage');
  }
  if (fields.ratingEnabled !== undefined) {
    req.input('ratingEnabled', sql.Bit, fields.ratingEnabled ? 1 : 0);
    sets.push('automation_rating_enabled = @ratingEnabled');
  }
  if (fields.ratingIssueMessage !== undefined) {
    req.input('ratingIssueMessage', sql.NVarChar(sql.MAX), fields.ratingIssueMessage);
    sets.push('automation_rating_issue_message = @ratingIssueMessage');
  }
  if (fields.ratingAgentMessage !== undefined) {
    req.input('ratingAgentMessage', sql.NVarChar(sql.MAX), fields.ratingAgentMessage);
    sets.push('automation_rating_agent_message = @ratingAgentMessage');
  }
  if (fields.ratingFeedbackMessage !== undefined) {
    req.input('ratingFeedbackMessage', sql.NVarChar(sql.MAX), fields.ratingFeedbackMessage);
    sets.push('automation_rating_feedback_message = @ratingFeedbackMessage');
  }
  if (fields.ratingThanksMessage !== undefined) {
    req.input('ratingThanksMessage', sql.NVarChar(sql.MAX), fields.ratingThanksMessage);
    sets.push('automation_rating_thanks_message = @ratingThanksMessage');
  }

  if (sets.length === 0) return getAutomationSettings(companyId);

  await req.query(`
    UPDATE [dbo].[NileChat_Companies_byA]
    SET ${sets.join(', ')}
    WHERE id = @id
  `);
  return getAutomationSettings(companyId);
}

module.exports = {
  getCompanyById,
  getFirstCompany,
  getCompanyForUser,
  createCompany,
  updateCompany,
  getPrimaryAutoResolveDays,
  getAutomationSettings,
  updateAutomationSettings,
};
