const { clearedCookie } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  res.setHeader('Set-Cookie', clearedCookie());
  return res.status(200).json({ ok: true });
};
