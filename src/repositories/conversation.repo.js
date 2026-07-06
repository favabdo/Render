const { getPool, sql, TABLE_NAME } = require('../config/db');

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
    SELECT c.*,
      COALESCE(u.display_name, u.email) AS assigned_agent_name,
      COALESCE(ru.display_name, ru.email) AS resolved_agent_name,
      i.name AS inbox_name,
      ct.name AS contact_display_name,
      COALESCE(ct.name, c.contact_name, c.contact_number) AS contact_resolved_name,
      (
        SELECT TOP 1 m.message_text
        FROM [dbo].[${TABLE_NAME}] m
        WHERE m.conversation_id = c.id AND m.direction != 'note'
        ORDER BY m.created_at DESC
      ) AS last_message_text,
      (
        -- بنجيب اتجاه آخر رسالة (in/out) عشان الفرونت إند يعرف يفرق بين
        -- رسالة جديدة جاية من العميل (لازم تتحسب unread) ورد بعته الإيجنت نفسه
        SELECT TOP 1 m.direction
        FROM [dbo].[${TABLE_NAME}] m
        WHERE m.conversation_id = c.id AND m.direction != 'note'
        ORDER BY m.created_at DESC
      ) AS last_message_direction,
      (
        -- إجمالي عدد الرسائل في المحادثة (مفيد لحساب/عرض العداد بدقة)
        SELECT COUNT(*)
        FROM [dbo].[${TABLE_NAME}] m
        WHERE m.conversation_id = c.id
      ) AS message_count
    FROM [dbo].[NileChat_Conversations_byA] c
    LEFT JOIN [dbo].[NileChat_Users_byA] u ON u.id = c.assigned_agent_id
    LEFT JOIN [dbo].[NileChat_Users_byA] ru ON ru.id = c.resolved_by
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
      SELECT c.*,
        COALESCE(u.display_name, u.email) AS assigned_agent_name,
        COALESCE(ru.display_name, ru.email) AS resolved_agent_name,
        i.name AS inbox_name,
        ct.name AS contact_display_name,
        COALESCE(ct.name, c.contact_name, c.contact_number) AS contact_resolved_name
      FROM [dbo].[NileChat_Conversations_byA] c
      LEFT JOIN [dbo].[NileChat_Users_byA] u ON u.id = c.assigned_agent_id
      LEFT JOIN [dbo].[NileChat_Users_byA] ru ON ru.id = c.resolved_by
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

// كل المحادثات السابقة (المفتوحة والمقفولة) الخاصة بنفس الكونتاكت، حتى لو كانت
// جاية من أرقام مختلفة مرتبطة بيه — عشان الإيجنت يقدر يشوف تاريخ العميل كله
// من غير ما يفوّت أي محادثة قديمة اتقفلت أو جاية من رقم تاني للعميل نفسه
async function getConversationsForContact(contactId, excludeConversationId = null) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contactId', sql.BigInt, contactId)
    .input('excludeId', sql.BigInt, excludeConversationId)
    .query(`
      SELECT c.*,
        COALESCE(u.display_name, u.email) AS assigned_agent_name,
        COALESCE(ru.display_name, ru.email) AS resolved_agent_name,
        (
          SELECT TOP 1 m.message_text
          FROM [dbo].[${TABLE_NAME}] m
          WHERE m.conversation_id = c.id AND m.direction != 'note'
          ORDER BY m.created_at DESC
        ) AS last_message_text,
        (
          SELECT COUNT(*)
          FROM [dbo].[${TABLE_NAME}] m
          WHERE m.conversation_id = c.id
        ) AS message_count
      FROM [dbo].[NileChat_Conversations_byA] c
      LEFT JOIN [dbo].[NileChat_Users_byA] u ON u.id = c.assigned_agent_id
      LEFT JOIN [dbo].[NileChat_Users_byA] ru ON ru.id = c.resolved_by
      WHERE c.contact_id = @contactId
        AND (@excludeId IS NULL OR c.id != @excludeId)
      ORDER BY c.last_message_at DESC
    `);
  return result.recordset;
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

/**
 * بيحفظ رسالة واحدة (وارد أو صادر) في الجدول
 */
async function saveMessage({
  waMessageId = null,
  conversationId = null,
  direction,
  fromNumber = null,
  toNumber = null,
  contactName = null,
  messageType = null,
  messageText = null,
  mediaUrl = null,
  status = null,
  rawPayload = null,
  sentByUserId = null,
  sentByName = null,
}) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('waMessageId', sql.NVarChar(100), waMessageId)
    .input('conversationId', sql.BigInt, conversationId)
    .input('direction', sql.NVarChar(10), direction)
    .input('fromNumber', sql.NVarChar(30), fromNumber)
    .input('toNumber', sql.NVarChar(30), toNumber)
    .input('contactName', sql.NVarChar(200), contactName)
    .input('messageType', sql.NVarChar(30), messageType)
    .input('messageText', sql.NVarChar(sql.MAX), messageText)
    .input('mediaUrl', sql.NVarChar(500), mediaUrl)
    .input('status', sql.NVarChar(30), status)
    .input('rawPayload', sql.NVarChar(sql.MAX), rawPayload)
    .input('sentByUserId', sql.BigInt, sentByUserId)
    .input('sentByName', sql.NVarChar(200), sentByName)
    .query(`
      INSERT INTO [dbo].[${TABLE_NAME}]
        (wa_message_id, conversation_id, direction, from_number, to_number, contact_name,
         message_type, message_text, media_url, status, raw_payload, sent_by_user_id, sent_by_name)
      OUTPUT INSERTED.*
      VALUES
        (@waMessageId, @conversationId, @direction, @fromNumber, @toNumber, @contactName,
         @messageType, @messageText, @mediaUrl, @status, @rawPayload, @sentByUserId, @sentByName)
    `);
  return result.recordset[0];
}

