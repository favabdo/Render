const { getPool, sql } = require('../config/db');

// بيدور على الكونتاكت اللي رقم التليفون ده مرتبط بيه (لو موجود)
async function findContactByPhone(phoneNumber) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('phone', sql.NVarChar(30), phoneNumber)
    .query(`
      SELECT c.*
      FROM [dbo].[NileChat_Contacts_byA] c
      INNER JOIN [dbo].[NileChat_ContactPhones_byA] p ON p.contact_id = c.id
      WHERE p.phone_number = @phone
    `);
  return result.recordset[0] || null;
}

// بينشئ كونتاكت جديد ويربطه فورًا برقم التليفون اللي بعت بيه
async function createContactWithPhone(name, phoneNumber) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('name', sql.NVarChar(200), name || phoneNumber)
    .query(`
      INSERT INTO [dbo].[NileChat_Contacts_byA] (name)
      OUTPUT INSERTED.*
      VALUES (@name)
    `);
  const contact = result.recordset[0];

  await pool
    .request()
    .input('contactId', sql.BigInt, contact.id)
    .input('phone', sql.NVarChar(30), phoneNumber)
    .query(`
      INSERT INTO [dbo].[NileChat_ContactPhones_byA] (contact_id, phone_number)
      VALUES (@contactId, @phone)
    `);

  return contact;
}

async function getContactById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`SELECT * FROM [dbo].[NileChat_Contacts_byA] WHERE id = @id`);
  return result.recordset[0] || null;
}

async function getPhonesForContact(contactId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contactId', sql.BigInt, contactId)
    .query(`
      SELECT phone_number, label FROM [dbo].[NileChat_ContactPhones_byA]
      WHERE contact_id = @contactId
      ORDER BY created_at ASC
    `);
  return result.recordset.map((r) => ({ phone_number: r.phone_number, label: r.label || null }));
}

// بنسمي رقم معين بتاع الكونتاكت ده (مثلاً "الشغل" أو "الرقم الشخصي") — مفيد لما يبقى
// عنده أكتر من رقم واحد، مع إن كل الأرقام برضه بتفضل تحت نفس اسم العميل
async function updatePhoneLabel(contactId, phoneNumber, label) {
  const pool = await getPool();
  const trimmedLabel = label && label.trim() ? label.trim() : null;
  const result = await pool
    .request()
    .input('contactId', sql.BigInt, contactId)
    .input('phone', sql.NVarChar(30), phoneNumber)
    .input('label', sql.NVarChar(100), trimmedLabel)
    .query(`
      UPDATE [dbo].[NileChat_ContactPhones_byA]
      SET label = @label
      OUTPUT INSERTED.*
      WHERE contact_id = @contactId AND phone_number = @phone
    `);
  return result.recordset[0] || null;
}

async function getContactByIdWithPhones(id) {
  const contact = await getContactById(id);
  if (!contact) return null;
  const phones = await getPhonesForContact(id);
  return { ...contact, phones };
}

// كل الكونتاكتس (تُستخدم في صفحة Contacts وفي قايمة اختيار "اربط بكونتاكت موجود")
async function listContacts() {
  const pool = await getPool();
  const contactsResult = await pool
    .request()
    .query(`
      SELECT id, name, location, contract_date, maintenance_end_date, created_at
      FROM [dbo].[NileChat_Contacts_byA]
      ORDER BY name ASC
    `);
  const phonesResult = await pool
    .request()
    .query(`SELECT contact_id, phone_number, label FROM [dbo].[NileChat_ContactPhones_byA] ORDER BY created_at ASC`);

  const phonesByContact = {};
  for (const row of phonesResult.recordset) {
    if (!phonesByContact[row.contact_id]) phonesByContact[row.contact_id] = [];
    phonesByContact[row.contact_id].push({ phone_number: row.phone_number, label: row.label || null });
  }

  return contactsResult.recordset.map((c) => ({ ...c, phones: phonesByContact[c.id] || [] }));
}

