const { getPool, sql } = require('../database/connection');
const cache = require('../services/cache.service');

// ملحوظة عن الكاش: listKey لازم ياخد companyId في اعتباره — لو استخدمنا
// مفتاح واحد ثابت 'team:list' هيتشارك بين كل الشركات، وأول شركة تقرا القايمة
// هتكاش قايمتها هي وأي شركة تانية بعدها هتقرا نفس القايمة الغلط من الكاش.
// فبنحط companyId (أو 'all' لو مفيش) كجزء من المفتاح نفسه.
const listKey = (companyId) => cache.cacheKey('team', 'list', companyId ?? 'all');
const byIdKey = (id) => cache.cacheKey('team', id);

// كل التيمز، مع عدد الإيجنتس المنضمين لكل تيم (بيتعرض في كارت التيم بصفحة الإعدادات)
// كاش: team:list:{companyId} (24h) — التيمز بتتغير بس لما أدمن يضيف/يعدّل/يمسح تيم من الإعدادات
async function listTeams(companyId = null) {
  return cache.getOrSet(listKey(companyId), cache.TTL.TEAMS, async () => {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('companyId', sql.BigInt, companyId)
      .query(`
      SELECT t.*,
        (
          SELECT COUNT(*) FROM [dbo].[NileChat_TeamMembers_byA] tm
          WHERE tm.team_id = t.id
        ) AS members_count
      FROM [dbo].[NileChat_Teams_byA] t
      WHERE (@companyId IS NULL OR t.company_id = @companyId)
      ORDER BY t.created_at ASC
    `);
    return result.recordset;
  });
}

async function getTeamById(id) {
  return cache.getOrSet(byIdKey(id), cache.TTL.TEAMS, async () => {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.BigInt, id)
      .query(`SELECT * FROM [dbo].[NileChat_Teams_byA] WHERE id = @id`);
    return result.recordset[0] || null;
  });
}

async function createTeam({ name, description = null, icon = 'users-round', color = '#6C5CE7', routingStrategy = 'manual', createdBy = null, companyId = null }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('name', sql.NVarChar(150), name)
    .input('description', sql.NVarChar(300), description)
    .input('icon', sql.NVarChar(50), icon)
    .input('color', sql.NVarChar(20), color)
    .input('routingStrategy', sql.NVarChar(20), routingStrategy)
    .input('createdBy', sql.BigInt, createdBy)
    .input('companyId', sql.BigInt, companyId)
    .query(`
      INSERT INTO [dbo].[NileChat_Teams_byA] (name, description, icon, color, routing_strategy, created_by, company_id)
      OUTPUT INSERTED.*
      VALUES (@name, @description, @icon, @color, @routingStrategy, @createdBy, @companyId)
    `);
  await cache.del(listKey(companyId));
  return result.recordset[0];
}

async function updateTeam(id, { name, description = null, icon = 'users-round', color = '#6C5CE7', routingStrategy = 'manual' }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('name', sql.NVarChar(150), name)
    .input('description', sql.NVarChar(300), description)
    .input('icon', sql.NVarChar(50), icon)
    .input('color', sql.NVarChar(20), color)
    .input('routingStrategy', sql.NVarChar(20), routingStrategy)
    .query(`
      UPDATE [dbo].[NileChat_Teams_byA]
      SET name = @name, description = @description, icon = @icon,
          color = @color, routing_strategy = @routingStrategy
      OUTPUT INSERTED.*
      WHERE id = @id
    `);
  const updated = result.recordset[0] || null;
  if (updated) await cache.del([byIdKey(id), listKey(updated.company_id)]);
  return updated;
}

async function deleteTeam(id) {
  const pool = await getPool();
  await pool.request().input('id', sql.BigInt, id).query(`
    DELETE FROM [dbo].[NileChat_TeamMembers_byA] WHERE team_id = @id
  `);
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`DELETE FROM [dbo].[NileChat_Teams_byA] OUTPUT DELETED.id, DELETED.company_id WHERE id = @id`);
  const deleted = result.recordset[0] || null;
  if (deleted) await cache.del([byIdKey(id), listKey(deleted.company_id)]);
  return deleted;
}

