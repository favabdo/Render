// repositories/visit.repo.js
// سجل زيارات الإيجنتس للعملاء (NileChat_Visits_byA). الزيارة ممكن تكون مرتبطة
// بكونتاكت حقيقي (contact_id) أو باسم يدوي بس (customer_name) لو اتضافت من
// زرار الإضافة البرّاني على عميل مش متسجل كـ كونتاكت. زي باقي الجداول المشابهة
// (Scheduled Tasks)، بنجيب اسم العميل لايف من جدول الكونتاكتس عن طريق JOIN لو
// فيه contact_id، وبنقع على customer_name كـ fallback لو مفيش.
const { getPool, sql } = require('../database/connection');
const cache = require('../services/cache.service');

const listKey = (contactId) => cache.cacheKey('visits', 'customer', contactId);

const SELECT_COLUMNS = `
  v.id, v.contact_id, v.visit_date, v.work_done, v.arrival_time, v.departure_time,
  v.agent_id, v.agent_name, v.created_at,
  COALESCE(ct.name, v.customer_name) AS customer_name
`;
const JOIN_CONTACTS = `
  FROM [dbo].[NileChat_Visits_byA] v
  LEFT JOIN [dbo].[NileChat_Contacts_byA] ct ON ct.id = v.contact_id
`;

// كاش: visits:customer:{contactId} (15m) — سجل زيارات العميل بيتغير بس لما
// إيجنت يضيف زيارة جديدة من صفحة تفاصيل العميل
async function listVisitsForContact(contactId) {
  return cache.getOrSet(listKey(contactId), cache.TTL.VISITS, async () => {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('contactId', sql.BigInt, contactId)
      .query(`
        SELECT ${SELECT_COLUMNS} ${JOIN_CONTACTS}
        WHERE v.contact_id = @contactId
        ORDER BY v.visit_date DESC, v.created_at DESC
      `);
    return result.recordset;
  });
}

async function getVisitById(visitId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, visitId)
    .query(`SELECT ${SELECT_COLUMNS} ${JOIN_CONTACTS} WHERE v.id = @id`);
  return result.recordset[0] || null;
}

async function addVisit({ contactId, customerName, visitDate, workDone, arrivalTime, departureTime, agentId, agentName, companyId }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contactId', sql.BigInt, contactId || null)
    .input('customerName', sql.NVarChar(200), customerName || null)
    .input('visitDate', sql.Date, visitDate)
    .input('workDone', sql.NVarChar(sql.MAX), workDone)
    .input('arrivalTime', sql.NVarChar(5), arrivalTime || null)
    .input('departureTime', sql.NVarChar(5), departureTime || null)
    .input('agentId', sql.BigInt, agentId || null)
    .input('agentName', sql.NVarChar(200), agentName || null)
    .input('companyId', sql.BigInt, companyId || null)
    .query(`
      INSERT INTO [dbo].[NileChat_Visits_byA]
        (contact_id, customer_name, visit_date, work_done, arrival_time, departure_time, agent_id, agent_name, company_id)
      OUTPUT INSERTED.id
      VALUES (@contactId, @customerName, @visitDate, @workDone, @arrivalTime, @departureTime, @agentId, @agentName, @companyId)
    `);
  // لو الزيارة مش مربوطة بكونتاكت حقيقي (contactId فاضي، اسم يدوي بس)، مفيش
  // كاش قايمة اتخزن أصلاً لعميل معين نبطّله
  if (contactId) await cache.del(listKey(contactId));
  return getVisitById(result.recordset[0].id);
}

module.exports = {
  listVisitsForContact,
  getVisitById,
  addVisit,
};