async function updateContactName(id, name) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('name', sql.NVarChar(200), name)
    .query(`
      UPDATE [dbo].[NileChat_Contacts_byA]
      SET name = @name
      OUTPUT INSERTED.*
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

// بينقل رقم تليفون عشان ينضم لكونتاكت تاني (دمج): لو الرقم متسجل قبل كده بيتحرك،
// ولو لأ بيتسجل جديد على الكونتاكت المطلوب
async function linkPhoneToContact(phoneNumber, contactId) {
  const pool = await getPool();
  const existing = await pool
    .request()
    .input('phone', sql.NVarChar(30), phoneNumber)
    .query(`SELECT id FROM [dbo].[NileChat_ContactPhones_byA] WHERE phone_number = @phone`);

  if (existing.recordset.length > 0) {
    await pool
      .request()
      .input('phone', sql.NVarChar(30), phoneNumber)
      .input('contactId', sql.BigInt, contactId)
      .query(`UPDATE [dbo].[NileChat_ContactPhones_byA] SET contact_id = @contactId WHERE phone_number = @phone`);
  } else {
    await pool
      .request()
      .input('phone', sql.NVarChar(30), phoneNumber)
      .input('contactId', sql.BigInt, contactId)
      .query(`INSERT INTO [dbo].[NileChat_ContactPhones_byA] (contact_id, phone_number) VALUES (@contactId, @phone)`);
  }
}

// لو كونتاكت بقى من غير أي رقم بعد الدمج (كل أرقامه اتنقلت لكونتاكت تاني)، نشيله عشان
// مايفضلش يظهر فاضي في صفحة الكونتاكتس
async function deletePhonelessContact(contactId) {
  const pool = await getPool();
  const phones = await getPhonesForContact(contactId);
  if (phones.length > 0) return false;
  await pool.request().input('id', sql.BigInt, contactId).query(`DELETE FROM [dbo].[NileChat_Contacts_byA] WHERE id = @id`);
  return true;
}

// بيفصل رقم تليفون واحد من كونتاكت عنده أكتر من رقم، وينشئ كونتاكت جديد منفصل
// بيه (بنفس الاسم افتراضيًا، أو باسم تاني لو اتبعت). عكس linkPhoneToContact
// تمامًا (اللي بيدمج رقم جوه كونتاكت موجود، ده بيفصله برة لكونتاكت جديد لوحده)
async function unlinkPhoneToNewContact(contactId, phoneNumber, newName) {
  const pool = await getPool();

  // اتأكد إن الرقم ده فعلاً تابع للكونتاكت ده قبل ما نعمل أي حاجة
  const check = await pool
    .request()
    .input('contactId', sql.BigInt, contactId)
    .input('phone', sql.NVarChar(30), phoneNumber)
    .query(`SELECT id FROM [dbo].[NileChat_ContactPhones_byA] WHERE contact_id = @contactId AND phone_number = @phone`);
  if (!check.recordset.length) return null;

  const oldContact = await getContactById(contactId);
  const finalName = (newName && newName.trim()) || (oldContact && oldContact.name) || phoneNumber;

  const insertResult = await pool
    .request()
    .input('name', sql.NVarChar(200), finalName)
    .query(`
      INSERT INTO [dbo].[NileChat_Contacts_byA] (name)
      OUTPUT INSERTED.*
      VALUES (@name)
    `);
  const newContact = insertResult.recordset[0];

  await pool
    .request()
    .input('phone', sql.NVarChar(30), phoneNumber)
    .input('newContactId', sql.BigInt, newContact.id)
    .query(`UPDATE [dbo].[NileChat_ContactPhones_byA] SET contact_id = @newContactId WHERE phone_number = @phone`);

  return getContactByIdWithPhones(newContact.id);
}

// بينشئ "كارت عميل صيانة" (Add Contact بتاع الأدمن): كونتاكت جديد بمكانه، تاريخ
// تعاقده، وتاريخ انتهاء عقد الصيانة بتاعه — بالإضافة لرقم تليفونه العادي زي أي
// كونتاكت تاني. القيم دي هي اللي بتفرّق الكارت ده عن كارت الكونتاكت العادي
// الجاي أوتوماتيك من واتساب (اللي مالوش location/contract_date/maintenance_end_date)
async function createCustomerContact({ name, phoneNumber, location, contractDate, maintenanceEndDate }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('name', sql.NVarChar(200), name)
    .input('location', sql.NVarChar(300), location || null)
    .input('contractDate', sql.Date, contractDate || null)
    .input('maintenanceEndDate', sql.Date, maintenanceEndDate || null)
    .query(`
      INSERT INTO [dbo].[NileChat_Contacts_byA] (name, location, contract_date, maintenance_end_date)
      OUTPUT INSERTED.*
      VALUES (@name, @location, @contractDate, @maintenanceEndDate)
    `);
  const contact = result.recordset[0];

  await pool
    .request()
    .input('contactId', sql.BigInt, contact.id)
    .input('phone', sql.NVarChar(30), phoneNumber)
    .query(`
      INSERT INTO [dbo].[NileChat_ContactPhones_byA] (contact_id, phone_number)
      VALUES (@contactId, @phone)
    `);

  return getContactByIdWithPhones(contact.id);
}

// تعديل بيانات كارت عميل الصيانة (أدمن بس) — الاسم، المكان، تاريخ التعاقد،
// وتاريخ انتهاء عقد الصيانة
async function updateCustomerDetails(id, { name, location, contractDate, maintenanceEndDate }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('name', sql.NVarChar(200), name)
    .input('location', sql.NVarChar(300), location || null)
    .input('contractDate', sql.Date, contractDate || null)
    .input('maintenanceEndDate', sql.Date, maintenanceEndDate || null)
    .query(`
      UPDATE [dbo].[NileChat_Contacts_byA]
      SET name = @name, location = @location, contract_date = @contractDate, maintenance_end_date = @maintenanceEndDate
      OUTPUT INSERTED.*
      WHERE id = @id
    `);
  if (!result.recordset[0]) return null;
  return getContactByIdWithPhones(id);
}

module.exports = {
  findContactByPhone,
  createContactWithPhone,
  createCustomerContact,
  updateCustomerDetails,
  getContactById,
  getContactByIdWithPhones,
  getPhonesForContact,
  updatePhoneLabel,
  listContacts,
  updateContactName,
  linkPhoneToContact,
  unlinkPhoneToNewContact,
  deletePhonelessContact,
};
