const { getPool, sql, TABLE_NAME } = require('./db');

// بيدور على محادثة مفتوحة لنفس الرقم، ولو مش لاقي بينشئ واحدة جديدة
// inboxId: لو الرسالة جاية من Inbox معروف (رقم واتساب متضاف من صفحة الإعدادات) بنربط المحادثة بيه
// عشان لو حصل رد نبعته من نفس الرقم اللي العميل كلمنا منه بالظبط
// contactId: الكونتاكت الحقيقي اللي الرقم ده مرتبط بيه دلوقتي (ممكن يتغيّر لو حصل دمج بعدين،
// فبنعيد مزامنته في كل رسالة جديدة عشان يفضل متسق مع جدول ContactPhones)
async function findOrCreateConversation(contactNumber, contactName, inboxId = null, contactId = null) {
  const pool = await getPool();

  const existing = await pool
    .request()
    .input('contactNumber', sql.NVarChar(30), contactNumber)
    .query(`
      SELECT TOP 1 * FROM [dbo].[NileChat_Conversations_byA]
      WHERE contact_number = @contactNumber AND status != 'closed'
      ORDER BY created_at DESC
    `);

  if (existing.recordset.length > 0) {
    const convo = existing.recordset[0];
    // حدّث اسم العميل لو اتغيّر أو كان فاضي
    if (contactName && contactName !== convo.contact_name) {
      await pool
        .request()
        .input('id', sql.BigInt, convo.id)
        .input('contactName', sql.NVarChar(200), contactName)
        .query(`UPDATE [dbo].[NileChat_Conversations_byA] SET contact_name = @contactName WHERE id = @id`);
    }
    // لو المحادثة كانت من غير Inbox معروف وجالها inboxId دلوقتي، اربطها بيه
    if (inboxId && !convo.inbox_id) {
      await pool
        .request()
        .input('id', sql.BigInt, convo.id)
        .input('inboxId', sql.BigInt, inboxId)
        .query(`UPDATE [dbo].[NileChat_Conversations_byA] SET inbox_id = @inboxId WHERE id = @id`);
    }
    // زامن contact_id مع الكونتاكت الحالي بتاع الرقم (لو حصل دمج قبل كده، الرقم بقى ملك كونتاكت تاني)
    if (contactId && String(convo.contact_id || '') !== String(contactId)) {
      await pool
        .request()
        .input('id', sql.BigInt, convo.id)
        .input('contactId', sql.BigInt, contactId)
        .query(`UPDATE [dbo].[NileChat_Conversations_byA] SET contact_id = @contactId WHERE id = @id`);
    }
    return convo.id;
  }

  const inserted = await pool
    .request()
    .input('contactNumber', sql.NVarChar(30), contactNumber)
    .input('contactName', sql.NVarChar(200), contactName)
    .input('inboxId', sql.BigInt, inboxId)
    .input('contactId', sql.BigInt, contactId)
    .query(`
      INSERT INTO [dbo].[NileChat_Conversations_byA] (contact_number, contact_name, status, last_message_at, inbox_id, contact_id)
      OUTPUT INSERTED.id
      VALUES (@contactNumber, @contactName, 'open', SYSUTCDATETIME(), @inboxId, @contactId)
    `);

  return inserted.recordset[0].id;
}

// بتحدّث الكونتاكت المرتبط بمحادثة معينة (تُستخدم لما الإيجنت يدمج رقم مع كونتاكت تاني)
async function setConversationContact(conversationId, contactId) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, conversationId)
    .input('contactId', sql.BigInt, contactId)
    .query(`UPDATE [dbo].[NileChat_Conversations_byA] SET contact_id = @contactId WHERE id = @id`);
}

async function touchConversation(conversationId) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, conversationId)
    .query(`UPDATE [dbo].[NileChat_Conversations_byA] SET last_message_at = SYSUTCDATETIME() WHERE id = @id`);
}

