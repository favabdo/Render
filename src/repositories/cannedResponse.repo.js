const { getPool, sql } = require('../config/db');

async function listCannedResponses() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT cr.*, COALESCE(u.display_name, u.email) AS created_by_name
    FROM [dbo].[NileChat_CannedResponses_byA] cr
    LEFT JOIN [dbo].[NileChat_Users_byA] u ON u.id = cr.created_by
    ORDER BY COALESCE(cr.sort_order, 999999999) ASC, cr.created_at ASC
  `);
  return result.recordset;
}

async function createCannedResponse({ label, messageText, createdBy = null }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('label', sql.NVarChar(200), label)
    .input('messageText', sql.NVarChar(sql.MAX), messageText)
    .input('createdBy', sql.BigInt, createdBy)
    .query(`
      DECLARE @nextOrder INT = (SELECT ISNULL(MAX(sort_order), 0) + 1 FROM [dbo].[NileChat_CannedResponses_byA]);
      INSERT INTO [dbo].[NileChat_CannedResponses_byA] (label, message_text, created_by, sort_order)
      OUTPUT INSERTED.*
      VALUES (@label, @messageText, @createdBy, @nextOrder)
    `);
  return result.recordset[0];
}

async function updateCannedResponse(id, { label, messageText }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('label', sql.NVarChar(200), label)
    .input('messageText', sql.NVarChar(sql.MAX), messageText)
    .query(`
      UPDATE [dbo].[NileChat_CannedResponses_byA]
      SET label = @label, message_text = @messageText
      OUTPUT INSERTED.*
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

async function deleteCannedResponse(id) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`DELETE FROM [dbo].[NileChat_CannedResponses_byA] WHERE id = @id`);
}

// بيستقبل مصفوفة IDs بالترتيب الجديد اللي الإيجنت رتبها بالسحب (drag & drop) في الواجهة،
// وبيحفظ رقم كل واحد فيهم كـ sort_order (index + 1) عشان يفضل محفوظ حتى بعد الـ refresh
async function reorderCannedResponses(orderedIds) {
  const pool = await getPool();
  const transaction = pool.transaction();
  await transaction.begin();
  try {
    for (let i = 0; i < orderedIds.length; i++) {
      await transaction
        .request()
        .input('id', sql.BigInt, orderedIds[i])
        .input('sortOrder', sql.Int, i + 1)
        .query(`UPDATE [dbo].[NileChat_CannedResponses_byA] SET sort_order = @sortOrder WHERE id = @id`);
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = {
  listCannedResponses,
  createCannedResponse,
  updateCannedResponse,
  deleteCannedResponse,
  reorderCannedResponses,
};
