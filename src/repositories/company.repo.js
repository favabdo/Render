// repositories/company.repo.js
// إدارة بيانات الشركة (Account): الاسم، الكود، وعدد أيام الـ Auto Resolve

const { getPool, sql, generateCompanyCode } = require('../config/db');

async function getCompanyById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`SELECT * FROM [dbo].[NileChat_Companies_byA] WHERE id = @id`);
  return result.recordset[0] || null;
}

// أول شركة اتعملت في النظام (Nile Techno Support) — بنستخدمها كـ fallback لأي
// يوزر لسه مش مربوط بشركة، ولحد ما يتعمل فعليًا اختيار/إنشاء شركة وقت التسجيل
async function getFirstCompany() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP 1 * FROM [dbo].[NileChat_Companies_byA] ORDER BY id ASC
  `);
  return result.recordset[0] || null;
}

// بيرجع بيانات شركة اليوزر (لو مربوط بواحدة)، وإلا أول شركة في النظام كـ fallback
async function getCompanyForUser(user) {
  if (user && user.company_id) {
    const company = await getCompanyById(user.company_id);
    if (company) return company;
  }
  return getFirstCompany();
}

async function createCompany({ name, autoResolveDays = null }) {
  const pool = await getPool();
  const code = generateCompanyCode();
  const result = await pool
    .request()
    .input('name', sql.NVarChar(200), name)
    .input('code', sql.NVarChar(50), code)
    .input('autoResolveDays', sql.Int, autoResolveDays)
    .query(`
      INSERT INTO [dbo].[NileChat_Companies_byA] (name, code, auto_resolve_days)
      OUTPUT INSERTED.*
      VALUES (@name, @code, @autoResolveDays)
    `);
  return result.recordset[0];
}

async function updateCompany(id, { name, autoResolveDays } = {}) {
  const pool = await getPool();
  const req = pool.request().input('id', sql.BigInt, id);
  const sets = [];

  if (name !== undefined) {
    req.input('name', sql.NVarChar(200), name);
    sets.push('name = @name');
  }
  if (autoResolveDays !== undefined) {
    req.input('autoResolveDays', sql.Int, autoResolveDays);
    sets.push('auto_resolve_days = @autoResolveDays');
  }

  if (sets.length === 0) return getCompanyById(id);

  const result = await req.query(`
    UPDATE [dbo].[NileChat_Companies_byA]
    SET ${sets.join(', ')}
    OUTPUT INSERTED.*
    WHERE id = @id
  `);
  return result.recordset[0] || null;
}

// إعداد الـ Auto Resolve الحالي (بيتاخد من أول شركة في النظام حاليًا، لحد ما
// كل جزء تاني في النظام - المحادثات/الـ Inboxes - يتربط فعليًا بشركة معينة)
async function getPrimaryAutoResolveDays() {
  const company = await getFirstCompany();
  return company ? company.auto_resolve_days : null;
}

module.exports = {
  getCompanyById,
  getFirstCompany,
  getCompanyForUser,
  createCompany,
  updateCompany,
  getPrimaryAutoResolveDays,
};
