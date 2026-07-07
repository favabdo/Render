const { getPool, sql } = require('../config/db');

async function listCannedResponses() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT cr.*, COALESCE(u.display_name, u.email) AS created_by_name
    FROM [dbo].[NileChat_CannedResponses_byA] cr
    LEFT JOIN [dbo].[NileChat_Users_byA] u ON u.id = cr.created_by
    ORDER BY cr.created_at ASC
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
      INSERT INTO [dbo].[NileChat_CannedResponses_byA] (label, message_text, created_by)
      OUTPUT INSERTED.*
      VALUES (@label, @messageText, @createdBy)
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

module.exports = {
  listCannedResponses,
  createCannedResponse,
  updateCannedResponse,
  deleteCannedResponse,
};
