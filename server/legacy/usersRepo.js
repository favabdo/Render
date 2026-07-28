const { getPool, sql } = require('./db');

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
    .query(`SELECT id, email, role, status, display_name FROM [dbo].[NileChat_Users_byA] WHERE id = @id`);
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
};
