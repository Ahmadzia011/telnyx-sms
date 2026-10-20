const { requireAuth } = require('../lib/auth');
const { getSql } = require('../lib/db');
const { normalizeUS } = require('../lib/phone');

function formatTelnyxError(data) {
  const errs = data && Array.isArray(data.errors) ? data.errors : [];
  if (!errs.length) return '';
  return errs
    .map((e) => {
      const head = [e.title, e.detail].filter(Boolean).join(': ');
      return e.code ? head + ' (code ' + e.code + ')' : head;
    })
    .join('; ');
}

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const norm = normalizeUS(body.to);
  if (!norm.ok) return res.status(400).json({ ok: false, error: norm.error });

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return res.status(400).json({ ok: false, error: 'Message is empty.' });

  const apiKey = process.env.TELNYX_API_KEY;
  const from = process.env.MY_NUMBER;
  if (!apiKey || !from) {
    return res.status(500).json({ ok: false, error: 'Server is missing TELNYX_API_KEY or MY_NUMBER.' });
  }

  let sql;
  try {
    sql = getSql();
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }

  let response, data;
  try {
    response = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from, to: norm.number, text })
    });
    data = await response.json().catch(() => ({}));
  } catch (e) {
    return res.status(502).json({ ok: false, error: 'Could not reach Telnyx: ' + e.message });
  }

  if (!response.ok) {
    const message = formatTelnyxError(data) || 'Telnyx returned HTTP ' + response.status;
    try {
      await sql`
        INSERT INTO messages (contact, direction, body, status, error, read)
        VALUES (${norm.number}, 'out', ${text}, 'failed', ${message}, true)`;
    } catch (e) {
      console.error('Could not record failed message:', e);
    }
    return res.status(502).json({ ok: false, error: message });
  }

  const telnyxId = data && data.data && data.data.id ? data.data.id : null;
  try {
    // ON CONFLICT: the message.sent webhook may already have created this row.
    await sql`
      INSERT INTO messages (telnyx_id, contact, direction, body, status, read)
      VALUES (${telnyxId}, ${norm.number}, 'out', ${text}, 'queued', true)
      ON CONFLICT (telnyx_id) DO NOTHING`;
  } catch (e) {
    console.error('Could not record sent message:', e);
    return res.status(500).json({
      ok: false,
      error: 'Message was accepted by Telnyx but could not be saved: ' + e.message
    });
  }

  return res.status(200).json({ ok: true });
};