async function getMembersForTeam(teamId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('teamId', sql.BigInt, teamId)
    .query(`
      SELECT u.id, u.email, u.role, u.status, u.display_name
      FROM [dbo].[NileChat_TeamMembers_byA] tm
      JOIN [dbo].[NileChat_Users_byA] u ON u.id = tm.user_id
      WHERE tm.team_id = @teamId
      ORDER BY u.email
    `);
  return result.recordset;
}

// بيمسح كل الأعضاء القدام ويحط القايمة الجديدة (تحديد كامل مش إضافة تراكمية، زي الـ Inboxes)
async function setMembersForTeam(teamId, userIds) {
  const pool = await getPool();
  await pool
    .request()
    .input('teamId', sql.BigInt, teamId)
    .query(`DELETE FROM [dbo].[NileChat_TeamMembers_byA] WHERE team_id = @teamId`);

  for (const userId of userIds) {
    await pool
      .request()
      .input('teamId', sql.BigInt, teamId)
      .input('userId', sql.BigInt, userId)
      .query(`
        INSERT INTO [dbo].[NileChat_TeamMembers_byA] (team_id, user_id)
        VALUES (@teamId, @userId)
      `);
  }

  // members_count بتتحسب جوه listTeams، فأي تغيير في الأعضاء لازم يبطّل الكاش
  // بتاعها — بنجيب company_id بتاع التيم ده (getTeamById نفسها متكاشة فمفيش
  // تكلفة استعلام إضافية أغلب الوقت) عشان نبطّل مفتاح القايمة الصح بالظبط
  const team = await getTeamById(teamId);
  if (team) await cache.del(listKey(team.company_id));
  return getMembersForTeam(teamId);
}

// كل التيمز المتحطة على محادثة معينة (نفس فكرة listLabelsForConversation بالظبط)
async function listTeamsForConversation(conversationId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('conversationId', sql.BigInt, conversationId)
    .query(`
      SELECT t.*
      FROM [dbo].[NileChat_ConversationTeams_byA] ct
      JOIN [dbo].[NileChat_Teams_byA] t ON t.id = ct.team_id
      WHERE ct.conversation_id = @conversationId
      ORDER BY ct.created_at ASC
    `);
  return result.recordset;
}

// بتحط تيم على محادثة (بتتجاهل بهدوء لو أصلاً متحط، بفضل UNIQUE constraint)
async function addTeamToConversation(conversationId, teamId) {
  const pool = await getPool();
  await pool
    .request()
    .input('conversationId', sql.BigInt, conversationId)
    .input('teamId', sql.BigInt, teamId)
    .query(`
      IF NOT EXISTS (
        SELECT 1 FROM [dbo].[NileChat_ConversationTeams_byA]
        WHERE conversation_id = @conversationId AND team_id = @teamId
      )
      INSERT INTO [dbo].[NileChat_ConversationTeams_byA] (conversation_id, team_id)
      VALUES (@conversationId, @teamId)
    `);
  return listTeamsForConversation(conversationId);
}

async function removeTeamFromConversation(conversationId, teamId) {
  const pool = await getPool();
  await pool
    .request()
    .input('conversationId', sql.BigInt, conversationId)
    .input('teamId', sql.BigInt, teamId)
    .query(`
      DELETE FROM [dbo].[NileChat_ConversationTeams_byA]
      WHERE conversation_id = @conversationId AND team_id = @teamId
    `);
  return listTeamsForConversation(conversationId);
}

module.exports = {
  listTeams,
  getTeamById,
  createTeam,
  updateTeam,
  deleteTeam,
  getMembersForTeam,
  setMembersForTeam,
  listTeamsForConversation,
  addTeamToConversation,
  removeTeamFromConversation,
};
