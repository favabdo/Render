// repositories/scheduledTask.repo.js
// التاسكات المجدولة (Scheduled Tasks) الخاصة بكل عميل (كونتاكت) — مخزّنة في
// NileChat_ScheduledTasks_byA. التاسك لما تتقفل بتتحول status='ended' نهائيًا
// (مفيش reopen خالص) — بتفضل موجودة في الأرشيف (Ended Tasks) بس، مش بتتمسح.
const { getPool, sql } = require('../config/db');

async function listScheduledTasksForContact(contactId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contactId', sql.BigInt, contactId)
    .query(`
      SELECT * FROM [dbo].[NileChat_ScheduledTasks_byA]
      WHERE contact_id = @contactId
      ORDER BY created_at DESC
    `);
  return result.recordset;
}

// كل التاسكات من كل العملاء — مستخدمة في صفحة "Scheduled Tasks" في السايد بار
async function listAllScheduledTasks() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT * FROM [dbo].[NileChat_ScheduledTasks_byA]
    ORDER BY created_at DESC
  `);
  return result.recordset;
}

async function getScheduledTaskById(taskId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, taskId)
    .query(`SELECT * FROM [dbo].[NileChat_ScheduledTasks_byA] WHERE id = @id`);
  return result.recordset[0] || null;
}

async function addScheduledTask(contactId, { customerName, taskText, agentId, agentName, dueDate }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contactId', sql.BigInt, contactId)
    .input('customerName', sql.NVarChar(200), customerName || null)
    .input('taskText', sql.NVarChar(sql.MAX), taskText)
    .input('agentId', sql.BigInt, agentId || null)
    .input('agentName', sql.NVarChar(200), agentName || null)
    .input('dueDate', sql.Date, dueDate)
    .query(`
      INSERT INTO [dbo].[NileChat_ScheduledTasks_byA]
        (contact_id, customer_name, task_text, agent_id, agent_name, status, due_date)
      OUTPUT INSERTED.*
      VALUES (@contactId, @customerName, @taskText, @agentId, @agentName, 'open', @dueDate)
    `);
  return result.recordset[0];
}

// لما التاسك تتقفل، بنسجل معاد الإند (ended_at) وكمان بنحسب فورًا هل التسليم كان
// في الميعاد ولا متأخر: بنقارن تاريخ الإند (بالنهار بس، من غير وقت) بـ due_date
// المتفق عليه — لو الإند حصل في نفس يوم due_date أو قبله يبقى 'on_time'، ولو
// حصل بعد ما يوم التسليم عدى يبقى 'late'. القيمة دي بتتسجل مرة واحدة وبتفضل
// ثابتة (مش بتتغير لو حد رجع بص على التاسك بعد كده)
async function endScheduledTask(taskId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, taskId)
    .query(`
      UPDATE [dbo].[NileChat_ScheduledTasks_byA]
      SET status = 'ended',
          ended_at = SYSUTCDATETIME(),
          delivery_status = CASE
            WHEN CAST(SYSUTCDATETIME() AS DATE) <= due_date THEN 'on_time'
            ELSE 'late'
          END
      OUTPUT INSERTED.*
      WHERE id = @id AND status = 'open'
    `);
  return result.recordset[0] || null;
}

module.exports = {
  listScheduledTasksForContact,
  listAllScheduledTasks,
  getScheduledTaskById,
  addScheduledTask,
  endScheduledTask,
};
