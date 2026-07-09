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

module.exports = {
  listTeams,
  getTeamById,
  createTeam,
  updateTeam,
  deleteTeam,
  getMembersForTeam,
  setMembersForTeam,
};
