const crypto = require('crypto');
const { getPool, sql } = require('../config/db');

// تفضيلات الإشعارات الافتراضية لأي إيجنت لسه معملش تخصيص بنفسه
const DEFAULT_NOTIF_PREFS = {
  new_conversation:            { email: false, push: true },
  conversation_assigned:       { email: true,  push: true },
  mentioned:                   { email: true,  push: true },
  new_message_assigned:        { email: false, push: true },
  new_message_participating:   { email: false, push: true },
};

function parseNotifPrefs(raw) {
  if (!raw) return { ...DEFAULT_NOTIF_PREFS };
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_NOTIF_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_NOTIF_PREFS };
  }
}

async function findUserByEmail(email) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('email', sql.NVarChar(200), email)
    .query(`SELECT * FROM [dbo].[NileChat_Users_byA] WHERE email = @email`);
  return result.recordset[0] || null;
}

async function findUserById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`SELECT id, email, role, status, display_name, full_name, avatar_data, access_token, notif_prefs, company_id, company_code FROM [dbo].[NileChat_Users_byA] WHERE id = @id`);
  const user = result.recordset[0] || null;
  if (user) user.notif_prefs = parseNotifPrefs(user.notif_prefs);
  return user;
}

async function listUsers() {
  const pool = await getPool();
  const result = await pool
    .request()
    .query(`SELECT id, email, role, status, company_id, company_code, display_name FROM [dbo].[NileChat_Users_byA] ORDER BY id`);
  return result.recordset;
}

// الاسم اللي المفروض يتعرض في الواجهة: اسم العرض لو الإيجنت حدده، وإلا الإيميل
function resolveDisplayName(user) {
  if (!user) return null;
  return (user.display_name && user.display_name.trim()) || user.email;
}

async function createUser({ email, password, role = 1, status = 'active', company_id = null, company_code = null }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('email',        sql.NVarChar(200), email)
    .input('password',     sql.NVarChar(200), password)   // plain text مؤقتاً
    .input('role',         sql.Int,           role)
    .input('status',       sql.NVarChar(20),  status)
    .input('company_id',   sql.BigInt,        company_id)
    .input('company_code', sql.NVarChar(100), company_code)
    .query(`
      INSERT INTO [dbo].[NileChat_Users_byA] (email, password, role, status, company_id, company_code)
      OUTPUT INSERTED.id, INSERTED.email, INSERTED.role, INSERTED.status, INSERTED.company_id, INSERTED.company_code
      VALUES (@email, @password, @role, @status, @company_id, @company_code)
    `);
  return result.recordset[0];
}

async function updateUser(id, fields) {
  const pool = await getPool();
  const req = pool.request().input('id', sql.BigInt, id);
  const sets = [];

  if (fields.role !== undefined) {
    req.input('role', sql.Int, fields.role);
    sets.push('role = @role');
  }
  if (fields.status !== undefined) {
    req.input('status', sql.NVarChar(20), fields.status);
    sets.push('status = @status');
  }
  if (fields.password !== undefined) {
    req.input('password', sql.NVarChar(200), fields.password); // plain text مؤقتاً
    sets.push('password = @password');
  }
  if (fields.company_id !== undefined) {
    req.input('company_id', sql.BigInt, fields.company_id);
    sets.push('company_id = @company_id');
  }
  if (fields.company_code !== undefined) {
    req.input('company_code', sql.NVarChar(100), fields.company_code);
    sets.push('company_code = @company_code');
  }
  if (fields.display_name !== undefined) {
    req.input('display_name', sql.NVarChar(200), fields.display_name);
    sets.push('display_name = @display_name');
  }

  if (sets.length === 0) return null;

  const result = await req.query(`
    UPDATE [dbo].[NileChat_Users_byA]
    SET ${sets.join(', ')}
    OUTPUT INSERTED.id, INSERTED.email, INSERTED.role, INSERTED.status, INSERTED.company_id, INSERTED.company_code, INSERTED.display_name
    WHERE id = @id
  `);
  return result.recordset[0] || null;
}

