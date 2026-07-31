// repositories/externalConversation.repo.js
// محادثات الجهة الخارجية (شات ووت). ملحوظة مهمة: nile_conversation_id هنا
// مختلف في الفلسفة عن nile_contact_id/nile_user_id — مش "ميرج" اختياري بيعمله
// إيجنت، ده ربط تقني لازم يحصل عشان المحادثة أصلًا تظهر وتترد عليها من لوحة
// نايل شات (بيتحدد فور الإنشاء عن طريق linkNileConversation في خدمة الـ ingest،
// مش سايبينه فاضي لحد الأبد زي الكونتاكت/الإيجنت)

const { getPool, sql } = require('../database/connection');

async function findByProviderAndExternalId(providerId, externalConversationId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('providerId', sql.BigInt, providerId)
    .input('externalConversationId', sql.NVarChar(100), String(externalConversationId))
    .query(`
      SELECT * FROM [dbo].[External_Conversation_byA]
      WHERE provider_id = @providerId AND external_conversation_id = @externalConversationId
    `);
  return result.recordset[0] || null;
}

async function findByNileConversationId(nileConversationId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('nileConversationId', sql.BigInt, nileConversationId)
    .query(`SELECT * FROM [dbo].[External_Conversation_byA] WHERE nile_conversation_id = @nileConversationId`);
  return result.recordset[0] || null;
}

// نفس الدالة اللي فوق بس بترجع بيانات الـ provider (base_url/token/account_id)
// معاها في نفس النتيجة — مستخدمة وقت الرد (sendReplyLive) عشان نعرف نبعت
// لشات ووت من غير ما نعمل استعلام تاني منفصل
async function findByNileConversationIdWithProvider(nileConversationId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('nileConversationId', sql.BigInt, nileConversationId)
    .query(`
      SELECT ec.*,
        p.base_url AS provider_base_url,
        p.account_id AS provider_account_id,
        p.api_access_token AS provider_api_access_token,
        p.is_active AS provider_is_active,
        p.name AS provider_name
      FROM [dbo].[External_Conversation_byA] ec
      JOIN [dbo].[External_Provider_byA] p ON p.id = ec.provider_id
      WHERE ec.nile_conversation_id = @nileConversationId
    `);
  return result.recordset[0] || null;
}

async function createExternalConversation(providerId, externalConversationId, { externalContactRowId, status, rawJson }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('providerId', sql.BigInt, providerId)
    .input('externalConversationId', sql.NVarChar(100), String(externalConversationId))
    .input('externalContactRowId', sql.BigInt, externalContactRowId || null)
    .input('status', sql.NVarChar(50), status || null)
    .input('rawJson', sql.NVarChar(sql.MAX), rawJson || null)
    .query(`
      INSERT INTO [dbo].[External_Conversation_byA]
        (provider_id, external_conversation_id, nile_conversation_id, external_contact_row_id, status, raw_json)
      OUTPUT INSERTED.*
      VALUES (@providerId, @externalConversationId, NULL, @externalContactRowId, @status, @rawJson)
    `);
  return result.recordset[0];
}

// بيربط الصف الخارجي بالمحادثة الحقيقية اللي اتعملها إنشاء في NileChat_Conversations_byA
async function linkNileConversation(externalConversationRowId, nileConversationId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, externalConversationRowId)
    .input('nileConversationId', sql.BigInt, nileConversationId)
    .query(`
      UPDATE [dbo].[External_Conversation_byA] SET nile_conversation_id = @nileConversationId, updated_at = SYSUTCDATETIME()
      OUTPUT INSERTED.*
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

async function updateStatus(externalConversationRowId, status) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, externalConversationRowId)
    .input('status', sql.NVarChar(50), status || null)
    .query(`UPDATE [dbo].[External_Conversation_byA] SET status = @status, updated_at = SYSUTCDATETIME() WHERE id = @id`);
}

module.exports = {
  findByProviderAndExternalId,
  findByNileConversationId,
  findByNileConversationIdWithProvider,
  createExternalConversation,
  linkNileConversation,
  updateStatus,
};
