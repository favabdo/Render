// repositories/device.repo.js
// أجهزة الدعم الفني (AnyDesk) الخاصة بكل عميل (كونتاكت) — مخزّنة في NileChat_Devices_byA
const { getPool, sql } = require('../config/db');

async function listDevicesForContact(contactId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contactId', sql.BigInt, contactId)
    .query(`
      SELECT * FROM [dbo].[NileChat_Devices_byA]
      WHERE contact_id = @contactId
      ORDER BY created_at ASC
    `);
  return result.recordset;
}

async function getDeviceById(deviceId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, deviceId)
    .query(`SELECT * FROM [dbo].[NileChat_Devices_byA] WHERE id = @id`);
  return result.recordset[0] || null;
}

async function addDevice(contactId, { name, anydesk = null, password = null }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contactId', sql.BigInt, contactId)
    .input('name', sql.NVarChar(200), name)
    .input('anydesk', sql.NVarChar(150), anydesk)
    .input('password', sql.NVarChar(200), password)
    .query(`
      INSERT INTO [dbo].[NileChat_Devices_byA] (contact_id, name, anydesk, password)
      OUTPUT INSERTED.*
      VALUES (@contactId, @name, @anydesk, @password)
    `);
  return result.recordset[0];
}

async function updateDevice(deviceId, { name, anydesk = null, password = null }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, deviceId)
    .input('name', sql.NVarChar(200), name)
    .input('anydesk', sql.NVarChar(150), anydesk)
    .input('password', sql.NVarChar(200), password)
    .query(`
      UPDATE [dbo].[NileChat_Devices_byA]
      SET name = @name, anydesk = @anydesk, password = @password, updated_at = SYSUTCDATETIME()
      OUTPUT INSERTED.*
      WHERE id = @id
    `);
  return result.recordset[0] || null;
}

async function deleteDevice(deviceId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, deviceId)
    .query(`DELETE FROM [dbo].[NileChat_Devices_byA] OUTPUT DELETED.id WHERE id = @id`);
  return result.recordset[0] || null;
}

module.exports = {
  listDevicesForContact,
  getDeviceById,
  addDevice,
  updateDevice,
  deleteDevice,
};
