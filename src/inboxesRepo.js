const { getPool, sql } = require('./db');

async function listInboxes() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      i.id, i.name, i.channel_type, i.api_provider, i.phone_number, i.phone_number_id,
      i.business_account_id, i.verified_name, i.display_phone_number, i.status, i.created_at,
      (SELECT COUNT(*) FROM [dbo].[NileChat_InboxAgents_byA] ia WHERE ia.inbox_id = i.id) AS agents_count
    FROM [dbo].[NileChat_Inboxes_byA] i
    ORDER BY i.created_at DESC
  `);
  return result.recordset;
}

async function getInboxById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`SELECT * FROM [dbo].[NileChat_Inboxes_byA] WHERE id = @id`);
  return result.recordset[0] || null;
}

// بيدور على أول Inbox شغال (لسه مستخدم كـ default) — بيفيد وقت الترحيل من نظام قديم كان شغال بمتغيرات .env بس
async function getDefaultActiveInbox() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP 1 * FROM [dbo].[NileChat_Inboxes_byA]
    WHERE status = 'active' AND channel_type = 'whatsapp'
    ORDER BY created_at ASC
  `);
  return result.recordset[0] || null;
}

// بيدور على الـ Inbox صاحب رقم الواتساب ده (phone_number_id بييجي من الـ webhook payload)
async function findInboxByPhoneNumberId(phoneNumberId) {
  if (!phoneNumberId) return null;
  const pool = await getPool();
  const result = await pool
    .request()
    .input('phoneNumberId', sql.NVarChar(100), phoneNumberId)
    .query(`
      SELECT * FROM [dbo].[NileChat_Inboxes_byA]
      WHERE phone_number_id = @phoneNumberId
    `);
  return result.recordset[0] || null;
}

async function createWhatsappInbox({
  name,
  phoneNumber,
  phoneNumberId,
  accessToken,
  verifiedName = null,
  displayPhoneNumber = null,
  createdBy = null,
}) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('name', sql.NVarChar(200), name)
    .input('phoneNumber', sql.NVarChar(30), phoneNumber)
    .input('phoneNumberId', sql.NVarChar(100), phoneNumberId)
    .input('accessToken', sql.NVarChar(1000), accessToken)
    .input('verifiedName', sql.NVarChar(200), verifiedName)
    .input('displayPhoneNumber', sql.NVarChar(50), displayPhoneNumber)
    .input('createdBy', sql.BigInt, createdBy)
    .query(`
      INSERT INTO [dbo].[NileChat_Inboxes_byA]
        (name, channel_type, api_provider, phone_number, phone_number_id,
         access_token, verified_name, display_phone_number, status, created_by)
      OUTPUT INSERTED.id, INSERTED.name, INSERTED.channel_type, INSERTED.api_provider, INSERTED.phone_number,
             INSERTED.phone_number_id, INSERTED.business_account_id, INSERTED.verified_name,
             INSERTED.display_phone_number, INSERTED.status, INSERTED.created_at
      VALUES
        (@name, 'whatsapp', 'whatsapp_cloud', @phoneNumber, @phoneNumberId,
         @accessToken, @verifiedName, @displayPhoneNumber, 'active', @createdBy)
    `);
  return result.recordset[0];
}

async function findInboxByPhoneNumberIdExcluding(phoneNumberId) {
  return findInboxByPhoneNumberId(phoneNumberId);
}

async function updateInboxStatus(id, status) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('status', sql.NVarChar(20), status)
    .query(`
      UPDATE [dbo].[NileChat_Inboxes_byA]
      SET status = @status
      OUTPUT INSERTED.id, INSERTED.status
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

async function deleteInbox(id) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`DELETE FROM [dbo].[NileChat_InboxAgents_byA] WHERE inbox_id = @id`);
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`DELETE FROM [dbo].[NileChat_Inboxes_byA] OUTPUT DELETED.id WHERE id = @id`);
  return result.recordset[0] || null;
}

async function getAgentsForInbox(inboxId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('inboxId', sql.BigInt, inboxId)
    .query(`
      SELECT u.id, u.email, u.role, u.status
      FROM [dbo].[NileChat_InboxAgents_byA] ia
      JOIN [dbo].[NileChat_Users_byA] u ON u.id = ia.user_id
      WHERE ia.inbox_id = @inboxId
      ORDER BY u.email
    `);
  return result.recordset;
}

// بيمسح كل الموظفين القدام ويحط القايمة الجديدة (زي Chatwoot: تحديد كامل مش إضافة تراكمية)
async function setAgentsForInbox(inboxId, userIds) {
  const pool = await getPool();
  await pool
    .request()
    .input('inboxId', sql.BigInt, inboxId)
    .query(`DELETE FROM [dbo].[NileChat_InboxAgents_byA] WHERE inbox_id = @inboxId`);

  for (const userId of userIds) {
    await pool
      .request()
      .input('inboxId', sql.BigInt, inboxId)
      .input('userId', sql.BigInt, userId)
      .query(`
        INSERT INTO [dbo].[NileChat_InboxAgents_byA] (inbox_id, user_id)
        VALUES (@inboxId, @userId)
      `);
  }

  return getAgentsForInbox(inboxId);
}

module.exports = {
  listInboxes,
  getInboxById,
  getDefaultActiveInbox,
  findInboxByPhoneNumberId,
  findInboxByPhoneNumberIdExcluding,
  createWhatsappInbox,
  updateInboxStatus,
  deleteInbox,
  getAgentsForInbox,
  setAgentsForInbox,
};
