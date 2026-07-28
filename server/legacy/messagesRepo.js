const { getPool, sql, TABLE_NAME } = require('./db');

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

module.exports = { saveMessage, saveStatusUpdate };
