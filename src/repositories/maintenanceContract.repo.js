// repositories/maintenanceContract.repo.js
// سجل عقود الصيانة الكامل لكل عميل (NileChat_MaintenanceContracts_byA). كل عقد
// صف مستقل بتاريخ بدء وتاريخ انتهاء، فلو عقد عميل انتهى بنضيفله عقد جديد كامل
// (تاريخ بدء/انتهاء جديدين) من غير ما نلمس أو نمسح تاريخ العقود اللي فاتت —
// عكس الطريقة القديمة اللي كانت بتستبدل تاريخ العقد الواحد المتسجل على الكونتاكت.
const { getPool, sql } = require('../config/db');

const SELECT_COLUMNS = `
  id, contact_id, start_date, end_date, notes, created_by, created_by_name, created_at
`;

// كل عقود الصيانة الخاصة بعميل معين، الأحدث بدايةً الأول (بيتعرضوا في سيكشن
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
      ORDER BY start_date DESC, created_at DESC
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

// إضافة عقد صيانة جديد لعميل (سواء عقده القديم لسه ساري أو خلص) — أدمن/أونر بس
// (متأكد منها فعليًا في الراوت بـ requireAdmin)
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
        (contact_id, start_date, end_date, notes, created_by, created_by_name)
      OUTPUT INSERTED.id
      VALUES (@contactId, @startDate, @endDate, @notes, @createdBy, @createdByName)
    `);
  return getContractById(result.recordset[0].id);
}

// "العقد الحالي" بتاع عميل معين: العقد الساري دلوقتي لو موجود (تاريخ النهارده بين
// بدايته ونهايته)، وإلا آخر عقد انتهى (الأحدث بتاريخ انتهاء). ده اللي بيتعرض في
// إحصائيات العميل الظاهرة برة (فوق سيكشن الزيارات) وفي بادچ "عميل صيانة" في شبكة
// الكونتاكتس — نفس منطق OUTER APPLY المستخدم في contact.repo.js لكن كدالة مستقلة
// لو احتجناها لعميل واحد بس
async function getCurrentContractForContact(contactId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contactId', sql.BigInt, contactId)
    .query(`
      SELECT TOP 1 ${SELECT_COLUMNS}
      FROM [dbo].[NileChat_MaintenanceContracts_byA]
      WHERE contact_id = @contactId
      ORDER BY
        CASE WHEN CAST(SYSUTCDATETIME() AS DATE) BETWEEN start_date AND end_date THEN 0 ELSE 1 END,
        end_date DESC
    `);
  return result.recordset[0] || null;
}

module.exports = {
  listContractsForContact,
  getContractById,
  getCurrentContractForContact,
  addContract,
};
