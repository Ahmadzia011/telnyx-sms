const { requireAuth } = require('../lib/auth');
const { getSql } = require('../lib/db');

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');
  try {
    const sql = getSql();
    const rows = await sql`
      SELECT contact,
             (array_agg(body ORDER BY created_at DESC, id DESC))[1]      AS last_body,
             (array_agg(direction ORDER BY created_at DESC, id DESC))[1] AS last_direction,
             max(created_at)                                             AS last_at,
             (count(*) FILTER (WHERE direction = 'in' AND read = false))::int AS unread
      FROM messages
      GROUP BY contact
      ORDER BY max(created_at) DESC`;
    return res.status(200).json({
      ok: true,
      myNumber: process.env.MY_NUMBER || '',
      conversations: rows
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
