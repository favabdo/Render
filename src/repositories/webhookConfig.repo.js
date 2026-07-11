// repositories/webhookConfig.repo.js
// إدارة الـ Webhooks الصادرة (Outbound) اللي اليوزر بيسجّلها من صفحة
// Settings → Integrations، عشان يستقبل أحداث المحادثات على السيرفر بتاعه

const { getPool, sql } = require('../config/db');
const companyRepo = require('./company.repo');

function parseEvents(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((e) => typeof e === 'string' && e.trim()) : [];
  } catch {
    return [];
  }
}

function mapWebhookRow(row) {
  return {
    id: row.id,
    url: row.url,
    secret: row.secret,
    events: parseEvents(row.events),
    enabled: Boolean(row.enabled),
    created_at: row.created_at,
    last_triggered_at: row.last_triggered_at || null,
    last_status_code: row.last_status_code || null,
    last_error: row.last_error || null,
  };
}

// نفس فكرة companyRepo.getAutomationSettings بالظبط: لو مفيش companyId متبعت،
// بنشتغل على أول شركة مسجلة (النظام في وضعه الحالي شركة واحدة فعليًا لكل نشر)
async function resolveCompanyId(companyId) {
  if (companyId) return companyId;
  const company = await companyRepo.getFirstCompany();
  return company ? company.id : null;
}

async function listByCompany(companyId = null) {
  const resolvedCompanyId = await resolveCompanyId(companyId);
  if (!resolvedCompanyId) return [];

  const pool = await getPool();
  const result = await pool
    .request()
    .input('companyId', sql.BigInt, resolvedCompanyId)
    .query(`
      SELECT * FROM [dbo].[NileChat_Webhooks_byA]
      WHERE company_id = @companyId
      ORDER BY created_at DESC
    `);
  return result.recordset.map(mapWebhookRow);
}

async function getById(id, companyId = null) {
  const resolvedCompanyId = await resolveCompanyId(companyId);
  if (!resolvedCompanyId) return null;

  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('companyId', sql.BigInt, resolvedCompanyId)
    .query(`
      SELECT * FROM [dbo].[NileChat_Webhooks_byA]
      WHERE id = @id AND company_id = @companyId
    `);
  return result.recordset[0] ? mapWebhookRow(result.recordset[0]) : null;
}

async function create({ url, secret, events, createdBy }, companyId = null) {
  const resolvedCompanyId = await resolveCompanyId(companyId);
  if (!resolvedCompanyId) throw new Error('مفيش شركة مربوطة بالحساب ده');

  const pool = await getPool();
  const result = await pool
    .request()
    .input('companyId', sql.BigInt, resolvedCompanyId)
    .input('url', sql.NVarChar(1000), url)
    .input('secret', sql.NVarChar(200), secret)
    .input('events', sql.NVarChar(sql.MAX), JSON.stringify(events))
    .input('createdBy', sql.BigInt, createdBy || null)
    .query(`
      INSERT INTO [dbo].[NileChat_Webhooks_byA] (company_id, url, secret, events, created_by)
      OUTPUT INSERTED.*
      VALUES (@companyId, @url, @secret, @events, @createdBy)
    `);
  return mapWebhookRow(result.recordset[0]);
}

async function update(id, fields, companyId = null) {
  const resolvedCompanyId = await resolveCompanyId(companyId);
  if (!resolvedCompanyId) return null;

  const pool = await getPool();
  const req = pool.request().input('id', sql.BigInt, id).input('companyId', sql.BigInt, resolvedCompanyId);
  const sets = [];

  if (fields.url !== undefined) {
    req.input('url', sql.NVarChar(1000), fields.url);
    sets.push('url = @url');
  }
  if (fields.events !== undefined) {
    req.input('events', sql.NVarChar(sql.MAX), JSON.stringify(fields.events));
    sets.push('events = @events');
  }
  if (fields.enabled !== undefined) {
    req.input('enabled', sql.Bit, fields.enabled ? 1 : 0);
    sets.push('enabled = @enabled');
  }
  if (fields.secret !== undefined) {
    req.input('secret', sql.NVarChar(200), fields.secret);
    sets.push('secret = @secret');
  }

  if (sets.length === 0) return getById(id, resolvedCompanyId);

  await req.query(`
    UPDATE [dbo].[NileChat_Webhooks_byA]
    SET ${sets.join(', ')}
    WHERE id = @id AND company_id = @companyId
  `);
  return getById(id, resolvedCompanyId);
}

async function remove(id, companyId = null) {
  const resolvedCompanyId = await resolveCompanyId(companyId);
  if (!resolvedCompanyId) return false;

  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('companyId', sql.BigInt, resolvedCompanyId)
    .query(`
      DELETE FROM [dbo].[NileChat_Webhooks_byA]
      WHERE id = @id AND company_id = @companyId
    `);
  return result.rowsAffected[0] > 0;
}

// بيرجع كل الـ Webhooks المفعّلة والمشتركة في حدث معين، لشركة معينة — دي اللي
// بيستخدمها webhookDispatch.service.js وقت أي حدث فعلي (رسالة جديدة، Resolve...)
async function listEnabledForCompanyEvent(eventType, companyId = null) {
  const all = await listByCompany(companyId);
  return all.filter((wh) => wh.enabled && wh.events.includes(eventType));
}

// بتسجّل نتيجة آخر محاولة إرسال (نجحت أو فشلت) عشان تبان في الواجهة تحت كل Webhook
async function recordDeliveryResult(id, { statusCode = null, error = null }) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('statusCode', sql.Int, statusCode)
    .input('error', sql.NVarChar(500), error ? String(error).slice(0, 500) : null)
    .query(`
      UPDATE [dbo].[NileChat_Webhooks_byA]
      SET last_triggered_at = SYSUTCDATETIME(), last_status_code = @statusCode, last_error = @error
      WHERE id = @id
    `);
}

module.exports = {
  listByCompany,
  getById,
  create,
  update,
  remove,
  listEnabledForCompanyEvent,
  recordDeliveryResult,
};
