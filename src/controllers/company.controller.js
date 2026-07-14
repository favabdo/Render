// controllers/company.controller.js
// إعدادات الحساب (Account Name + Auto Resolve After Inactivity)

const companyRepo = require('../repositories/company.repo');
const userRepo = require('../repositories/user.repo');
const teamRepo = require('../repositories/team.repo');
const { DAY_KEYS, normalizeSchedule } = require('../utils/welcomeSchedule');
const notificationService = require('../services/notification.service');

// أقصى عدد قواعد (كل قاعدة = تيم + كلماته) وأقصى عدد كلمات في القاعدة الواحدة، وأقصى طول للكلمة
const MAX_KEYWORD_ROUTING_RULES = 15;
const MAX_KEYWORD_ROUTING_KEYWORDS_PER_RULE = 30;
const MAX_KEYWORD_LENGTH = 100;

// بتنضف وتفلتر ليستة الكلمات الجاية من الفرونت: تريم، تشيل الفاضي، وتشيل التكرار
// (المقارنة بتبقى case-insensitive عشان منمنعش تكرار "ABC" و"abc" مثلاً، لكن
// النص المتخزن نفسه بيفضل زي ما اليوزر كتبه بالظبط)
function sanitizeKeywords(rawKeywords) {
  const seen = new Set();
  const result = [];
  for (const raw of rawKeywords) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed.slice(0, MAX_KEYWORD_LENGTH));
  }
  return result;
}

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
  notificationService.logActivity(req, 'غيّر إعدادات الحساب (Account Settings)');
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

  // نفس الفكرة بالظبط بس لكل قاعدة من قواعد الـ Keyword Routing: بنرجع اسم
  // التيم بتاعها جنب الـ id، عشان الواجهة تعرضه من غير ما تحتاج تدور بنفسها
  const teamIds = [...new Set((settings.keyword_routing_rules || []).map((r) => r.team_id).filter(Boolean))];
  const teamsById = new Map();
  for (const teamId of teamIds) {
    const team = await teamRepo.getTeamById(teamId);
    if (team) teamsById.set(String(teamId), team);
  }
  const keywordRoutingRules = (settings.keyword_routing_rules || []).map((rule) => ({
    ...rule,
    team_name: teamsById.get(String(rule.team_id))?.name || null,
  }));

  res.json({
    ...settings,
    auto_assign_agent_name: autoAssignAgentName,
    keyword_routing_rules: keywordRoutingRules,
  });
}

