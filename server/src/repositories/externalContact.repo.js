// repositories/externalContact.repo.js
// كونتاكتس الجهة الخارجية (شات ووت). نفس فلسفة externalAgent.repo.js بالظبط:
// nile_contact_id بيفضل NULL افتراضيًا، وبيتحدد بس لما حد يعمل ميرج صريح
// لكونتاكت موجود بالفعل في NileChat_Contacts_byA

const { getPool, sql } = require('../database/connection');

async function findByProviderAndExternalId(providerId, externalContactId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('providerId', sql.BigInt, providerId)
    .input('externalContactId', sql.NVarChar(100), String(externalContactId))
    .query(`
      SELECT * FROM [dbo].[External_Contacts_byA]
      WHERE provider_id = @providerId AND external_contact_id = @externalContactId
    `);
  return result.recordset[0] || null;
}

// بينشئ صف جديد لو مش موجود (nile_contact_id = NULL افتراضيًا)، أو بيحدّث
// name/phone/raw_json لو الصف موجود خلاص (من غير ما يلمس nile_contact_id إطلاقًا).
//
// ملحوظة مهمة عن الـ race condition: شات ووت أحيانًا بيبعت أكتر من webhook
// event (contact_created + message_created) لنفس الكونتاكت الجديد في نفس
// اللحظة تقريبًا. لو الاتنين وصلوا سوا، ممكن الاتنين يشوفوا "الصف مش موجود"
// قبل ما أي واحد فيهم يخلّص الـ INSERT، فيحصل تعارض على الـ UNIQUE constraint.
// عشان كده الـ INSERT هنا متلفوف في try/catch: لو حصل تعارض، معناها صف
// اتعمل فعلاً من الطلب التاني في نفس اللحظة — بنجيبه ونحدّثه بدل ما نرمي
// الخطأ (لو رمينا الخطأ، الرسالة اللي جايه مع الحدث ده كانت بتضيع بصمت)
async function upsertExternalContact(providerId, externalContactId, { name, phone, rawJson }) {
  const existing = await findByProviderAndExternalId(providerId, externalContactId);
  const pool = await getPool();

  if (existing) {
    const result = await pool
      .request()
      .input('id', sql.BigInt, existing.id)
      .input('name', sql.NVarChar(200), name || null)
      .input('phone', sql.NVarChar(50), phone || null)
      .input('rawJson', sql.NVarChar(sql.MAX), rawJson || null)
      .query(`
        UPDATE [dbo].[External_Contacts_byA]
        SET name = @name, phone = @phone, raw_json = @rawJson, updated_at = SYSUTCDATETIME()
        OUTPUT INSERTED.*
        WHERE id = @id
      `);
    return result.recordset[0];
  }

  try {
    const result = await pool
      .request()
      .input('providerId', sql.BigInt, providerId)
      .input('externalContactId', sql.NVarChar(100), String(externalContactId))
      .input('name', sql.NVarChar(200), name || null)
      .input('phone', sql.NVarChar(50), phone || null)
      .input('rawJson', sql.NVarChar(sql.MAX), rawJson || null)
      .query(`
        INSERT INTO [dbo].[External_Contacts_byA]
          (provider_id, external_contact_id, nile_contact_id, name, phone, raw_json)
        OUTPUT INSERTED.*
        VALUES (@providerId, @externalContactId, NULL, @name, @phone, @rawJson)
      `);
    return result.recordset[0];
  } catch (err) {
    if (String(err.message || '').includes('UQ_ExternalContacts_ProviderExternalId')) {
      const winner = await findByProviderAndExternalId(providerId, externalContactId);
      if (winner) return winner;
    }
    throw err;
  }
}

// الميرج الصريح الوحيد اللي ممكن يحط قيمة في nile_contact_id — بيتنادى من
// إجراء واعي (زرار "ربط بعميل موجود" في الواجهة)، مش تلقائي أبدًا
async function mergeContactToNileContact(externalContactRowId, nileContactId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, externalContactRowId)
    .input('nileContactId', sql.BigInt, nileContactId)
    .query(`
      UPDATE [dbo].[External_Contacts_byA] SET nile_contact_id = @nileContactId, updated_at = SYSUTCDATETIME()
      OUTPUT INSERTED.*
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

// بيلغي الميرج (يرجع nile_contact_id لـ NULL)
async function unmergeContact(externalContactRowId) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, externalContactRowId)
    .query(`UPDATE [dbo].[External_Contacts_byA] SET nile_contact_id = NULL, updated_at = SYSUTCDATETIME() WHERE id = @id`);
}

// بيدور على كل صفوف External_Contacts_byA المرتبطة (ميرج) بكونتاكت نايل شات معين
// — مفيد لو حصل ميرج/فصل رقم عندك عادي (contact.service.js) وعايز تعرف تحدّث
// أي صف خارجي مرتبط بالكونتاكت ده
async function findByNileContactId(nileContactId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('nileContactId', sql.BigInt, nileContactId)
    .query(`SELECT * FROM [dbo].[External_Contacts_byA] WHERE nile_contact_id = @nileContactId`);
  return result.recordset;
}

async function getById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`SELECT * FROM [dbo].[External_Contacts_byA] WHERE id = @id`);
  return result.recordset[0] || null;
}

// كونتاكتس شات ووت اللي لسه ماتعملهاش ميرج (nile_contact_id لسه NULL) —
// دي القايمة اللي هتظهر للإداري في واجهة "ربط بكونتاكت موجود"
async function listUnmerged(providerId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('providerId', sql.BigInt, providerId)
    .query(`
      SELECT * FROM [dbo].[External_Contacts_byA]
      WHERE provider_id = @providerId AND nile_contact_id IS NULL
      ORDER BY created_at DESC
    `);
  return result.recordset;
}

module.exports = {
  findByProviderAndExternalId,
  upsertExternalContact,
  mergeContactToNileContact,
  unmergeContact,
  findByNileContactId,
  getById,
  listUnmerged,
};
