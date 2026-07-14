// repositories/rating.repo.js
// سجل تقييمات "ما بعد الحل" (Post-Resolve Rating): صف واحد لكل محادثة اتقفلت
// وقاعدة الأتمتة كانت مفعّلة، بيتحدّث خطوة بخطوة (stage) مع كل رد بيبعته العميل
const { getPool, sql } = require('../config/db');

const SELECT_COLUMNS = `
  id, conversation_id, contact_id, contact_number, inbox_id, agent_id, agent_name,
  stage, issue_rating, agent_rating, feedback_text, created_at, updated_at, completed_at
`;

// بيفتح طلب تقييم جديد لمحادثة اتقفلت — أول خطوة دايمًا "تقييم حل المشكلة"
async function createRatingRequest({ conversationId, contactId, contactNumber, inboxId, agentId, agentName }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('conversationId', sql.BigInt, conversationId)
    .input('contactId', sql.BigInt, contactId || null)
    .input('contactNumber', sql.NVarChar(30), contactNumber)
    .input('inboxId', sql.BigInt, inboxId || null)
    .input('agentId', sql.BigInt, agentId || null)
    .input('agentName', sql.NVarChar(200), agentName || null)
    .query(`
      INSERT INTO [dbo].[NileChat_ConversationRatings_byA]
        (conversation_id, contact_id, contact_number, inbox_id, agent_id, agent_name, stage)
      OUTPUT INSERTED.*
      VALUES (@conversationId, @contactId, @contactNumber, @inboxId, @agentId, @agentName, 'awaiting_issue_rating')
    `);
  return result.recordset[0];
}

// آخر طلب تقييم لسه مش خلصان (stage != 'completed') لرقم تليفون معين — بيتستخدم
// لما رسالة جديدة توصل من العميل ده عشان نعرف نفسرها كـ رد تقييم ولا لأ
async function getPendingRatingByContactNumber(contactNumber) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contactNumber', sql.NVarChar(30), contactNumber)
    .query(`
      SELECT TOP 1 ${SELECT_COLUMNS}
      FROM [dbo].[NileChat_ConversationRatings_byA]
      WHERE contact_number = @contactNumber AND stage != 'completed'
      ORDER BY created_at DESC
    `);
  return result.recordset[0] || null;
}

async function setIssueRatingAndAdvance(id, rating) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('rating', sql.Int, rating)
    .query(`
      UPDATE [dbo].[NileChat_ConversationRatings_byA]
      SET issue_rating = @rating, stage = 'awaiting_agent_rating', updated_at = SYSUTCDATETIME()
      OUTPUT INSERTED.*
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

async function setAgentRatingAndAdvance(id, rating) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('rating', sql.Int, rating)
    .query(`
      UPDATE [dbo].[NileChat_ConversationRatings_byA]
      SET agent_rating = @rating, stage = 'awaiting_feedback', updated_at = SYSUTCDATETIME()
      OUTPUT INSERTED.*
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

// بتقفل الفلو — feedbackText ممكن يكون null لو العميل اختار يتخطى الخطوة النصية
async function completeWithFeedback(id, feedbackText) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('feedbackText', sql.NVarChar(sql.MAX), feedbackText || null)
    .query(`
      UPDATE [dbo].[NileChat_ConversationRatings_byA]
      SET feedback_text = @feedbackText, stage = 'completed', updated_at = SYSUTCDATETIME(), completed_at = SYSUTCDATETIME()
      OUTPUT INSERTED.*
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

// كل التقييمات المكتملة (لصفحة تقارير/رضا العملاء لو اتضافت بعدين)
async function listCompletedRatings({ limit = 200 } = {}) {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP ${Number(limit) || 200} ${SELECT_COLUMNS}
    FROM [dbo].[NileChat_ConversationRatings_byA]
    WHERE stage = 'completed'
    ORDER BY completed_at DESC
  `);
  return result.recordset;
}

module.exports = {
  createRatingRequest,
  getPendingRatingByContactNumber,
  setIssueRatingAndAdvance,
  setAgentRatingAndAdvance,
  completeWithFeedback,
  listCompletedRatings,
};
