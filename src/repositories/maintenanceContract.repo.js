// repositories/maintenanceContract.repo.js
// سجل عقود الصيانة الكامل لكل عميل (NileChat_MaintenanceContracts_byA). كل عقد
// صف مستقل بتاريخ بدء وتاريخ انتهاء، فلو عقد عميل انتهى بنضيفله عقد جديد كامل
// (تاريخ بدء/انتهاء جديدين) من غير ما نلمس أو نمسح تاريخ العقود اللي فاتت —
// عكس الطريقة القديمة اللي كانت بتستبدل تاريخ العقد الواحد المتسجل على الكونتاكت.
//
// عمود status (active/stopped): العقد بيتولد "active" افتراضيًا. الأدمن بس هو
// اللي يقدر يوقفه (status='stopped') أو يمسحه خالص. ما دام فيه عقد "active"
// لعميل معين، مينفعش يتضاف عقد جديد ليه غير لو الأدمن وقف الحالي الأول —
// اتأكد منها في الكنترولر قبل الإضافة.
const { getPool, sql } = require('../config/db');

const SELECT_COLUMNS = `
  id, contact_id, start_date, end_date, notes, status, created_by, created_by_name, created_at
`;

// كل عقود الصيانة الخاصة بعميل معين، آخر عقد اتضاف الأول (بيتعرضوا في سيكشن
// "سجل الصيانة" جمب سيكشن الزيارات في صفحة تفاصيل العميل)
async function listContractsForContact(contactId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contactId', sql.BigInt, contactId)
    .query(`
      SELECT ${SELECT_COLUMNS}
      FROM [dbo].[NileChat_MaintenanceContracts_byA]
      WHERE contact_id = @contactId
      ORDER BY created_at DESC, id DESC
    `);
  return result.recordset;
}

async function getContractById(contractId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, contractId)
    .query(`SELECT ${SELECT_COLUMNS} FROM [dbo].[NileChat_MaintenanceContracts_byA] WHERE id = @id`);
  return result.recordset[0] || null;
}

// هل فيه عقد "active" لعميل معين لسه ساري فعليًا (تاريخ النهارده لسه ماعداش
// تاريخ انتهاءه)؟ بنستخدمها قبل إضافة عقد جديد — العقد اللي حالته active بس
// خلصت مدته (منتهي بالتاريخ) مش لازم يتوقف الأول، أصلاً هو منتهي، فمينفعش يمنع
// إضافة عقد جديد؛ العقد اللي لازم يتوقف الأول هو اللي لسه شغال فعلاً (ساري أو
// لسه هيبدأ)
async function getActiveContractForContact(contactId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contactId', sql.BigInt, contactId)
    .query(`
      SELECT TOP 1 ${SELECT_COLUMNS}
      FROM [dbo].[NileChat_MaintenanceContracts_byA]
      WHERE contact_id = @contactId AND status = 'active'
        AND end_date >= CAST(SYSUTCDATETIME() AS DATE)
      ORDER BY created_at DESC, id DESC
    `);
  return result.recordset[0] || null;
}

// إضافة عقد صيانة جديد لعميل — أدمن/أونر بس (متأكد منها فعليًا في الراوت بـ
// requireAdmin)، وممنوع لو فيه عقد active لسه لنفس العميل (متأكد منها في الكنترولر)
async function addContract({ contactId, startDate, endDate, notes, createdBy, createdByName }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contactId', sql.BigInt, contactId)
    .input('startDate', sql.Date, startDate)
    .input('endDate', sql.Date, endDate)
    .input('notes', sql.NVarChar(500), notes || null)
    .input('createdBy', sql.BigInt, createdBy || null)
    .input('createdByName', sql.NVarChar(200), createdByName || null)
    .query(`
      INSERT INTO [dbo].[NileChat_MaintenanceContracts_byA]
        (contact_id, start_date, end_date, notes, status, created_by, created_by_name)
      OUTPUT INSERTED.id
      VALUES (@contactId, @startDate, @endDate, @notes, 'active', @createdBy, @createdByName)
    `);
  return getContractById(result.recordset[0].id);
}

// إيقاف عقد صيانة (status -> 'stopped') — أدمن/أونر بس. بمجرد ما يتوقف، يبقى
// ينفع يتضاف عقد جديد للعميل ده، والعقد الموقوف ده بيفضل موقوف (مش بيرجع active
// تاني تلقائيًا)
async function stopContract(contractId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, contractId)
    .query(`
      UPDATE [dbo].[NileChat_MaintenanceContracts_byA]
      SET status = 'stopped'
      OUTPUT INSERTED.id
      WHERE id = @id AND status = 'active'
    `);
  if (!result.recordset[0]) return null;
  return getContractById(result.recordset[0].id);
}

// مسح عقد صيانة خالص من السجل — أدمن/أونر بس
async function deleteContract(contractId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, contractId)
    .query(`
      DELETE FROM [dbo].[NileChat_MaintenanceContracts_byA]
      OUTPUT DELETED.id
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

// "العقد الحالي" بتاع عميل معين: دايمًا آخر عقد اتضاف (بغض النظر عن حالته
// active/stopped أو تواريخه) — ده اللي بيتعرض في إحصائيات العميل الظاهرة برة
// (فوق سيكشن الزيارات) وفي بادچ "عميل صيانة" في شبكة الكونتاكتس، نفس منطق
// OUTER APPLY المستخدم في contact.repo.js لكن كدالة مستقلة لو احتجناها لعميل واحد بس
async function getCurrentContractForContact(contactId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contactId', sql.BigInt, contactId)
    .query(`
      SELECT TOP 1 ${SELECT_COLUMNS}
      FROM [dbo].[NileChat_MaintenanceContracts_byA]
      WHERE contact_id = @contactId
      ORDER BY created_at DESC, id DESC
    `);
  return result.recordset[0] || null;
}

module.exports = {
  listContractsForContact,
  getContractById,
  getActiveContractForContact,
  getCurrentContractForContact,
  addContract,
  stopContract,
  deleteContract,
};
