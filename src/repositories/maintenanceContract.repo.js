// repositories/maintenanceContract.repo.js
// سجل عقود الصيانة الكامل لكل عميل (NileChat_MaintenanceContracts_byA). كل عقد
// صف مستقل بتاريخ بدء وتاريخ انتهاء، فلو عقد عميل انتهى بنضيفله عقد جديد كامل
// (تاريخ بدء/انتهاء جديدين) من غير ما نلمس أو نمسح تاريخ العقود اللي فاتت —
// عكس الطريقة القديمة اللي كانت بتستبدل تاريخ العقد الواحد المتسجل على الكونتاكت.
//
// "إيقاف" عقد (Stop): الأدمن/الأونر بس اللي يقدر يوقف عقد ساري — العقد بيفضل في
// السجل (تاريخه محفوظ)، لكن بيتحسب بعدها "موقوف" مش "ساري" حتى لو تاريخ نهايته
// لسه ما جاش. ده الشرط الوحيد اللي بيسمح بإضافة عقد جديد: مينفعش تضيف عقد جديد
// وفيه عقد ساري (جوه مدته) ومش موقوف.
const { getPool, sql } = require('../config/db');

const SELECT_COLUMNS = `
  id, contact_id, start_date, end_date, notes, created_by, created_by_name,
  created_at, stopped_at, stopped_by, stopped_by_name
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

// فيه عقد "ساري ومش موقوف" لعميل معين دلوقتي؟ (تاريخ النهارده بين بدايته
// ونهايته، و stopped_at لسه NULL) — ده الشرط اللي بيمنع إضافة عقد جديد، بيتنادى
// عليه من الكنترولر قبل ما يسمح بـ addContract
async function hasActiveUnstoppedContract(contactId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contactId', sql.BigInt, contactId)
    .query(`
      SELECT TOP 1 id
      FROM [dbo].[NileChat_MaintenanceContracts_byA]
      WHERE contact_id = @contactId
        AND stopped_at IS NULL
        AND CAST(SYSUTCDATETIME() AS DATE) BETWEEN start_date AND end_date
    `);
  return !!result.recordset[0];
}

// إضافة عقد صيانة جديد لعميل (سواء عقده القديم لسه ساري بعد ما اتوقف يدويًا أو
// خلص من مدته) — أدمن/أونر بس (متأكد منها فعليًا في الراوت بـ requireAdmin)،
// وممنوع لو فيه عقد ساري مش موقوف (اتأكد منها في الكنترولر بـ
// hasActiveUnstoppedContract قبل ما يوصل هنا)
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

// بيوقف عقد ساري (أدمن/أونر بس) — العقد بيفضل في السجل بتاريخه زي ما هو، لكن
// بيتحط عليه stopped_at عشان يبطل يتحسب "ساري" في أي حسبة تانية (ومنها إمكانية
// إضافة عقد جديد)
async function stopContract(contractId, { stoppedBy, stoppedByName } = {}) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, contractId)
    .input('stoppedBy', sql.BigInt, stoppedBy || null)
    .input('stoppedByName', sql.NVarChar(200), stoppedByName || null)
    .query(`
      UPDATE [dbo].[NileChat_MaintenanceContracts_byA]
      SET stopped_at = SYSUTCDATETIME(), stopped_by = @stoppedBy, stopped_by_name = @stoppedByName
      OUTPUT INSERTED.id
      WHERE id = @id AND stopped_at IS NULL
    `);
  if (!result.recordset[0]) return null;
  return getContractById(result.recordset[0].id);
}

// مسح عقد صيانة نهائيًا من السجل (أدمن/أونر بس)
async function deleteContract(contractId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, contractId)
    .query(`DELETE FROM [dbo].[NileChat_MaintenanceContracts_byA] OUTPUT DELETED.id WHERE id = @id`);
  return !!result.recordset[0];
}

// "العقد الحالي" بتاع عميل معين: دلوقتي بقى دايمًا آخر عقد اتضاف (الأحدث
// created_at)، مش أحسن عقد بالتاريخ — عشان الأدمن هو اللي متحكم في السلسلة (يوقف
// عقد قبل ما يضيف التاني)، فآخر عقد مضاف هو مصدر الحقيقة دايمًا لإحصائيات العميل
// الظاهرة برة (فوق سيكشن الزيارات) وبادچ "عميل صيانة" في شبكة الكونتاكتس — نفس
// منطق OUTER APPLY المستخدم في contact.repo.js لكن كدالة مستقلة لو احتجناها
// لعميل واحد بس
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

// عقود الصيانة اللي "منتهية فعليًا ولسه محدش بعتلها إشعار": تاريخ نهايتها فات
// (وهي لسه آخر عقد اتضاف للعميل ده — مش عقد قديم اتغطى بعقد أحدث)، ومحدش
// أوقفها يدويًا (لو الأدمن أوقفها بنفسه فده مش "انتهاء طبيعي")، ولسه
// expiry_notice_sent_at فاضي. بترجع رقم تليفون العميل الأساسي (أول رقم متسجل
// له) عشان contractExpiry.service.js يقدر يبعت عليه مباشرة
async function findExpiredContractsPendingNotice() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT m.id AS contract_id, m.contact_id, m.end_date,
           c.name AS contact_name,
           p.phone_number AS contact_phone
    FROM [dbo].[NileChat_MaintenanceContracts_byA] m
    INNER JOIN [dbo].[NileChat_Contacts_byA] c ON c.id = m.contact_id
    OUTER APPLY (
      SELECT TOP 1 phone_number
      FROM [dbo].[NileChat_ContactPhones_byA] ph
      WHERE ph.contact_id = c.id
      ORDER BY ph.created_at ASC
    ) p
    WHERE m.stopped_at IS NULL
      AND m.expiry_notice_sent_at IS NULL
      AND m.end_date < CAST(SYSUTCDATETIME() AS DATE)
      -- لازم يكون ده آخر عقد اتضاف للعميل ده (مش عقد قديم اتغطى بعقد جديد)
      AND m.id = (
        SELECT TOP 1 m2.id
        FROM [dbo].[NileChat_MaintenanceContracts_byA] m2
        WHERE m2.contact_id = m.contact_id
        ORDER BY m2.created_at DESC, m2.id DESC
      )
      AND p.phone_number IS NOT NULL
  `);
  return result.recordset;
}