async function listConversations() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT c.*, u.email AS assigned_agent_name, i.name AS inbox_name,
      ct.name AS contact_display_name,
      COALESCE(ct.name, c.contact_name, c.contact_number) AS contact_resolved_name,
      (
        SELECT TOP 1 m.message_text
        FROM [dbo].[${TABLE_NAME}] m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC
      ) AS last_message_text,
      (
        -- بنجيب اتجاه آخر رسالة (in/out) عشان الفرونت إند يعرف يفرق بين
        -- رسالة جديدة جاية من العميل (لازم تتحسب unread) ورد بعته الإيجنت نفسه
        SELECT TOP 1 m.direction
        FROM [dbo].[${TABLE_NAME}] m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC
      ) AS last_message_direction,
      (
        -- إجمالي عدد الرسائل في المحادثة (مفيد لحساب/عرض العداد بدقة)
        SELECT COUNT(*)
        FROM [dbo].[${TABLE_NAME}] m
        WHERE m.conversation_id = c.id
      ) AS message_count,
      (
        -- الليبلز المحطوطة على المحادثة دي (كـ JSON عشان نجيبهم في نفس الكويري
        -- من غير ما نعمل استعلام منفصل لكل محادثة في القايمة)
        SELECT l.id, l.name, l.color
        FROM [dbo].[NileChat_ConversationLabels_byA] cl
        JOIN [dbo].[NileChat_Labels_byA] l ON l.id = cl.label_id
        WHERE cl.conversation_id = c.id
        ORDER BY cl.created_at ASC
        FOR JSON PATH
      ) AS labels_json
    FROM [dbo].[NileChat_Conversations_byA] c
    LEFT JOIN [dbo].[NileChat_Users_byA] u ON u.id = c.assigned_agent_id
    LEFT JOIN [dbo].[NileChat_Inboxes_byA] i ON i.id = c.inbox_id
    LEFT JOIN [dbo].[NileChat_Contacts_byA] ct ON ct.id = c.contact_id
    ORDER BY c.last_message_at DESC
  `);
  return result.recordset;
}

async function getConversationById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`
      SELECT c.*, u.email AS assigned_agent_name, i.name AS inbox_name,
        ct.name AS contact_display_name,
        COALESCE(ct.name, c.contact_name, c.contact_number) AS contact_resolved_name
      FROM [dbo].[NileChat_Conversations_byA] c
      LEFT JOIN [dbo].[NileChat_Users_byA] u ON u.id = c.assigned_agent_id
      LEFT JOIN [dbo].[NileChat_Inboxes_byA] i ON i.id = c.inbox_id
      LEFT JOIN [dbo].[NileChat_Contacts_byA] ct ON ct.id = c.contact_id
      WHERE c.id = @id
    `);
  return result.recordset[0] || null;
}

async function assignConversation(conversationId, agentId) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, conversationId)
    .input('agentId', sql.BigInt, agentId)
    .query(`
      UPDATE [dbo].[NileChat_Conversations_byA]
      SET assigned_agent_id = @agentId, status = 'assigned'
      WHERE id = @id
    `);
}

// بتقفل المحادثة فعليًا في الداتابيز (مش شكليًا في الواجهة بس) وبتسجل مين حلها وإمتى وتحت أي تصنيف
async function resolveConversation(conversationId, { category = null, notes = null, resolvedBy = null } = {}) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, conversationId)
    .input('category', sql.NVarChar(150), category)
    .input('notes', sql.NVarChar(sql.MAX), notes)
    .input('resolvedBy', sql.BigInt, resolvedBy)
    .query(`
      UPDATE [dbo].[NileChat_Conversations_byA]
      SET status = 'closed',
          resolve_category = @category,
          resolve_notes = @notes,
          resolved_by = @resolvedBy,
          resolved_at = SYSUTCDATETIME()
      WHERE id = @id
    `);
}

// لو حبيت ترجّع محادثة اتقفلت تكون شغالة تاني (مثلاً العميل رجع يكلم تاني)
async function reopenConversation(conversationId) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, conversationId)
    .query(`
      UPDATE [dbo].[NileChat_Conversations_byA]
      SET status = 'open', resolve_category = NULL, resolve_notes = NULL, resolved_by = NULL, resolved_at = NULL
      WHERE id = @id
    `);
}

async function getMessagesForConversation(conversationId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('conversationId', sql.BigInt, conversationId)
    .query(`
      SELECT * FROM [dbo].[${TABLE_NAME}]
      WHERE conversation_id = @conversationId
      ORDER BY created_at ASC
    `);
  return result.recordset;
}

module.exports = {
  findOrCreateConversation,
  setConversationContact,
  touchConversation,
  listConversations,
  getConversationById,
  assignConversation,
  resolveConversation,
  reopenConversation,
  getMessagesForConversation,
};
