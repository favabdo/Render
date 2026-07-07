const { getPool, sql } = require('../config/db');

async function listResolveCategories() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT rc.*, COALESCE(u.display_name, u.email) AS created_by_name
    FROM [dbo].[NileChat_ResolveCategories_byA] rc
    LEFT JOIN [dbo].[NileChat_Users_byA] u ON u.id = rc.created_by
    ORDER BY COALESCE(rc.sort_order, 999999999) ASC, rc.created_at ASC
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
      DECLARE @nextOrder INT = (SELECT ISNULL(MAX(sort_order), 0) + 1 FROM [dbo].[NileChat_ResolveCategories_byA]);
      INSERT INTO [dbo].[NileChat_ResolveCategories_byA] (name, icon, description, color, created_by, sort_order)
      OUTPUT INSERTED.*
      VALUES (@name, @icon, @description, @color, @createdBy, @nextOrder)
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

// بيستقبل مصفوفة IDs بالترتيب الجديد اللي الإيجنت رتبها بالسحب (drag & drop) في الواجهة،
// وبيحفظ رقم كل واحد فيهم كـ sort_order (index + 1) عشان يفضل محفوظ حتى بعد الـ refresh
async function reorderResolveCategories(orderedIds) {
  const pool = await getPool();
  const transaction = pool.transaction();
  await transaction.begin();
  try {
    for (let i = 0; i < orderedIds.length; i++) {
      await transaction
        .request()
        .input('id', sql.BigInt, orderedIds[i])
        .input('sortOrder', sql.Int, i + 1)
        .query(`UPDATE [dbo].[NileChat_ResolveCategories_byA] SET sort_order = @sortOrder WHERE id = @id`);
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = {
  listResolveCategories,
  createResolveCategory,
  updateResolveCategory,
  deleteResolveCategory,
  reorderResolveCategories,
};
