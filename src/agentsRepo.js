const bcrypt = require('bcryptjs');
const { getPool, sql } = require('./db');

async function findAgentByEmail(email) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('email', sql.NVarChar(200), email)
    .query(`SELECT * FROM [dbo].[NileChat_Agents_byA] WHERE email = @email`);
  return result.recordset[0] || null;
}

async function findAgentById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query(`SELECT id, name, email, created_at FROM [dbo].[NileChat_Agents_byA] WHERE id = @id`);
  return result.recordset[0] || null;
}

async function listAgents() {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT id, name, email, created_at FROM [dbo].[NileChat_Agents_byA] ORDER BY name`);
  return result.recordset;
}

async function createAgent({ name, email, password }) {
  const pool = await getPool();
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool
    .request()
    .input('name', sql.NVarChar(200), name)
    .input('email', sql.NVarChar(200), email)
    .input('passwordHash', sql.NVarChar(200), passwordHash)
    .query(`
      INSERT INTO [dbo].[NileChat_Agents_byA] (name, email, password_hash)
      OUTPUT INSERTED.id, INSERTED.name, INSERTED.email
      VALUES (@name, @email, @passwordHash)
    `);
  return result.recordset[0];
}

async function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

async function countAgents() {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT COUNT(*) AS total FROM [dbo].[NileChat_Agents_byA]`);
  return result.recordset[0].total;
}

module.exports = { findAgentByEmail, findAgentById, listAgents, createAgent, verifyPassword, countAgents };
