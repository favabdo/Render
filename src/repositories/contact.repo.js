const { getPool, sql, TABLE_NAME } = require('../config/db');
const maintenanceContractRepo = require('./maintenanceContract.repo');
const { PREDEFINED_CONTACT_MODULES } = require('../utils/contactModules');

// نفس منطق "العقد الحالي" الموجود في maintenanceContract.repo.getCurrentContractForContact
// لكن كـ OUTER APPLY جوه استعلام واحد، عشان نجيب العقد الحالي لكل الكونتاكتس دفعة
// واحدة من غير ما نعمل query منفصل لكل عميل (N+1).
// "العقد الحالي" هنا هو آخر عقد اتضاف (created_at DESC) مش أحسن عقد بالتاريخ —
// عشان الأدمن هو اللي متحكم في السلسلة (لازم يوقف العقد الساري قبل ما يضيف عقد
// جديد)، فآخر عقد مضاف هو مصدر الحقيقة دايمًا للإحصائيات الظاهرة برة
const CURRENT_CONTRACT_APPLY = `
  OUTER APPLY (
    SELECT TOP 1 start_date, end_date, stopped_at
    FROM [dbo].[NileChat_MaintenanceContracts_byA] m
    WHERE m.contact_id = c.id
    ORDER BY m.created_at DESC, m.id DESC
  ) mc
`;

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

// زي getContactById بالظبط، لكن maintenance_start_date/maintenance_end_date بييجوا
// لايف من "العقد الحالي" في سجل عقود الصيانة (الساري لو موجود، وإلا آخر عقد
// انتهى) — مش من عمودين ثابتين على الكونتاكت. أما contract_date (تاريخ التعاقد
// الأصلي) و manager_phone (رقم المدير) فدول معلومات مستقلة تمامًا محفوظة على
// الكونتاكت نفسه، ومالهاش أي علاقة بجدول عقود الصيانة أو بحساباته
async function getContactByIdWithCurrentContract(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`
      SELECT c.id, c.name, c.location, c.created_at, c.contract_date, c.manager_phone, c.manager_name,
             mc.start_date AS maintenance_start_date, mc.end_date AS maintenance_end_date,
             mc.stopped_at AS maintenance_stopped_at
      FROM [dbo].[NileChat_Contacts_byA] c
      ${CURRENT_CONTRACT_APPLY}
      WHERE c.id = @id
    `);
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

// بيرجع كل الموديولات اللي العميل ده مشترك فيها (سواء من القايمة الجاهزة أو
// اللي الأدمن كتبها بايده) — بتتعرض في صفحة تفاصيل العميل أول ما تتفتح
async function getModulesForContact(contactId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contactId', sql.BigInt, contactId)
    .query(`
      SELECT module_name, is_custom FROM [dbo].[NileChat_ContactModules_byA]
      WHERE contact_id = @contactId
      ORDER BY is_custom ASC, created_at ASC
    `);
  return result.recordset.map((r) => ({ name: r.module_name, isCustom: !!r.is_custom }));
}

// بيستبدل كل موديولات العميل بقايمة جديدة (مسح كل القديم وإضافة الجديد) — أسهل
// وأأمن من مقارنة الفروقات، وعدد الموديولات لكل عميل صغير أصلًا فمفيش مشكلة
// أداء. أي موديول مش موجود حرفيًا في القايمة الجاهزة (PREDEFINED_CONTACT_MODULES)
// بيتسجل كـ is_custom=1 (الأدمن كاتبه بنفسه في التيكست بوكس)
async function setContactModules(contactId, modules) {
  const pool = await getPool();
  const cleanModules = [...new Set((modules || []).map((m) => (m || '').trim()).filter(Boolean))];

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction)
      .input('contactId', sql.BigInt, contactId)
      .query(`DELETE FROM [dbo].[NileChat_ContactModules_byA] WHERE contact_id = @contactId`);

    for (const moduleName of cleanModules) {
      const isCustom = !PREDEFINED_CONTACT_MODULES.includes(moduleName);
      await new sql.Request(transaction)
        .input('contactId', sql.BigInt, contactId)
        .input('moduleName', sql.NVarChar(300), moduleName)
        .input('isCustom', sql.Bit, isCustom)
        .query(`
          INSERT INTO [dbo].[NileChat_ContactModules_byA] (contact_id, module_name, is_custom)
          VALUES (@contactId, @moduleName, @isCustom)
        `);
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  return getModulesForContact(contactId);
}

async function getContactByIdWithPhones(id) {
  const contact = await getContactByIdWithCurrentContract(id);
  if (!contact) return null;
  const phones = await getPhonesForContact(id);
  const modules = await getModulesForContact(id);
  return { ...contact, phones, modules };
}

