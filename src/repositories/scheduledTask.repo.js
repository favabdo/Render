// repositories/scheduledTask.repo.js
// التاسكات المجدولة (Scheduled Tasks) الخاصة بكل عميل (كونتاكت) — مخزّنة في
// NileChat_ScheduledTasks_byA. التاسك لما تتقفل بتتحول status='ended' نهائيًا
// (مفيش reopen خالص) — بتفضل موجودة في الأرشيف (Ended Tasks) بس، مش بتتمسح.
//
// التاسك مرتبطة بالعميل عن طريق contact_id (الكود) مش عن طريق اسمه — عمود
// customer_name القديم لسه موجود في الجدول كـ fallback بس (لو حصل واتمسح
// الكونتاكت نفسه لأي سبب)، لكن في كل القراءات هنا بنجيب الاسم لايف من جدول
// الكونتاكتس عن طريق الـ JOIN، فلو الإيجنت غيّر اسم العميل بعد كده، الاسم
// المعروض في كارت التاسك (حتى القديمة المقفولة) بيتحدّث لوحده تلقائيًا.
const { getPool, sql } = require('../config/db');

// نفس عمود الـ SELECT في كل الاستعلامات: بيرجع بيانات التاسك زي ما هي، وبيجيب
// اسم العميل الحالي (المحدّث) من جدول الكونتاكتس بدل الاسم المجمّد وقت الإضافة
const SELECT_COLUMNS = `
  t.id, t.contact_id, t.task_text, t.agent_id, t.agent_name, t.status,
  t.due_date, t.created_at, t.ended_at, t.delivery_status,
  COALESCE(ct.name, t.customer_name) AS customer_name
`;
const JOIN_CONTACTS = `
  FROM [dbo].[NileChat_ScheduledTasks_byA] t
  LEFT JOIN [dbo].[NileChat_Contacts_byA] ct ON ct.id = t.contact_id
`;

async function listScheduledTasksForContact(contactId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contactId', sql.BigInt, contactId)
    .query(`
      SELECT ${SELECT_COLUMNS} ${JOIN_CONTACTS}
      WHERE t.contact_id = @contactId
      ORDER BY t.created_at DESC
    `);
  return result.recordset;
}

// كل التاسكات من كل العملاء — مستخدمة في صفحة "Scheduled Tasks" في السايد بار
async function listAllScheduledTasks() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ${SELECT_COLUMNS} ${JOIN_CONTACTS}
    ORDER BY t.created_at DESC
  `);
  return result.recordset;
}

async function getScheduledTaskById(taskId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, taskId)
    .query(`SELECT ${SELECT_COLUMNS} ${JOIN_CONTACTS} WHERE t.id = @id`);
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
      OUTPUT INSERTED.id
      VALUES (@contactId, @customerName, @taskText, @agentId, @agentName, 'open', @dueDate)
    `);
  // بنرجع الصف كامل عن طريق نفس دالة الـ JOIN عشان الرد يرجع فيه الاسم اللايف
  // من الأول، بنفس الشكل بالظبط اللي هيتعرض بيه بعد كده في أي قراءة تانية
  return getScheduledTaskById(result.recordset[0].id);
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
      OUTPUT INSERTED.id
      WHERE id = @id AND status = 'open'
    `);
  if (!result.recordset[0]) return null;
  return getScheduledTaskById(result.recordset[0].id);
}

module.exports = {
  listScheduledTasksForContact,
  listAllScheduledTasks,
  getScheduledTaskById,
  addScheduledTask,
  endScheduledTask,
};