async function updateAutomationSettings(req, res) {
  const {
    auto_assign_enabled,
    auto_assign_agent_id,
    welcome_enabled,
    welcome_message,
    welcome_schedule_enabled,
    welcome_offhours_message,
    welcome_schedule,
    csat_enabled,
    csat_message,
    keyword_routing_enabled,
    keyword_routing_rules,
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
  if (welcome_schedule_enabled !== undefined) {
    fields.welcomeScheduleEnabled = Boolean(welcome_schedule_enabled);
  }
  if (welcome_offhours_message !== undefined) {
    const trimmed = String(welcome_offhours_message || '').trim();
    if (trimmed.length > 4000) {
      return res.status(400).json({ error: 'رسالة خارج أوقات العمل طويلة أوي' });
    }
    fields.welcomeOffhoursMessage = trimmed;
  }
  if (welcome_schedule !== undefined) {
    if (welcome_schedule !== null && typeof welcome_schedule !== 'object') {
      return res.status(400).json({ error: 'شكل جدول أوقات العمل مش صحيح' });
    }
    const normalized = normalizeSchedule(welcome_schedule);
    if (!DAY_KEYS.some((k) => normalized.days[k].enabled)) {
      return res.status(400).json({ error: 'لازم تحدد يوم واحد على الأقل في جدول أوقات العمل' });
    }
    fields.welcomeSchedule = normalized;
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
  if (keyword_routing_enabled !== undefined) {
    fields.keywordRoutingEnabled = Boolean(keyword_routing_enabled);
  }
  if (keyword_routing_rules !== undefined) {
    if (!Array.isArray(keyword_routing_rules)) {
      return res.status(400).json({ error: 'شكل قواعد الـ Keyword Routing مش صحيح' });
    }
    if (keyword_routing_rules.length > MAX_KEYWORD_ROUTING_RULES) {
      return res.status(400).json({ error: `أقصى عدد قواعد هو ${MAX_KEYWORD_ROUTING_RULES}` });
    }
    const cleanedRules = [];
    for (const rule of keyword_routing_rules) {
      const teamId = rule && rule.team_id !== undefined && rule.team_id !== null && rule.team_id !== ''
        ? Number(rule.team_id)
        : null;
      const keywords = rule && Array.isArray(rule.keywords) ? sanitizeKeywords(rule.keywords) : [];

      // بنتجاهل بهدوء أي قاعدة فاضية تمامًا (مفيش تيم ولا كلمات) بدل ما نرمي error،
      // عشان اليوزر يقدر يضيف صف فاضي في الواجهة من غير ما كل حاجة توقف
      if (!teamId && !keywords.length) continue;

      if (!teamId) {
        return res.status(400).json({ error: 'كل قاعدة لازم يكون ليها تيم مختار' });
      }
      const team = await teamRepo.getTeamById(teamId);
      if (!team) {
        return res.status(400).json({ error: 'أحد التيمز المختارة للتوجيه بالكلمات المفتاحية مش موجود' });
      }
      if (!keywords.length) {
        return res.status(400).json({ error: `لازم تضيف كلمة مفتاحية واحدة على الأقل لقاعدة تيم "${team.name}"` });
      }
      if (keywords.length > MAX_KEYWORD_ROUTING_KEYWORDS_PER_RULE) {
        return res.status(400).json({ error: `أقصى عدد كلمات لكل قاعدة هو ${MAX_KEYWORD_ROUTING_KEYWORDS_PER_RULE}` });
      }
      cleanedRules.push({ team_id: teamId, keywords });
    }
    fields.keywordRoutingRules = cleanedRules;
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

  // لو هتتفعّل خاصية "جدول أوقات العمل" لرسالة الترحيب، لازم تكون رسالة الترحيب
  // العادية ورسالة خارج أوقات العمل موجودين (سواء اتبعتوا دلوقتي أو كانوا محفوظين قبل كده)
  const willScheduleBeEnabled = fields.welcomeScheduleEnabled !== undefined ? fields.welcomeScheduleEnabled : undefined;
  if (willScheduleBeEnabled) {
    const existing = await companyRepo.getAutomationSettings(company.id);
    const finalWelcomeMessage = fields.welcomeMessage !== undefined ? fields.welcomeMessage : existing.welcome_message;
    const finalOffhoursMessage = fields.welcomeOffhoursMessage !== undefined ? fields.welcomeOffhoursMessage : existing.welcome_offhours_message;
    if (!finalWelcomeMessage) {
      return res.status(400).json({ error: 'لازم تكتب رسالة الترحيب في أوقات العمل الأول' });
    }
    if (!finalOffhoursMessage) {
      return res.status(400).json({ error: 'لازم تكتب رسالة الترحيب خارج أوقات العمل الأول' });
    }
  }

  // لو حد فعّل قاعدة الـ Keyword Routing لازم يكون في قاعدة واحدة كاملة (تيم +
  // كلمة) على الأقل، سواء دلوقتي أو متحددة من قبل كده وموجودة في الداتابيز بالفعل
  const willKeywordRoutingBeEnabled = fields.keywordRoutingEnabled !== undefined ? fields.keywordRoutingEnabled : undefined;
  if (willKeywordRoutingBeEnabled) {
    const existing = await companyRepo.getAutomationSettings(company.id);
    const finalRules = fields.keywordRoutingRules !== undefined ? fields.keywordRoutingRules : existing.keyword_routing_rules;
    if (!finalRules || !finalRules.length) {
      return res.status(400).json({ error: 'لازم تضيف قاعدة واحدة على الأقل (تيم + كلمة مفتاحية) قبل التفعيل' });
    }
  }

  const updated = await companyRepo.updateAutomationSettings(company.id, fields);
  res.json({ ok: true, ...updated });
  notificationService.logActivity(req, 'غيّر إعدادات الأتمتة (Automation)');
}
