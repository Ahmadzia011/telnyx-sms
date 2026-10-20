const { authConfigured, passwordMatches, sessionCookie } = require('../lib/auth');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!authConfigured()) {
    return res.status(500).json({ ok: false, error: 'Server is missing CONSOLE_PASSWORD or SESSION_SECRET.' });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (!passwordMatches(body.password)) {
    await sleep(1000); // slows down password guessing
    return res.status(401).json({ ok: false, error: 'Wrong password.' });
  }
  res.setHeader('Set-Cookie', sessionCookie());
  return res.status(200).json({ ok: true });
};
