const { getPool, sql } = require('../config/db');

async function listResolveCategories() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT rc.*, COALESCE(u.display_name, u.email) AS created_by_name
    FROM [dbo].[NileChat_ResolveCategories_byA] rc
    LEFT JOIN [dbo].[NileChat_Users_byA] u ON u.id = rc.created_by
    ORDER BY rc.created_at ASC
  `);
  return result.recordset;
}

async function createResolveCategory({ name, icon = null, description = null, color = null, createdBy = null }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('name', sql.NVarChar(150), name)
    .input('icon', sql.NVarChar(20), icon)
    .input('description', sql.NVarChar(300), description)
    .input('color', sql.NVarChar(50), color)
    .input('createdBy', sql.BigInt, createdBy)
    .query(`
      INSERT INTO [dbo].[NileChat_ResolveCategories_byA] (name, icon, description, color, created_by)
      OUTPUT INSERTED.*
      VALUES (@name, @icon, @description, @color, @createdBy)
    `);
  return result.recordset[0];
}

async function updateResolveCategory(id, { name, icon = null, description = null, color = null }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('name', sql.NVarChar(150), name)
    .input('icon', sql.NVarChar(20), icon)
    .input('description', sql.NVarChar(300), description)
    .input('color', sql.NVarChar(50), color)
    .query(`
      UPDATE [dbo].[NileChat_ResolveCategories_byA]
      SET name = @name, icon = @icon, description = @description, color = @color
      OUTPUT INSERTED.*
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

async function deleteResolveCategory(id) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`DELETE FROM [dbo].[NileChat_ResolveCategories_byA] WHERE id = @id`);
}

module.exports = {
  listResolveCategories,
  createResolveCategory,
  updateResolveCategory,
  deleteResolveCategory,
};
