const { requireAuth } = require('../lib/auth');
const { getSql } = require('../lib/db');
const { normalizeContact } = require('../lib/phone');

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');

  const norm = normalizeContact(req.query.contact);
  if (!norm.ok) return res.status(400).json({ ok: false, error: norm.error });

  try {
    const sql = getSql();
    const rows = await sql`
      SELECT * FROM (
        SELECT id::text AS id, direction, body, status, error, read, created_at
        FROM messages
        WHERE contact = ${norm.number}
        ORDER BY created_at DESC, id DESC
        LIMIT 500
      ) t
      ORDER BY created_at ASC, id ASC`;
    return res.status(200).json({ ok: true, messages: rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