// هل "العقد الحالي" (آخر عقد اتضاف) لعميل معين منتهي فعليًا دلوقتي؟ (تاريخ
// نهايته فات، ومحدش أوقفه يدويًا) — بتتنادى مع كل رسالة جديدة جاية من العميل
// عشان رد تلقائي "عقد الصيانة منتهي" يتبعت تاني كل مرة (عكس
// findExpiredContractsPendingNotice اللي بيبعت مرة واحدة بس ويعلّم العقد)
async function isCurrentContractExpired(contactId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contactId', sql.BigInt, contactId)
    .query(`
      SELECT TOP 1 m.id
      FROM [dbo].[NileChat_MaintenanceContracts_byA] m
      WHERE m.contact_id = @contactId
        AND m.stopped_at IS NULL
        AND m.end_date < CAST(SYSUTCDATETIME() AS DATE)
        -- لازم يكون ده آخر عقد اتضاف للعميل ده (مش عقد قديم اتغطى بعقد جديد)
        AND m.id = (
          SELECT TOP 1 m2.id
          FROM [dbo].[NileChat_MaintenanceContracts_byA] m2
          WHERE m2.contact_id = m.contact_id
          ORDER BY m2.created_at DESC, m2.id DESC
        )
    `);
  return !!result.recordset[0];
}

// بيسجل إن إشعار انتهاء العقد ده اتبعت، عشان القاعدة متبعتوش تاني لنفس العقد
async function markExpiryNoticeSent(contractId) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, contractId)
    .query(`
      UPDATE [dbo].[NileChat_MaintenanceContracts_byA]
      SET expiry_notice_sent_at = SYSUTCDATETIME()
      WHERE id = @id AND expiry_notice_sent_at IS NULL
    `);
}

module.exports = {
  listContractsForContact,
  getContractById,
  getCurrentContractForContact,
  hasActiveUnstoppedContract,
  addContract,
  stopContract,
  deleteContract,
  findExpiredContractsPendingNotice,
  markExpiryNoticeSent,
  isCurrentContractExpired,
};
