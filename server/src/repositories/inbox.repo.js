const { getPool, sql } = require('../database/connection');
const cache = require('../services/cache.service');

const listKey = (companyId) => cache.cacheKey('inboxes', 'list', companyId ?? 'all');
const agentsKey = (inboxId) => cache.cacheKey('inbox', inboxId, 'agents');

// كاش: inboxes:list:{companyId} (24h) — قايمة الـ Inboxes بتتغير بس من صفحة الإعدادات.
// ملحوظة مهمة: getInboxById/getDefaultActiveInbox/findInboxByPhoneNumberId
// عمدًا مش متكاشين — الأولانية مشتركة مع مسار إرسال رسائل الواتساب الصادرة
// (بتجيب access_token وقت الإرسال)، والتانيين على مسار الـ webhook الوارد من
// واتساب مباشرة.
async function listInboxes(companyId = null) {
  return cache.getOrSet(listKey(companyId), cache.TTL.SETTINGS, async () => {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('companyId', sql.BigInt, companyId)
      .query(`
      SELECT
        i.id, i.name, i.channel_type, i.api_provider, i.phone_number, i.phone_number_id,
        i.business_account_id, i.verified_name, i.display_phone_number, i.status, i.created_at
        , (SELECT COUNT(*) FROM [dbo].[NileChat_InboxAgents_byA] ia WHERE ia.inbox_id = i.id) AS agents_count
      FROM [dbo].[NileChat_Inboxes_byA] i
      WHERE (@companyId IS NULL OR i.company_id = @companyId)
      ORDER BY i.created_at DESC
    `);
    return result.recordset;
  });
}

async function getInboxById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`SELECT * FROM [dbo].[NileChat_Inboxes_byA] WHERE id = @id`);
  return result.recordset[0] || null;
}

// بتسجل/تعدّل Business Account ID (WABA ID) بتاع الـ Inbox — سواء من الاكتشاف
// التلقائي (whatsapp.service.js) أو من تعديل يدوي في الإعدادات
async function setBusinessAccountId(inboxId, businessAccountId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, inboxId)
    .input('businessAccountId', sql.NVarChar(100), businessAccountId)
    .query(`
      UPDATE [dbo].[NileChat_Inboxes_byA]
      SET business_account_id = @businessAccountId
      OUTPUT INSERTED.id, INSERTED.business_account_id, INSERTED.company_id
      WHERE id = @id
    `);
  const updated = result.recordset[0] || null;
  if (updated) await cache.del(listKey(updated.company_id));
  return updated;
}

// بتسجل الـ id بتاع WhatsApp Flow "تقييم ما بعد الحل" بعد ما يتعمله publish
// مرة واحدة لهذا الـ Inbox، عشان مانعملوش Flow جديد كل مرة تتقفل فيها محادثة
async function setRatingFlowId(inboxId, flowId) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, inboxId)
    .input('flowId', sql.NVarChar(100), flowId)
    .query(`UPDATE [dbo].[NileChat_Inboxes_byA] SET rating_flow_id = @flowId WHERE id = @id`);
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
  companyId = null,
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
    .input('companyId', sql.BigInt, companyId)
    .query(`
      INSERT INTO [dbo].[NileChat_Inboxes_byA]
        (name, channel_type, api_provider, phone_number, phone_number_id,
         access_token, verified_name, display_phone_number, status, created_by, company_id)
      OUTPUT INSERTED.id, INSERTED.name, INSERTED.channel_type, INSERTED.api_provider, INSERTED.phone_number,
             INSERTED.phone_number_id, INSERTED.business_account_id, INSERTED.verified_name,
             INSERTED.display_phone_number, INSERTED.status, INSERTED.created_at
      VALUES
        (@name, 'whatsapp', 'whatsapp_cloud', @phoneNumber, @phoneNumberId,
         @accessToken, @verifiedName, @displayPhoneNumber, 'active', @createdBy, @companyId)
    `);
  await cache.del(listKey(companyId));
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
      OUTPUT INSERTED.id, INSERTED.status, INSERTED.company_id
      WHERE id = @id
    `);
  const updated = result.recordset[0] || null;
  if (updated) await cache.del(listKey(updated.company_id));
  return updated;
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
    .query(`DELETE FROM [dbo].[NileChat_Inboxes_byA] OUTPUT DELETED.id, DELETED.company_id WHERE id = @id`);
  const deleted = result.recordset[0] || null;
  if (deleted) await cache.del([listKey(deleted.company_id), agentsKey(id)]);
  return deleted;
}

// كاش: inbox:{id}:agents (24h) — لستة الإيجنتس المعينين على Inbox معين، بتتغير
// بس من setAgentsForInbox (تعيين/إزالة إيجنتس من صفحة الإعدادات)
async function getAgentsForInbox(inboxId) {
  return cache.getOrSet(agentsKey(inboxId), cache.TTL.SETTINGS, async () => {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('inboxId', sql.BigInt, inboxId)
      .query(`
        SELECT u.id, u.email, u.role, u.status, u.display_name
        FROM [dbo].[NileChat_InboxAgents_byA] ia
        JOIN [dbo].[NileChat_Users_byA] u ON u.id = ia.user_id
        WHERE ia.inbox_id = @inboxId
        ORDER BY u.email
      `);
    return result.recordset;
  });
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

  // agents_count بتتحسب جوه listInboxes، فلازم نبطّل الاتنين — بنجيب company_id
  // بتاع الإنبوكس ده عشان نبطّل مفتاح القايمة الصح بالظبط
  const inbox = await getInboxById(inboxId);
  await cache.del([agentsKey(inboxId), listKey(inbox ? inbox.company_id : null)]);
  return getAgentsForInbox(inboxId);
}

module.exports = {
  listInboxes,
  getInboxById,
  setBusinessAccountId,
  setRatingFlowId,
  getDefaultActiveInbox,
  findInboxByPhoneNumberId,
  findInboxByPhoneNumberIdExcluding,
  createWhatsappInbox,
  updateInboxStatus,
  deleteInbox,
  getAgentsForInbox,
  setAgentsForInbox,
};
