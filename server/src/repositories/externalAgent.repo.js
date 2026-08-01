// repositories/externalAgent.repo.js
// إيجنتس الجهة الخارجية (شات ووت). nile_user_id بيفضل NULL دايمًا وقت الإنشاء
// التلقائي — بيتحدد بس لما حد يعمل mergeAgentToNileUser صريح من الواجهة

const { getPool, sql } = require('../database/connection');

// بيدور على صف External_Agent_byA بالـ (provider_id, external_agent_id)
async function findByProviderAndExternalId(providerId, externalAgentId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('providerId', sql.BigInt, providerId)
    .input('externalAgentId', sql.NVarChar(100), String(externalAgentId))
    .query(`
      SELECT * FROM [dbo].[External_Agent_byA]
      WHERE provider_id = @providerId AND external_agent_id = @externalAgentId
    `);
  return result.recordset[0] || null;
}

// بينشئ الصف لو مش موجود، وبيفضل nile_user_id = NULL لحد ما حد يعمل ميرج صريح
async function findOrCreateAgent(providerId, externalAgentId, name) {
  const existing = await findByProviderAndExternalId(providerId, externalAgentId);
  if (existing) return existing;

  const pool = await getPool();
  const result = await pool
    .request()
    .input('providerId', sql.BigInt, providerId)
    .input('externalAgentId', sql.NVarChar(100), String(externalAgentId))
    .input('name', sql.NVarChar(200), name || null)
    .query(`
      INSERT INTO [dbo].[External_Agent_byA] (provider_id, external_agent_id, nile_user_id, name)
      OUTPUT INSERTED.*
      VALUES (@providerId, @externalAgentId, NULL, @name)
    `);
  return result.recordset[0];
}

