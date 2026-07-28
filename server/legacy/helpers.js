// helpers.js
// دوال مساعدة: هات/أنشئ contact، هات/أنشئ conversation مفتوحة

const { pool } = require('./db');

/**
 * يدور على contact برقمه، لو مش موجود يعمله. وبيحدّث الاسم لو اتغير.
 */
async function findOrCreateContact(waId, name) {
  const existing = await pool.query('SELECT * FROM contacts WHERE wa_id = $1', [waId]);

  if (existing.rows.length > 0) {
    if (name && existing.rows[0].name !== name) {
      await pool.query('UPDATE contacts SET name = $1 WHERE wa_id = $2', [name, waId]);
    }
    return existing.rows[0];
  }

  const inserted = await pool.query(
    'INSERT INTO contacts (wa_id, name) VALUES ($1, $2) RETURNING *',
    [waId, name || waId]
  );
  return inserted.rows[0];
}

/**
 * يدور على آخر محادثة مفتوحة (open) للعميل، لو مفيش يعمل واحدة جديدة.
 */
async function findOrCreateOpenConversation(contactId) {
  const existing = await pool.query(
    "SELECT * FROM conversations WHERE contact_id = $1 AND status != 'resolved' ORDER BY id DESC LIMIT 1",
    [contactId]
  );

  if (existing.rows.length > 0) return existing.rows[0];

  const inserted = await pool.query(
    'INSERT INTO conversations (contact_id) VALUES ($1) RETURNING *',
    [contactId]
  );
  return inserted.rows[0];
}

async function touchContact(contactId) {
  await pool.query('UPDATE contacts SET last_message_at = NOW() WHERE id = $1', [contactId]);
}

async function touchConversation(conversationId) {
  await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);
}

module.exports = {
  findOrCreateContact,
  findOrCreateOpenConversation,
  touchContact,
  touchConversation,
};