// تحديث اسم العرض بتاع الإيجنت نفسه (مش محتاج صلاحية admin)
async function updateDisplayName(id, displayName) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('display_name', sql.NVarChar(200), displayName)
    .query(`
      UPDATE [dbo].[NileChat_Users_byA]
      SET display_name = @display_name
      OUTPUT INSERTED.id, INSERTED.email, INSERTED.role, INSERTED.status, INSERTED.display_name
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

// plain text مقارنة مباشرة مؤقتاً
async function verifyPassword(plainPassword, storedPassword) {
  return plainPassword === storedPassword;
}

// تحديث بيانات البروفايل الشخصي بتاعة الإيجنت نفسه: الاسم الكامل، اسم العرض،
// الإيميل، وصورة البروفايل (base64 data URL). أي حقل مبعوتش بيفضل زي ما هو.
async function updateProfile(id, { full_name, display_name, email, avatar_data }) {
  const pool = await getPool();
  const req = pool.request().input('id', sql.BigInt, id);
  const sets = [];

  if (full_name !== undefined) {
    req.input('full_name', sql.NVarChar(200), full_name);
    sets.push('full_name = @full_name');
  }
  if (display_name !== undefined) {
    req.input('display_name', sql.NVarChar(200), display_name);
    sets.push('display_name = @display_name');
  }
  if (email !== undefined) {
    req.input('email', sql.NVarChar(200), email);
    sets.push('email = @email');
  }
  if (avatar_data !== undefined) {
    req.input('avatar_data', sql.NVarChar(sql.MAX), avatar_data);
    sets.push('avatar_data = @avatar_data');
  }

  if (sets.length === 0) return findUserById(id);

  const result = await req.query(`
    UPDATE [dbo].[NileChat_Users_byA]
    SET ${sets.join(', ')}
    OUTPUT INSERTED.id, INSERTED.email, INSERTED.role, INSERTED.status, INSERTED.display_name,
           INSERTED.full_name, INSERTED.avatar_data
    WHERE id = @id
  `);
  return result.recordset[0] || null;
}

// تغيير كلمة سر الإيجنت (بعد التأكد من الباسورد الحالي في الكونترولر)
async function changePassword(id, newPlainPassword) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('password', sql.NVarChar(200), newPlainPassword) // plain text مؤقتاً زي باقي النظام
    .query(`
      UPDATE [dbo].[NileChat_Users_byA]
      SET password = @password
      OUTPUT INSERTED.id
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

// بيولّد Access Token جديد للإيجنت (لاستخدامه في تكاملات API خارجية)، ويلغي القديم فورًا
async function regenerateAccessToken(id) {
  const pool = await getPool();
  const token = 'nc_' + crypto.randomBytes(32).toString('hex');
  await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('token', sql.NVarChar(200), token)
    .query(`
      UPDATE [dbo].[NileChat_Users_byA]
      SET access_token = @token
      WHERE id = @id
    `);
  return token;
}

// بنجيب اليوزر بتوكن الـ API الشخصي بتاعه (مستخدم كطريقة دخول بديلة للـ JWT في requireAuth)
async function findUserByAccessToken(token) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('token', sql.NVarChar(200), token)
    .query(`SELECT id, email, role, status FROM [dbo].[NileChat_Users_byA] WHERE access_token = @token`);
  return result.recordset[0] || null;
}

// تحديث تفضيلات الإشعارات (إيميل/بوش لكل نوع حدث) — بتتخزن كـ JSON نصي واحد
async function updateNotifPrefs(id, prefs) {
  const merged = { ...DEFAULT_NOTIF_PREFS, ...prefs };
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('prefs', sql.NVarChar(sql.MAX), JSON.stringify(merged))
    .query(`
      UPDATE [dbo].[NileChat_Users_byA]
      SET notif_prefs = @prefs
      OUTPUT INSERTED.id
      WHERE id = @id
    `);
  if (!result.recordset[0]) return null;
  return merged;
}

// بنجيب كل الإيجنتس النشطين مع تفضيلات الإشعارات بتاعتهم — مستخدمة وقت إرسال
// إيميلات الأحداث (محادثة جديدة، تعيين محادثة...) عشان نعرف مين فعّل الإيميل فعلاً
async function listUsersWithNotifPrefs() {
  const pool = await getPool();
  const result = await pool
    .request()
    .query(`SELECT id, email, display_name, notif_prefs, status FROM [dbo].[NileChat_Users_byA] WHERE status = 'active'`);
  return result.recordset.map((u) => ({ ...u, notif_prefs: parseNotifPrefs(u.notif_prefs) }));
}

// بنسجل توكن الدعوة (اللي بيتبعت في لينك الإيميل) وتاريخ انتهاء صلاحيته
async function setInviteToken(id, token, expiresAt) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('token', sql.NVarChar(200), token)
    .input('expires', sql.DateTime2, expiresAt)
    .query(`
      UPDATE [dbo].[NileChat_Users_byA]
      SET invite_token = @token, invite_token_expires = @expires
      WHERE id = @id
    `);
}

// بنجيب اليوزر بتوكن الدعوة عشان نتأكد إن اللينك صحيح قبل ما نسمحله يحدد كلمة السر
async function findUserByInviteToken(token) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('token', sql.NVarChar(200), token)
    .query(`SELECT * FROM [dbo].[NileChat_Users_byA] WHERE invite_token = @token`);
  return result.recordset[0] || null;
}

// الإيجنت بيحدد كلمة سره لأول مرة من خلال لينك الدعوة، وبعدها الحساب يبقى Active
async function completeInvite(id, plainPassword) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('password', sql.NVarChar(200), plainPassword) // plain text مؤقتاً زي باقي النظام
    .query(`
      UPDATE [dbo].[NileChat_Users_byA]
      SET password = @password, status = 'active', invite_token = NULL, invite_token_expires = NULL
      OUTPUT INSERTED.id, INSERTED.email, INSERTED.role, INSERTED.status
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

// بنمسح الإيجنت نهائيًا (بعد ما يتأكد من كلمة سر الأدمن اللي بيمسح في الكونترولر)
async function deleteUser(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`
      DELETE FROM [dbo].[NileChat_Users_byA]
      OUTPUT DELETED.id, DELETED.email
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

async function countUsers() {
  const pool = await getPool();
  const result = await pool
    .request()
    .query(`SELECT COUNT(*) AS total FROM [dbo].[NileChat_Users_byA]`);
  return result.recordset[0].total;
}

module.exports = {
  findUserByEmail,
  findUserById,
  listUsers,
  createUser,
  updateUser,
  updateDisplayName,
  resolveDisplayName,
  verifyPassword,
  countUsers,
  setInviteToken,
  findUserByInviteToken,
  completeInvite,
  deleteUser,
  updateProfile,
  changePassword,
  regenerateAccessToken,
  findUserByAccessToken,
  updateNotifPrefs,
  listUsersWithNotifPrefs,
  DEFAULT_NOTIF_PREFS,
};
