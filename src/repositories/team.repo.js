const { getPool, sql } = require('../config/db');

// كل التيمز، مع عدد الإيجنتس المنضمين لكل تيم (بيتعرض في كارت التيم بصفحة الإعدادات)
async function listTeams() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT t.*,
      (
        SELECT COUNT(*) FROM [dbo].[NileChat_TeamMembers_byA] tm
        WHERE tm.team_id = t.id
      ) AS members_count
    FROM [dbo].[NileChat_Teams_byA] t
    ORDER BY t.created_at ASC
  `);
  return result.recordset;
}

async function getTeamById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`SELECT * FROM [dbo].[NileChat_Teams_byA] WHERE id = @id`);
  return result.recordset[0] || null;
}

async function createTeam({ name, description = null, icon = 'users-round', color = '#6C5CE7', routingStrategy = 'manual', createdBy = null }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('name', sql.NVarChar(150), name)
    .input('description', sql.NVarChar(300), description)
    .input('icon', sql.NVarChar(50), icon)
    .input('color', sql.NVarChar(20), color)
    .input('routingStrategy', sql.NVarChar(20), routingStrategy)
    .input('createdBy', sql.BigInt, createdBy)
    .query(`
      INSERT INTO [dbo].[NileChat_Teams_byA] (name, description, icon, color, routing_strategy, created_by)
      OUTPUT INSERTED.*
      VALUES (@name, @description, @icon, @color, @routingStrategy, @createdBy)
    `);
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
  return result.recordset[0] || null;
}

async function deleteTeam(id) {
  const pool = await getPool();
  await pool.request().input('id', sql.BigInt, id).query(`
    DELETE FROM [dbo].[NileChat_TeamMembers_byA] WHERE team_id = @id
  `);
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`DELETE FROM [dbo].[NileChat_Teams_byA] OUTPUT DELETED.id WHERE id = @id`);
  return result.recordset[0] || null;
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