/**
 * بيحدّث حالة رسالة موجودة (sent/delivered/read/failed) لو وصل webhook status
 * هنا بنضيف سطر جديد بالحالة عشان نحتفظ بتاريخ كامل لكل التحديثات (audit trail)
 */
async function saveStatusUpdate({ waMessageId, status, rawPayload, conversationId = null }) {
  return saveMessage({
    waMessageId,
    conversationId,
    direction: 'status',
    status,
    rawPayload,
  });
}

/**
 * ملاحظة خاصة بين الإيجنتس على محادثة معينة — بتتخزن في نفس جدول الرسائل
 * (direction='note') بس متضمنش أي إرسال لواتساب، وبتتفلتر بره في كل الأماكن
 * اللي بتتعامل مع رسايل العميل (in/out) عشان العميل ميشوفهاش أبدًا.
 */
async function addPrivateNote(conversationId, { text, senderId, senderName }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('conversationId', sql.BigInt, conversationId)
    .input('messageText', sql.NVarChar(sql.MAX), text)
    .input('sentByUserId', sql.BigInt, senderId)
    .input('sentByName', sql.NVarChar(200), senderName)
    .query(`
      INSERT INTO [dbo].[${TABLE_NAME}] (conversation_id, direction, message_text, sent_by_user_id, sent_by_name)
      OUTPUT INSERTED.*
      VALUES (@conversationId, 'note', @messageText, @sentByUserId, @sentByName)
    `);
  return result.recordset[0];
}

/**
 * رسايل نظام (system messages) — بتتسجل في نفس جدول الرسائل (direction='system')
 * عشان تظهر جوه تايم لاين الشات بالظبط زي أي رسالة تانية، لكنها مش رسايل حقيقية
 * (مش بتتبعت لواتساب ومحدش بيشوفها غير الإيجنتس). النص بيتسجل جاهز (snapshot)
 * وقت حصول الحدث (زي "فلان عين المحادثة لنفسه") عشان لو الاسم اتغيّر بعدين
 * الرسالة القديمة تفضل زي ما هي.
 */
async function addSystemMessage(conversationId, text) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('conversationId', sql.BigInt, conversationId)
    .input('messageText', sql.NVarChar(sql.MAX), text)
    .query(`
      INSERT INTO [dbo].[${TABLE_NAME}] (conversation_id, direction, message_text)
      OUTPUT INSERTED.*
      VALUES (@conversationId, 'system', @messageText)
    `);
  return result.recordset[0];
}

/**
 * بتحدّث حالة رسالة صادرة (out) موجودة فعلاً — بندور عليها بالـ wa_message_id
 * (اللي رجعلنا من ميتا وقت الإرسال) وبنحدّث عمود status بتاعها فعليًا،
 * بدل ما نضيف سطر جديد منفصل (زي ما كان بيحصل قبل كده)، عشان الفرونت إند
 * يقدر يعرض تيك واحد (sent) / تيكين (delivered) / تيكين ملوّنين (read) على
 * نفس فقاعة الرسالة مباشرة.
 * بنحمي من إن تحديث متأخر/مكرر يرجّع الحالة للورا (مثلاً delivered بعد read)
 * عن طريق مقارنة "رتبة" الحالة الجديدة بالحالة الحالية قبل ما نحدّث.
 */
async function updateMessageStatusByWaId(waMessageId, status) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('waMessageId', sql.NVarChar(100), waMessageId)
    .input('status', sql.NVarChar(30), status)
    .query(`
      UPDATE [dbo].[${TABLE_NAME}]
      SET status = @status
      OUTPUT INSERTED.*
      WHERE wa_message_id = @waMessageId
        AND direction = 'out'
        AND (
          status IS NULL
          OR (
            CASE status
              WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0
            END
            <
            CASE @status
              WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0
            END
          )
        )
    `);
  return result.recordset[0] || null;
}

/**
 * بتقفل دورة حياة رسالة صادرة اتسجلت الأول بحالة 'sending' (قبل ما نستنى رد ميتا).
 * لما ميتا ترد بنجاح: بنسجل الـ wa_message_id الحقيقي ونحوّل الحالة لـ 'sent'.
 * لما ميتا ترفض/الاتصال يفشل: بنحوّل الحالة لـ 'failed' من غير wa_message_id.
 * (بنسجلها في الداتابيز بس للأرشفة — مفيش تيك في الواجهة يستخدمها).
 */
async function finalizeOutgoingMessage(id, { waMessageId = null, status }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('waMessageId', sql.NVarChar(100), waMessageId)
    .input('status', sql.NVarChar(30), status)
    .query(`
      UPDATE [dbo].[${TABLE_NAME}]
      SET status = @status,
          wa_message_id = COALESCE(@waMessageId, wa_message_id)
      OUTPUT INSERTED.*
      WHERE id = @id
    `);
  return result.recordset[0] || null;
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
  getConversationsForContact,
  saveMessage,
  saveStatusUpdate,
  addPrivateNote,
  addSystemMessage,
  updateMessageStatusByWaId,
  finalizeOutgoingMessage,
};
