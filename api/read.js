const { requireAuth } = require('../lib/auth');
const { getSql } = require('../lib/db');
const { normalizeContact } = require('../lib/phone');

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const norm = normalizeContact(body.contact);
  if (!norm.ok) return res.status(400).json({ ok: false, error: norm.error });

  try {
    const sql = getSql();
    await sql`
      UPDATE messages SET read = true
      WHERE contact = ${norm.number} AND direction = 'in' AND read = false`;
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
