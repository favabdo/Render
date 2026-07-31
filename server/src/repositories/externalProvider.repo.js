// repositories/externalProvider.repo.js
// إدارة اتصالات المصادر الخارجية (شات ووت دلوقتي، وأي مصدر تاني مستقبلًا) —
// كل صف هنا هو اتصال واحد (Base URL + Account ID + Token) بتاع شركة معينة

const { getPool, sql } = require('../database/connection');

async function createProvider({ name, companyId, baseUrl, accountId, inboxIdOnProvider, apiAccessToken, webhookSecret }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('name', sql.NVarChar(100), name)
    .input('companyId', sql.BigInt, companyId)
    .input('baseUrl', sql.NVarChar(500), baseUrl)
    .input('accountId', sql.NVarChar(100), accountId)
    .input('inboxId', sql.NVarChar(100), inboxIdOnProvider || null)
    .input('token', sql.NVarChar(500), apiAccessToken)
    .input('secret', sql.NVarChar(200), webhookSecret || null)
    .query(`
      INSERT INTO [dbo].[External_Provider_byA]
        (name, company_id, base_url, account_id, inbox_id_on_provider, api_access_token, webhook_secret)
      OUTPUT INSERTED.*
      VALUES (@name, @companyId, @baseUrl, @accountId, @inboxId, @token, @secret)
    `);
  return result.recordset[0];
}

async function getProviderById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`SELECT * FROM [dbo].[External_Provider_byA] WHERE id = @id`);
  return result.recordset[0] || null;
}

async function listProvidersByCompany(companyId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('companyId', sql.BigInt, companyId)
    .query(`SELECT * FROM [dbo].[External_Provider_byA] WHERE company_id = @companyId ORDER BY created_at DESC`);
  return result.recordset;
}

async function setActive(id, isActive) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('isActive', sql.Bit, isActive ? 1 : 0)
    .query(`UPDATE [dbo].[External_Provider_byA] SET is_active = @isActive WHERE id = @id`);
}

// تحديث جزئي — أي حقل مبعتوش (undefined) بيفضل زي ما هو من غير تغيير
// (COALESCE بياخد القيمة القديمة لو الجديدة NULL)
async function updateProvider(id, { name, baseUrl, accountId, inboxIdOnProvider, apiAccessToken, webhookSecret }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('name', sql.NVarChar(100), name ?? null)
    .input('baseUrl', sql.NVarChar(500), baseUrl ?? null)
    .input('accountId', sql.NVarChar(100), accountId ?? null)
    .input('inboxId', sql.NVarChar(100), inboxIdOnProvider ?? null)
    .input('token', sql.NVarChar(500), apiAccessToken ?? null)
    .input('secret', sql.NVarChar(200), webhookSecret ?? null)
    .query(`
      UPDATE [dbo].[External_Provider_byA]
      SET name = COALESCE(@name, name),
          base_url = COALESCE(@baseUrl, base_url),
          account_id = COALESCE(@accountId, account_id),
          inbox_id_on_provider = COALESCE(@inboxId, inbox_id_on_provider),
          api_access_token = COALESCE(@token, api_access_token),
          webhook_secret = COALESCE(@secret, webhook_secret)
      OUTPUT INSERTED.*
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

module.exports = {
  createProvider,
  getProviderById,
  listProvidersByCompany,
  setActive,
  updateProvider,
};