// كل الكونتاكتس (تُستخدم في صفحة Contacts وفي قايمة اختيار "اربط بكونتاكت موجود")
// maintenance_start_date/maintenance_end_date هنا بييجوا من "العقد الحالي" (آخر
// عقد اتضاف) بتاع كل عميل — نفس منطق getContactByIdWithCurrentContract. أما
// contract_date (تاريخ التعاقد) و manager_phone (رقم المدير) فمعلومات مستقلة
// محفوظة على الكونتاكت نفسه
async function listContacts() {
  const pool = await getPool();
  const contactsResult = await pool
    .request()
    .query(`
      SELECT c.id, c.name, c.location, c.created_at, c.contract_date, c.manager_phone, c.manager_name,
             mc.start_date AS maintenance_start_date, mc.end_date AS maintenance_end_date,
             mc.stopped_at AS maintenance_stopped_at
      FROM [dbo].[NileChat_Contacts_byA] c
      ${CURRENT_CONTRACT_APPLY}
      ORDER BY c.name ASC
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

// نفس listContacts فوق، لكن بصفحات (Pagination) عشان لو العملاء كتروا الصفحة ميعلقش
// تحميلها ولا تجيب كل الصفوف والأرقام مرة واحدة. كل صفحة أقصى حاجة 20 عميل،
// والبحث (بالاسم أو رقم التليفون) بيتعمل على مستوى السيرفر نفسه مش بعد التحميل،
// عشان لو حد بحث عن حاجة مش في أول صفحة يلاقيها برضو
const MAX_CONTACTS_PAGE_SIZE = 20;

// عميل بيتحسب "مسجل بالفعل" لو عنده كارت عميل متضاف (location/contract_date/
// manager_phone من زرار Add Contact) أو عنده عقد صيانة (حالي أو سابق) في سجل
// العقود. أي كونتاكت تاني (جاي أوتوماتيك من واتساب وملوش أي حاجة من دول) بيبقى
// "لسه بس بعت واتساب ومتسجلش" — ده هو الفرق بين التابين في صفحة Contacts
const REGISTERED_CONDITION = `(
  c.location IS NOT NULL
  OR c.contract_date IS NOT NULL
  OR c.manager_phone IS NOT NULL
  OR EXISTS (
       SELECT 1 FROM [dbo].[NileChat_MaintenanceContracts_byA] mc2
       WHERE mc2.contact_id = c.id
     )
)`;

async function listContactsPage({ page = 1, pageSize = MAX_CONTACTS_PAGE_SIZE, search = '', registered = 'all' } = {}) {
  const pool = await getPool();
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safePageSize = Math.min(MAX_CONTACTS_PAGE_SIZE, Math.max(1, parseInt(pageSize, 10) || MAX_CONTACTS_PAGE_SIZE));
  const offset = (safePage - 1) * safePageSize;
  const q = (search || '').trim();

  let registeredClause = '';
  if (registered === 'yes') registeredClause = `AND ${REGISTERED_CONDITION}`;
  else if (registered === 'no') registeredClause = `AND NOT ${REGISTERED_CONDITION}`;

  const contactsResult = await pool
    .request()
    .input('q', sql.NVarChar(200), q ? `%${q}%` : null)
    .input('offset', sql.Int, offset)
    .input('pageSize', sql.Int, safePageSize)
    .query(`
      SELECT c.id, c.name, c.location, c.created_at, c.contract_date, c.manager_phone, c.manager_name,
             mc.start_date AS maintenance_start_date, mc.end_date AS maintenance_end_date,
             mc.stopped_at AS maintenance_stopped_at,
             COUNT(*) OVER() AS total_count
      FROM [dbo].[NileChat_Contacts_byA] c
      ${CURRENT_CONTRACT_APPLY}
      WHERE (
         @q IS NULL
         OR c.name LIKE @q
         OR EXISTS (
              SELECT 1 FROM [dbo].[NileChat_ContactPhones_byA] p
              WHERE p.contact_id = c.id AND p.phone_number LIKE @q
            )
      )
      ${registeredClause}
      ORDER BY c.name ASC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

  const rows = contactsResult.recordset;
  const total = rows[0] ? rows[0].total_count : 0;
  const contactIds = rows.map((r) => r.id);

  let phonesByContact = {};
  if (contactIds.length) {
    const idsCsv = contactIds.join(',');
    const phonesResult = await pool
      .request()
      .query(`
        SELECT contact_id, phone_number, label
        FROM [dbo].[NileChat_ContactPhones_byA]
        WHERE contact_id IN (${idsCsv})
        ORDER BY created_at ASC
      `);
    for (const row of phonesResult.recordset) {
      if (!phonesByContact[row.contact_id]) phonesByContact[row.contact_id] = [];
      phonesByContact[row.contact_id].push({ phone_number: row.phone_number, label: row.label || null });
    }
  }

  // عدد التابين (مسجلين / لسه بس واتساب) على نفس شرط البحث @q، عشان الأرقام
  // فوق التابات تفضل مظبوطة حتى لو المستخدم بيدور بكلمة معينة
  const countsResult = await pool
    .request()
    .input('q', sql.NVarChar(200), q ? `%${q}%` : null)
    .query(`
      SELECT
        SUM(reg.is_registered) AS registered_count,
        SUM(1 - reg.is_registered) AS unregistered_count
      FROM [dbo].[NileChat_Contacts_byA] c
      CROSS APPLY (
        -- بننقل شرط EXISTS برّه الـ SUM هنا (مش جواه مباشرة) لأن SQL Server مش بيسمح
        -- بـ subquery جوه argument بتاع aggregate function زي SUM (بيدي Error 130:
        -- "Cannot perform an aggregate function on an expression containing an
        -- aggregate or a subquery"). هنا بقى reg.is_registered عمود عادي بقيمة 0/1
        -- جاهزة، والـ SUM بيجمعها عادي من غير أي subquery جواه
        SELECT CASE WHEN ${REGISTERED_CONDITION} THEN 1 ELSE 0 END AS is_registered
      ) reg
      WHERE (
         @q IS NULL
         OR c.name LIKE @q
         OR EXISTS (
              SELECT 1 FROM [dbo].[NileChat_ContactPhones_byA] p
              WHERE p.contact_id = c.id AND p.phone_number LIKE @q
            )
      )
    `);
  const countsRow = countsResult.recordset[0] || {};

  return {
    contacts: rows.map(({ total_count, ...c }) => ({ ...c, phones: phonesByContact[c.id] || [] })),
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
    counts: {
      registered: countsRow.registered_count || 0,
      unregistered: countsRow.unregistered_count || 0,
    },
  };
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

// بينشئ "كارت عميل صيانة" (Add Contact بتاع الأدمن): كونتاكت جديد بمكانه، بالإضافة
// لرقم تليفونه العادي زي أي كونتاكت تاني. القيمة دي (location) هي اللي بتفرّق الكارت
// ده عن كارت الكونتاكت العادي الجاي أوتوماتيك من واتساب. signedContractDate (تاريخ
// التعاقد) و managerPhone (رقم المدير) معلومات مستقلة بتتخزن على الكونتاكت نفسه
// ومالهاش أي علاقة بعقد الصيانة. أما contractDate/maintenanceEndDate (لو الأدمن
// بعتهم) فبينشئوا أول عقد صيانة فورًا في سجل العقود المنفصل — اختياري تمامًا،
// ممكن يتضاف بعدين من زرار "إضافة عقد صيانة" في صفحة تفاصيل العميل
async function createCustomerContact({
  name,
  phoneNumber,
  location,
  signedContractDate,
  managerName,
  managerPhone,
  contractDate,
  maintenanceEndDate,
  modules,
  createdBy,
  createdByName,
}) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('name', sql.NVarChar(200), name)
    .input('location', sql.NVarChar(300), location || null)
    .input('contractDate', sql.Date, signedContractDate || null)
    .input('managerName', sql.NVarChar(200), managerName || null)
    .input('managerPhone', sql.NVarChar(30), managerPhone || null)
    .query(`
      INSERT INTO [dbo].[NileChat_Contacts_byA] (name, location, contract_date, manager_name, manager_phone)
      OUTPUT INSERTED.*
      VALUES (@name, @location, @contractDate, @managerName, @managerPhone)
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

  if (modules && modules.length) {
    await setContactModules(contact.id, modules);
  }

  if (contractDate && maintenanceEndDate) {
    await maintenanceContractRepo.addContract({
      contactId: contact.id,
      startDate: contractDate,
      endDate: maintenanceEndDate,
      createdBy,
      createdByName,
    });
  }

  return getContactByIdWithPhones(contact.id);
}

// تعديل بيانات كارت عميل الصيانة (أدمن بس) — الاسم، المكان، تاريخ التعاقد، رقم
// المدير، والموديولات اللي مشترك فيها. تواريخ عقد الصيانة بقت بتتضاف/تتجدد من
// زرار "إضافة عقد صيانة" في سجل الصيانة بتاع العميل (سجل كامل بعقود متعددة)،
// مش من هنا، عشان لو عقد قديم اتعدّل هنا كان بيمسح تاريخ العقد اللي فات بدل ما
// يحتفظ بيه كسجل منفصل
async function updateCustomerDetails(id, { name, location, signedContractDate, managerName, managerPhone, modules }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('name', sql.NVarChar(200), name)
    .input('location', sql.NVarChar(300), location || null)
    .input('contractDate', sql.Date, signedContractDate || null)
    .input('managerName', sql.NVarChar(200), managerName || null)
    .input('managerPhone', sql.NVarChar(30), managerPhone || null)
    .query(`
      UPDATE [dbo].[NileChat_Contacts_byA]
      SET name = @name, location = @location, contract_date = @contractDate, manager_name = @managerName, manager_phone = @managerPhone
      OUTPUT INSERTED.*
      WHERE id = @id
    `);
  if (!result.recordset[0]) return null;

  if (modules !== undefined) {
    await setContactModules(id, modules);
  }

  return getContactByIdWithPhones(id);
}

// مسح عميل نهائيًا بكل تفاصيله: رسايله، محادثاته (وكل حاجة مرتبطة بيها زي
// الليبلات والتيمز والتقييمات)، أجهزة الدعم الفني بتاعته، التاسكات المجدولة،
// الزيارات، عقود الصيانة، أرقام تليفوناته، وأخيرًا الكونتاكت نفسه. كل ده جوه
// transaction واحدة عشان لو أي خطوة فشلت يرجع كل حاجة زي ما كانت (مفيش نص
// عميل متمسوح). أدمن بس هو اللي يقدر ينادي على الدالة دي (اتأكد منها في
// requireAdmin على الراوت + كلمة السر في contact.controller.deleteContact)
async function deleteContactCompletely(contactId) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    // هات كل المحادثات بتاعة العميل ده الأول عشان نمسح كل حاجة متعلقة بيها
    const convosResult = await new sql.Request(transaction)
      .input('contactId', sql.BigInt, contactId)
      .query(`SELECT id FROM [dbo].[NileChat_Conversations_byA] WHERE contact_id = @contactId`);
    const conversationIds = convosResult.recordset.map((r) => r.id);

    if (conversationIds.length > 0) {
      const idsCsv = conversationIds.join(',');
      await new sql.Request(transaction).query(`DELETE FROM [dbo].[${TABLE_NAME}] WHERE conversation_id IN (${idsCsv})`);
      await new sql.Request(transaction).query(`DELETE FROM [dbo].[NileChat_ConversationLabels_byA] WHERE conversation_id IN (${idsCsv})`);
      await new sql.Request(transaction).query(`DELETE FROM [dbo].[NileChat_ConversationTeams_byA] WHERE conversation_id IN (${idsCsv})`);
      await new sql.Request(transaction).query(`DELETE FROM [dbo].[NileChat_ConversationRatings_byA] WHERE conversation_id IN (${idsCsv})`);
    }

    await new sql.Request(transaction)
      .input('contactId', sql.BigInt, contactId)
      .query(`DELETE FROM [dbo].[NileChat_Conversations_byA] WHERE contact_id = @contactId`);

    await new sql.Request(transaction)
      .input('contactId', sql.BigInt, contactId)
      .query(`DELETE FROM [dbo].[NileChat_Devices_byA] WHERE contact_id = @contactId`);

    await new sql.Request(transaction)
      .input('contactId', sql.BigInt, contactId)
      .query(`DELETE FROM [dbo].[NileChat_ScheduledTasks_byA] WHERE contact_id = @contactId`);

    await new sql.Request(transaction)
      .input('contactId', sql.BigInt, contactId)
      .query(`DELETE FROM [dbo].[NileChat_Visits_byA] WHERE contact_id = @contactId`);

    await new sql.Request(transaction)
      .input('contactId', sql.BigInt, contactId)
      .query(`DELETE FROM [dbo].[NileChat_MaintenanceContracts_byA] WHERE contact_id = @contactId`);

    await new sql.Request(transaction)
      .input('contactId', sql.BigInt, contactId)
      .query(`DELETE FROM [dbo].[NileChat_ContactPhones_byA] WHERE contact_id = @contactId`);

    await new sql.Request(transaction)
      .input('contactId', sql.BigInt, contactId)
      .query(`DELETE FROM [dbo].[NileChat_ContactModules_byA] WHERE contact_id = @contactId`);

    const deletedResult = await new sql.Request(transaction)
      .input('contactId', sql.BigInt, contactId)
      .query(`
        DELETE FROM [dbo].[NileChat_Contacts_byA]
        OUTPUT DELETED.id, DELETED.name
        WHERE id = @contactId
      `);

    await transaction.commit();
    return deletedResult.recordset[0] || null;
  } catch (err) {
    await transaction.rollback().catch(() => {});
    throw err;
  }
}

module.exports = {
  findContactByPhone,
  createContactWithPhone,
  createCustomerContact,
  updateCustomerDetails,
  getContactById,
  getContactByIdWithCurrentContract,
  getContactByIdWithPhones,
  getPhonesForContact,
  updatePhoneLabel,
  listContacts,
  listContactsPage,
  updateContactName,
  linkPhoneToContact,
  unlinkPhoneToNewContact,
  deletePhonelessContact,
  deleteContactCompletely,
  getModulesForContact,
  setContactModules,
};
