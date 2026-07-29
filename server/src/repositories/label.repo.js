const { getPool, sql } = require('../database/connection');
const cache = require('../services/cache.service');

// listKey لازم ياخد companyId في الاعتبار (زي team.repo.js بالظبط) عشان
// كاش ليبلز شركة معينة ميتشاركش مع شركة تانية
const listKey = (companyId) => cache.cacheKey('labels', 'list', companyId ?? 'all');

// كل الليبلز المتاحة في الشركة، مع عدد المحادثات المحطوط عليها كل ليبل
// (بيتعرض في صفحة الإعدادات زي عمود "Conversations")
// كاش: labels:list:{companyId} (24h) — الليبلز نفسها بتتغير بس من صفحة الإعدادات (أضف/عدّل/امسح)
async function listLabels(companyId = null) {
  return cache.getOrSet(listKey(companyId), cache.TTL.LABELS, async () => {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('companyId', sql.BigInt, companyId)
      .query(`
      SELECT l.*,
        COALESCE(u.display_name, u.email) AS created_by_name,
        (
          SELECT COUNT(*) FROM [dbo].[NileChat_ConversationLabels_byA] cl
          WHERE cl.label_id = l.id
        ) AS conversation_count
      FROM [dbo].[NileChat_Labels_byA] l
      LEFT JOIN [dbo].[NileChat_Users_byA] u ON u.id = l.created_by
      WHERE (@companyId IS NULL OR l.company_id = @companyId)
      ORDER BY l.created_at ASC
    `);
    return result.recordset;
  });
}

async function createLabel({ name, color = null, description = null, createdBy = null, companyId = null }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('name', sql.NVarChar(100), name)
    .input('color', sql.NVarChar(20), color)
    .input('description', sql.NVarChar(300), description)
    .input('createdBy', sql.BigInt, createdBy)
    .input('companyId', sql.BigInt, companyId)
    .query(`
      INSERT INTO [dbo].[NileChat_Labels_byA] (name, color, description, created_by, company_id)
      OUTPUT INSERTED.*
      VALUES (@name, @color, @description, @createdBy, @companyId)
    `);
  await cache.del(listKey(companyId));
  return result.recordset[0];
}

async function updateLabel(id, { name, color = null, description = null }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('name', sql.NVarChar(100), name)
    .input('color', sql.NVarChar(20), color)
    .input('description', sql.NVarChar(300), description)
    .query(`
      UPDATE [dbo].[NileChat_Labels_byA]
      SET name = @name, color = @color, description = @description
      OUTPUT INSERTED.*
      WHERE id = @id
    `);
  const updated = result.recordset[0] || null;
  if (updated) await cache.del(listKey(updated.company_id));
  return updated;
}

async function deleteLabel(id) {
  const pool = await getPool();
  // بنشيل الربط بأي محادثات الأول (مفيش FK cascade على الجداول دي) وبعدين الليبل نفسه
  await pool.request().input('id', sql.BigInt, id).query(`
    DELETE FROM [dbo].[NileChat_ConversationLabels_byA] WHERE label_id = @id
  `);
  const result = await pool.request().input('id', sql.BigInt, id).query(`
    DELETE FROM [dbo].[NileChat_Labels_byA] OUTPUT DELETED.company_id WHERE id = @id
  `);
  const deleted = result.recordset[0] || null;
  await cache.del(listKey(deleted ? deleted.company_id : null));
}

// كل الليبلز المتحطة على محادثة معينة
async function listLabelsForConversation(conversationId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('conversationId', sql.BigInt, conversationId)
    .query(`
      SELECT l.*
      FROM [dbo].[NileChat_ConversationLabels_byA] cl
      JOIN [dbo].[NileChat_Labels_byA] l ON l.id = cl.label_id
      WHERE cl.conversation_id = @conversationId
      ORDER BY cl.created_at ASC
    `);
  return result.recordset;
}

// بتحط ليبل على محادثة (بتتجاهل بهدوء لو أصلاً متحط، بفضل UNIQUE constraint)
async function addLabelToConversation(conversationId, labelId) {
  const pool = await getPool();
  await pool
    .request()
    .input('conversationId', sql.BigInt, conversationId)
    .input('labelId', sql.BigInt, labelId)
    .query(`
      IF NOT EXISTS (
        SELECT 1 FROM [dbo].[NileChat_ConversationLabels_byA]
        WHERE conversation_id = @conversationId AND label_id = @labelId
      )
      INSERT INTO [dbo].[NileChat_ConversationLabels_byA] (conversation_id, label_id)
      VALUES (@conversationId, @labelId)
    `);
  return listLabelsForConversation(conversationId);
}

async function removeLabelFromConversation(conversationId, labelId) {
  const pool = await getPool();
  await pool
    .request()
    .input('conversationId', sql.BigInt, conversationId)
    .input('labelId', sql.BigInt, labelId)
    .query(`
      DELETE FROM [dbo].[NileChat_ConversationLabels_byA]
      WHERE conversation_id = @conversationId AND label_id = @labelId
    `);
  return listLabelsForConversation(conversationId);
}

module.exports = {
  listLabels,
  createLabel,
  updateLabel,
  deleteLabel,
  listLabelsForConversation,
  addLabelToConversation,
  removeLabelFromConversation,
};
