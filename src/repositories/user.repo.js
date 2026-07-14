const crypto = require('crypto');
const { getPool, sql } = require('../config/db');

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
    .query(`
      SELECT id, email, role, status, display_name, full_name, avatar_url,
             notification_prefs, access_token, company_id, company_code
      FROM [dbo].[NileChat_Users_byA] WHERE id = @id
    `);
  return result.recordset[0] || null;
}

// نفس findUserById بس بيرجع كلمة السر كمان — مستخدمة بس وقت التحقق من كلمة
// السر الحالية (تغيير كلمة السر من صفحة البروفايل)
async function findUserByIdWithPassword(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`SELECT * FROM [dbo].[NileChat_Users_byA] WHERE id = @id`);
  return result.recordset[0] || null;
}

// بيدور على اليوزر بتوكن الوصول الشخصي (Access Token) بتاعه — مستخدم في
// الـ middleware عشان أي تكامل خارجي يقدر يستخدم التوكن ده بدل الـ JWT
async function findUserByAccessToken(token) {
  if (!token) return null;
  const pool = await getPool();
  const result = await pool
    .request()
    .input('token', sql.NVarChar(200), token)
    .query(`
      SELECT id, email, role, status, display_name, full_name
      FROM [dbo].[NileChat_Users_byA] WHERE access_token = @token
    `);
  return result.recordset[0] || null;
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
  return (
    (user.display_name && user.display_name.trim()) ||
    (user.full_name && user.full_name.trim()) ||
    user.email
  );
}

// القيم الافتراضية لتفضيلات الإشعارات — لو اليوزر لسه معملش أي تعديل عليها
const DEFAULT_NOTIFICATION_PREFS = {
  conversation_created: { email: false, push: true },
  conversation_assigned: { email: false, push: true },
  conversation_mention: { email: false, push: true },
  assigned_conversation_message: { email: false, push: true },
  participating_conversation_message: { email: false, push: true },
};

function parseNotificationPrefs(raw) {
  if (!raw) return { ...DEFAULT_NOTIFICATION_PREFS };
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_NOTIFICATION_PREFS, ...parsed };
  } catch (err) {
    return { ...DEFAULT_NOTIFICATION_PREFS };
  }
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

// تحديث بيانات البروفايل الشخصي (الاسم الكامل / الاسم المعروض / الإيميل)
// بيرجع null لو مفيش أي حقل اتبعت
async function updateProfile(id, { full_name, display_name, email } = {}) {
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

  if (sets.length === 0) return null;

  const result = await req.query(`
    UPDATE [dbo].[NileChat_Users_byA]
    SET ${sets.join(', ')}
    OUTPUT INSERTED.id, INSERTED.email, INSERTED.role, INSERTED.status,
           INSERTED.display_name, INSERTED.full_name, INSERTED.avatar_url
    WHERE id = @id
  `);
  return result.recordset[0] || null;
}

// تحديث صورة البروفايل (بعد ما بترفع على الديسك بواسطة mediaStorage)
async function updateAvatar(id, avatarUrl) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('avatar_url', sql.NVarChar(500), avatarUrl)
    .query(`
      UPDATE [dbo].[NileChat_Users_byA]
      SET avatar_url = @avatar_url
      OUTPUT INSERTED.id, INSERTED.avatar_url
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

// تغيير كلمة السر (بعد ما يتأكد الكونترولر إن كلمة السر الحالية صح)
async function updatePassword(id, newPassword) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('password', sql.NVarChar(200), newPassword) // plain text مؤقتاً زي باقي النظام
    .query(`
      UPDATE [dbo].[NileChat_Users_byA]
      SET password = @password
      OUTPUT INSERTED.id
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

// بيرجع تفضيلات الإشعارات الحالية (مع دمجها بالقيم الافتراضية لأي حدث جديد
// لسه مخزنش له قيمة)
async function getNotificationPrefs(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`SELECT notification_prefs FROM [dbo].[NileChat_Users_byA] WHERE id = @id`);
  const row = result.recordset[0];
  if (!row) return null;
  return parseNotificationPrefs(row.notification_prefs);
}

async function updateNotificationPrefs(id, prefs) {
  const merged = { ...DEFAULT_NOTIFICATION_PREFS, ...prefs };
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('prefs', sql.NVarChar(sql.MAX), JSON.stringify(merged))
    .query(`
      UPDATE [dbo].[NileChat_Users_byA]
      SET notification_prefs = @prefs
      WHERE id = @id
    `);
  return merged;
}

// بيولّد توكن وصول شخصي عشوائي وآمن (32 بايت = 64 حرف hex)
function generateAccessTokenValue() {
  return crypto.randomBytes(32).toString('hex');
}

// بيرجع توكن الوصول الحالي، ولو مفيش واحد لسه بيولّد واحد جديد ويخزنه
async function ensureAccessToken(id) {
  const pool = await getPool();
  const existing = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`SELECT access_token FROM [dbo].[NileChat_Users_byA] WHERE id = @id`);
  const current = existing.recordset[0] && existing.recordset[0].access_token;
  if (current) return current;
  return regenerateAccessToken(id);
}

// بيولّد توكن جديد ويستبدل القديم (مثلاً لو التوكن القديم اتسرب)
async function regenerateAccessToken(id) {
  const token = generateAccessTokenValue();
  const pool = await getPool();
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
  findUserByIdWithPassword,
  findUserByAccessToken,
  listUsers,
  createUser,
  updateUser,
  updateDisplayName,
  updateProfile,
  updateAvatar,
  updatePassword,
  getNotificationPrefs,
  updateNotificationPrefs,
  ensureAccessToken,
  regenerateAccessToken,
  resolveDisplayName,
  verifyPassword,
  countUsers,
  setInviteToken,
  findUserByInviteToken,
  completeInvite,
  deleteUser,
};