// الميرج الصريح الوحيد اللي ممكن يحط قيمة في nile_user_id — بيتنادى بس من
// إجراء واعي (زرار "ربط بإيجنت موجود" في الواجهة)، مش بيحصل تلقائي أبدًا.
// agentApiAccessToken اختياري: التوكن الشخصي بتاع الإيجنت نفسه في شات ووت —
// من غيره، أي رد يتبعت من نايل شات هيظهر في شات ووت باسم صاحب توكن الاتصال
// العام (Provider)، مش باسم الإيجنت الحقيقي اللي رد فعليًا.
// agentEmail/agentPassword اختياريين برضه: بديل التوكن — إيميل وباسورد
// الإيجنت في شات ووت، عشان نظام الإرسال يقدر يجيب/يجدد التوكن الشخصي
// تلقائيًا من غيرهم (chatwoot.service.js -> loginAndFetchToken)
async function mergeAgentToNileUser(externalAgentRowId, nileUserId, agentApiAccessToken, agentEmail, agentPassword) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, externalAgentRowId)
    .input('nileUserId', sql.BigInt, nileUserId)
    .input('token', sql.NVarChar(500), agentApiAccessToken || null)
    .input('email', sql.NVarChar(200), agentEmail || null)
    .input('password', sql.NVarChar(500), agentPassword || null)
    .query(`
      UPDATE [dbo].[External_Agent_byA]
      SET nile_user_id = @nileUserId,
          agent_api_access_token = COALESCE(@token, agent_api_access_token),
          agent_email = COALESCE(@email, agent_email),
          agent_password = COALESCE(@password, agent_password)
      OUTPUT INSERTED.*
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

// بيحدّث/يمسح توكن الإيجنت الشخصي من غير ما يمس الميرج نفسه (nile_user_id)
async function setAgentPersonalToken(externalAgentRowId, agentApiAccessToken) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, externalAgentRowId)
    .input('token', sql.NVarChar(500), agentApiAccessToken || null)
    .query(`
      UPDATE [dbo].[External_Agent_byA] SET agent_api_access_token = @token
      OUTPUT INSERTED.*
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

// بيحدّث إيميل/باسورد الإيجنت الشخصيين (بديل التوكن) — من غير ما يمسح
// التوكن الحالي (لو موجود) ولا يمس الميرج نفسه
async function setAgentCredentials(externalAgentRowId, agentEmail, agentPassword) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, externalAgentRowId)
    .input('email', sql.NVarChar(200), agentEmail || null)
    .input('password', sql.NVarChar(500), agentPassword || null)
    .query(`
      UPDATE [dbo].[External_Agent_byA]
      SET agent_email = COALESCE(@email, agent_email),
          agent_password = COALESCE(@password, agent_password)
      OUTPUT INSERTED.*
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

// عكس findOrCreateAgent: بياخد يوزر نايل شات وبيرجع صف الإيجنت الخارجي
// المربوط بيه (لو موجود) — ده اللي بيستخدمه chatwoot.service.js وقت الإرسال
// عشان يعرف يبعت بتوكن مين
async function findByNileUserId(providerId, nileUserId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('providerId', sql.BigInt, providerId)
    .input('nileUserId', sql.BigInt, nileUserId)
    .query(`
      SELECT * FROM [dbo].[External_Agent_byA]
      WHERE provider_id = @providerId AND nile_user_id = @nileUserId
    `);
  return result.recordset[0] || null;
}

// مزامنة كل إيجنتس الحساب من شات ووت دفعة واحدة (بدل ما نستنى كل واحد يبعت
// رسالة عشان يظهر عندنا). أي إيجنت موجود قبل كده بيتحدّثله بس الاسم، من غير
// ما نلمس nile_user_id ولا agent_api_access_token بتاعه لو كانوا متربطين خلاص
async function syncAgentsFromList(providerId, chatwootAgents) {
  const results = [];
  for (const agent of chatwootAgents) {
    if (!agent?.id) continue;
    const existing = await findByProviderAndExternalId(providerId, agent.id);
    if (existing) {
      const pool = await getPool();
      const updated = await pool
        .request()
        .input('id', sql.BigInt, existing.id)
        .input('name', sql.NVarChar(200), agent.name || agent.email || null)
        .query(`
          UPDATE [dbo].[External_Agent_byA] SET name = @name
          OUTPUT INSERTED.*
          WHERE id = @id
        `);
      results.push(updated.recordset[0]);
    } else {
      results.push(await findOrCreateAgent(providerId, agent.id, agent.name || agent.email || null));
    }
  }
  return results;
}

// بيلغي الربط (يرجع nile_user_id لـ NULL) لو حصل غلط في الميرج
async function unmergeAgent(externalAgentRowId) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, externalAgentRowId)
    .query(`UPDATE [dbo].[External_Agent_byA] SET nile_user_id = NULL WHERE id = @id`);
}

async function listByProvider(providerId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('providerId', sql.BigInt, providerId)
    .query(`SELECT * FROM [dbo].[External_Agent_byA] WHERE provider_id = @providerId ORDER BY id`);
  return result.recordset;
}

async function getById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`SELECT * FROM [dbo].[External_Agent_byA] WHERE id = @id`);
  return result.recordset[0] || null;
}

// إيجنتس شات ووت اللي لسه ماتعملهملش ميرج (nile_user_id لسه NULL)
async function listUnmerged(providerId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('providerId', sql.BigInt, providerId)
    .query(`
      SELECT * FROM [dbo].[External_Agent_byA]
      WHERE provider_id = @providerId AND nile_user_id IS NULL
      ORDER BY created_at DESC
    `);
  return result.recordset;
}

// كل إيجنتس الحساب (مربوطين أو لأ) — للعرض في الإعدادات عشان الإداري يشوف
// حالة الربط كاملة، مش بس اللي لسه مش مربوطين
async function listAll(providerId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('providerId', sql.BigInt, providerId)
    .query(`SELECT * FROM [dbo].[External_Agent_byA] WHERE provider_id = @providerId ORDER BY name`);
  return result.recordset;
}

module.exports = {
  findByProviderAndExternalId,
  findOrCreateAgent,
  mergeAgentToNileUser,
  unmergeAgent,
  listByProvider,
  getById,
  listUnmerged,
  listAll,
  setAgentPersonalToken,
  setAgentCredentials,
  findByNileUserId,
  syncAgentsFromList,
};
