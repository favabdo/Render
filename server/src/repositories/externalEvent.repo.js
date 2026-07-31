// repositories/externalEvent.repo.js
// سجل idempotency لكل event وارد من الجهة الخارجية (شات ووت). بيمنع معالجة
// نفس الحدث مرتين لو حصل retry من عندهم (زي ميتا بالظبط)

const { getPool, sql } = require('../database/connection');

// بيسجل الحدث بحالة 'pending' فورًا. لو عنده external_event_id واتسجل قبل كده
// (retry حقيقي من الجهة الخارجية)، بيرجع الصف القديم بدل ما يعمل واحد جديد
// (بفضل الـ UNIQUE INDEX المقيد على (provider_id, external_event_id))
async function recordEvent(providerId, eventType, externalEventId, payload) {
  const pool = await getPool();
  try {
    const result = await pool
      .request()
      .input('providerId', sql.BigInt, providerId)
      .input('eventType', sql.NVarChar(100), eventType)
      .input('externalEventId', sql.NVarChar(200), externalEventId || null)
      .input('payload', sql.NVarChar(sql.MAX), payload)
      .query(`
        INSERT INTO [dbo].[External_Event_byA] (provider_id, event_type, external_event_id, payload, status)
        OUTPUT INSERTED.*
        VALUES (@providerId, @eventType, @externalEventId, @payload, 'pending')
      `);
    return { event: result.recordset[0], isDuplicate: false };
  } catch (err) {
    // خالف الـ unique index المقيد يعني الحدث ده اتسجل قبل كده فعلاً (retry)
    if (String(err.message || '').includes('UQ_ExternalEvent_ProviderExternalId') && externalEventId) {
      const pool2 = await getPool();
      const existing = await pool2
        .request()
        .input('providerId', sql.BigInt, providerId)
        .input('externalEventId', sql.NVarChar(200), externalEventId)
        .query(`
          SELECT * FROM [dbo].[External_Event_byA]
          WHERE provider_id = @providerId AND external_event_id = @externalEventId
        `);
      return { event: existing.recordset[0] || null, isDuplicate: true };
    }
    throw err;
  }
}

async function markProcessed(eventId) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, eventId)
    .query(`UPDATE [dbo].[External_Event_byA] SET status = 'processed', processed_at = SYSUTCDATETIME() WHERE id = @id`);
}

async function markFailed(eventId, errorMessage) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, eventId)
    .input('errorMessage', sql.NVarChar(sql.MAX), errorMessage || null)
    .query(`
      UPDATE [dbo].[External_Event_byA]
      SET status = 'failed', retry_count = retry_count + 1, error_message = @errorMessage
      WHERE id = @id
    `);
}

async function listPending(providerId, limit = 50) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('providerId', sql.BigInt, providerId)
    .input('limit', sql.Int, limit)
    .query(`
      SELECT TOP (@limit) * FROM [dbo].[External_Event_byA]
      WHERE provider_id = @providerId AND status IN ('pending', 'failed')
      ORDER BY created_at ASC
    `);
  return result.recordset;
}

module.exports = {
  recordEvent,
  markProcessed,
  markFailed,
  listPending,
};
