// repositories/externalMessage.repo.js
// رسايل الجهة الخارجية (شات ووت). الاستخدام الأساسي: منع تكرار نفس الرسالة
// (idempotency) لو وصلت أكتر من مرة، وربطها بالرسالة الحقيقية عندنا لما تتسجل

const { getPool, sql } = require('../database/connection');

async function findByProviderAndExternalId(providerId, externalMessageId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('providerId', sql.BigInt, providerId)
    .input('externalMessageId', sql.NVarChar(100), String(externalMessageId))
    .query(`
      SELECT * FROM [dbo].[External_Messages_byA]
      WHERE provider_id = @providerId AND external_message_id = @externalMessageId
    `);
  return result.recordset[0] || null;
}

// بيسجل الرسالة الخارجية. لو نايل مسدج آي دي (nileMessageId) اتبعت، معناها
// الرسالة اتسجلت خلاص في جدول الرسايل الحقيقي واحنا بس بنربطها هنا
async function createExternalMessage(providerId, externalMessageId, { externalConversationRowId, nileMessageId, direction, messageType, rawJson }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('providerId', sql.BigInt, providerId)
    .input('externalMessageId', sql.NVarChar(100), String(externalMessageId))
    .input('externalConversationRowId', sql.BigInt, externalConversationRowId)
    .input('nileMessageId', sql.BigInt, nileMessageId || null)
    .input('direction', sql.NVarChar(10), direction)
    .input('messageType', sql.NVarChar(30), messageType || null)
    .input('rawJson', sql.NVarChar(sql.MAX), rawJson || null)
    .query(`
      INSERT INTO [dbo].[External_Messages_byA]
        (provider_id, external_message_id, external_conversation_row_id, nile_message_id, direction, message_type, raw_json)
      OUTPUT INSERTED.*
      VALUES (@providerId, @externalMessageId, @externalConversationRowId, @nileMessageId, @direction, @messageType, @rawJson)
    `);
  return result.recordset[0];
}

async function linkNileMessage(externalMessageRowId, nileMessageId) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, externalMessageRowId)
    .input('nileMessageId', sql.BigInt, nileMessageId)
    .query(`UPDATE [dbo].[External_Messages_byA] SET nile_message_id = @nileMessageId WHERE id = @id`);
}

module.exports = {
  findByProviderAndExternalId,
  createExternalMessage,
  linkNileMessage,
};
