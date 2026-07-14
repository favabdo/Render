const { getPool, sql } = require('../config/db');

// بيسجل إشعار واحد ليوزر واحد — status بيتحط 1 (جديد) دايمًا وقت الإنشاء
async function createNotification({
  userId,
  type,
  title = null,
  message = null,
  referenceId = null,
  actorId = null,
  actorName = null,
}) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('userId', sql.BigInt, userId)
    .input('type', sql.NVarChar(50), type)
    .input('title', sql.NVarChar(300), title)
    .input('message', sql.NVarChar(sql.MAX), message)
    .input('referenceId', sql.BigInt, referenceId)
    .input('actorId', sql.BigInt, actorId)
    .input('actorName', sql.NVarChar(200), actorName)
    .query(`
      INSERT INTO [dbo].[NileChat_Notifications_byA]
        (user_id, type, title, message, reference_id, status, actor_id, actor_name)
      OUTPUT INSERTED.*
      VALUES (@userId, @type, @title, @message, @referenceId, 1, @actorId, @actorName)
    `);
  return result.recordset[0];
}

// نفس createNotification بس لأكتر من يوزر مرة واحدة (زي "activity" اللي بتوصل للكل)
async function createNotificationForUsers(userIds, payload) {
  const uniqueIds = [...new Set((userIds || []).map((id) => String(id)))];
  if (uniqueIds.length === 0) return [];
  const results = await Promise.all(
    uniqueIds.map((userId) => createNotification({ ...payload, userId }))
  );
  return results;
}

async function listForUser(userId, { limit = 100 } = {}) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('userId', sql.BigInt, userId)
    .input('limit', sql.Int, limit)
    .query(`
      SELECT TOP (@limit) *
      FROM [dbo].[NileChat_Notifications_byA]
      WHERE user_id = @userId
      ORDER BY created_at DESC
    `);
  return result.recordset;
}

async function countUnreadForUser(userId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('userId', sql.BigInt, userId)
    .query(`
      SELECT COUNT(*) AS total
      FROM [dbo].[NileChat_Notifications_byA]
      WHERE user_id = @userId AND status = 1
    `);
  return result.recordset[0].total;
}

// بيغيّر حالة إشعار واحد بتاع اليوزر نفسه بس (status: 1 = جديد، 0 = مقروء)
async function setStatus(id, userId, status) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('userId', sql.BigInt, userId)
    .input('status', sql.Int, status)
    .query(`
      UPDATE [dbo].[NileChat_Notifications_byA]
      SET status = @status
      OUTPUT INSERTED.*
      WHERE id = @id AND user_id = @userId
    `);
  return result.recordset[0] || null;
}

// تعليم كل إشعارات اليوزر الحالية (الجديدة) كمقروءة دفعة واحدة
async function markAllRead(userId) {
  const pool = await getPool();
  await pool
    .request()
    .input('userId', sql.BigInt, userId)
    .query(`
      UPDATE [dbo].[NileChat_Notifications_byA]
      SET status = 0
      WHERE user_id = @userId AND status = 1
    `);
}

module.exports = {
  createNotification,
  createNotificationForUsers,
  listForUser,
  countUnreadForUser,
  setStatus,
  markAllRead,
};
